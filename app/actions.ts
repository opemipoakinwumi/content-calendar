// app/actions.ts
'use server';

import { Octokit } from '@octokit/rest';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// Interfaces (CalendarEvent, BigCalendarEvent) - remain the same
export interface CalendarEvent { id: string; title: string; start: string; end: string; status: string; notes?: string; }
export interface BigCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> { start: Date; end: Date; }

// Zod Schemas (baseEventSchema, newEventSchema, eventSchema, deleteEventSchema) - remain the same
const baseEventSchema = z.object({ /* ... */ id: z.string().min(1), title: z.string().min(1, 'Title is required'), start: z.string().datetime({ message: 'Invalid start date/time format (YYYY-MM-DDTHH:mm:ssZ)' }), end: z.string().datetime({ message: 'Invalid end date/time format (YYYY-MM-DDTHH:mm:ssZ)' }), status: z.string().min(1, 'Status is required'), notes: z.string().optional(),});
const newEventSchema = baseEventSchema.omit({ id: true }).refine(data => new Date(data.start) < new Date(data.end), { message: "End date must be after start date", path: ["end"], });
const eventSchema = baseEventSchema.refine(data => new Date(data.start) < new Date(data.end), { message: "End date must be after start date", path: ["end"], });
const deleteEventSchema = z.object({ eventId: z.string().min(1, "Event ID is required for deletion"), });

// Environment Variables & Octokit Setup - remain the same
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const REPO_NAME = process.env.GITHUB_REPO_NAME;
const FILE_PATH = process.env.GITHUB_FILE_PATH;
if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME || !FILE_PATH) { console.error("CRITICAL ERROR: Missing GitHub environment variables!"); throw new Error('Missing GitHub environment variables.'); }
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- GitHub API Helper Functions (WITH CATCH BLOCK FIXES) ---
async function getFileContent(): Promise<{ content: string; sha: string | null }> {
    const logPrefix = '[getFileContent]';
    try {
        const response = await octokit.repos.getContent({ owner: REPO_OWNER!, repo: REPO_NAME!, path: FILE_PATH! });
        if (response.data && typeof response.data === 'object' && 'type' in response.data && response.data.type === 'file') { /* ... handle success ... */
            if ('content' in response.data && response.data.content) { const content = Buffer.from(response.data.content, 'base64').toString('utf-8'); const sha = 'sha' in response.data ? response.data.sha : null; return { content, sha }; }
            else { console.warn(`${logPrefix} Path is a file but content missing.`); const sha = 'sha' in response.data ? response.data.sha : null; return { content: '[]', sha: sha }; }
        } else { console.warn(`${logPrefix} Path not a file.`); return { content: '[]', sha: null }; }
    } catch (error: unknown) { // Use unknown
        // Type guard for errors with status
        if (error && typeof error === 'object' && 'status' in error) {
            const status = (error as { status?: number }).status;
            const message = (error as { message?: string }).message ?? 'Unknown GitHub API Error';
            if (status === 404) {
                console.warn(`${logPrefix} File not found (404): ${FILE_PATH}. Returning empty.`);
                return { content: '[]', sha: null }; // Indicate non-existence
            }
            console.error(`${logPrefix} GitHub API Error: ${status} ${message}`);
            throw new Error(`Failed to fetch file from GitHub (${status}): ${message}`);
        } else if (error instanceof Error) { // Handle standard Error objects
            console.error(`${logPrefix} Generic Error: ${error.message}`);
            throw new Error(`Failed to fetch file: ${error.message}`);
        } else { // Handle other unknown error types
            console.error(`${logPrefix} Unknown error type caught:`, error);
            throw new Error(`An unknown error occurred while fetching the file.`);
        }
    }
}

async function updateFileContent(newContent: string, sha: string | null, commitMessage: string): Promise<void> {
    const logPrefix = '[updateFileContent]';
    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER!, repo: REPO_NAME!, path: FILE_PATH!, message: commitMessage,
            content: Buffer.from(newContent).toString('base64'), sha: sha ?? undefined,
        });
        console.log(`${logPrefix} Success: ${commitMessage}`);
    } catch (error: unknown) { // Use unknown
        // Type guard for errors with status
        let status: number | undefined;
        let message = 'Unknown error updating file.';
        if (error && typeof error === 'object') {
             if ('status' in error) status = (error as { status?: number }).status;
             if ('message' in error) message = (error as { message?: string }).message ?? message;
        } else if (error instanceof Error) {
            message = error.message;
        }

        console.error(`${logPrefix} GitHub API Error: ${status} ${message}`);
        if (status === 409) { throw new Error(`Failed update (409 Conflict): File updated concurrently. Refresh & try again.`); }
        if (status === 422) { throw new Error(`Failed update (422 Invalid Data/SHA): State mismatch or invalid data. Refresh & try again.`); }
        throw new Error(`Failed to update file on GitHub (${status}): ${message}`);
    }
}

async function fetchRawCalendarEventsForUpdate(): Promise<{ events: CalendarEvent[], sha: string | null }> {
    const logPrefix = '[fetchRawForUpdate]';
    const { content, sha } = await getFileContent(); // getFileContent now handles its errors better
    try {
        const events: CalendarEvent[] = JSON.parse(content || '[]');
        if (!Array.isArray(events)) throw new Error("Parsed content is not an array");
        return { events, sha };
    } catch (error: unknown) { // Use unknown
        let message = 'Failed to parse JSON';
        if (error instanceof Error) message = error.message;
        console.error(`${logPrefix} ${message}`);
        console.error(`${logPrefix} Raw content: ${content.substring(0, 200)}...`);
        return { events: [], sha };
    }
}


// --- Server Action: Update Existing Event (WITH CATCH BLOCK FIX) ---
export async function updateCalendarEventRefined(updatedEventData: CalendarEvent): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION update]';
    const validationResult = eventSchema.safeParse(updatedEventData);
    if (!validationResult.success) { /* ... handle validation error ... */ return { success: false, message: 'Invalid data provided.', errors: validationResult.error.issues }; }
    const validatedEvent = validationResult.data;
    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const eventIndex = currentEvents.findIndex((e) => e.id === validatedEvent.id);
        if (eventIndex === -1) { /* ... handle not found ... */ return { success: false, message: `Event ID ${validatedEvent.id} not found.` }; }
        currentEvents[eventIndex] = validatedEvent;
        const updatedJsonString = JSON.stringify(currentEvents, null, 2);
        const commitMessage = `Update event: ${validatedEvent.title} (ID: ${validatedEvent.id})`;
        await updateFileContent(updatedJsonString, sha, commitMessage);
        revalidatePath('/');
        return { success: true, message: 'Event updated successfully!' };
    } catch (error: unknown) { // Use unknown
        let message = 'Failed to update event';
        if (error instanceof Error) message = error.message;
        console.error(`${logPrefix} Error: ${message}`);
        return { success: false, message: message }; // Return error message
    }
}

// --- Server Action: Create New Event (WITH CATCH BLOCK FIX) ---
export async function createCalendarEvent(newEventData: Omit<CalendarEvent, 'id'>): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION create]';
    const validationResult = newEventSchema.safeParse(newEventData);
    if (!validationResult.success) { /* ... handle validation error ... */ return { success: false, message: 'Invalid data for new event.', errors: validationResult.error.issues }; }
    const validatedData = validationResult.data;
    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const newEvent: CalendarEvent = { ...validatedData, id: randomUUID() };
        const updatedEvents = [...currentEvents, newEvent];
        const updatedJsonString = JSON.stringify(updatedEvents, null, 2);
        const commitMessage = `Create event: ${newEvent.title} (ID: ${newEvent.id})`;
        await updateFileContent(updatedJsonString, sha, commitMessage);
        revalidatePath('/');
        return { success: true, message: 'Event created successfully!' };
    } catch (error: unknown) { // Use unknown
        let message = 'Failed to create event';
        if (error instanceof Error) message = error.message;
        console.error(`${logPrefix} Error: ${message}`);
        return { success: false, message: message };
    }
}

// --- Server Action: Delete Event (WITH CATCH BLOCK FIX) ---
export async function deleteCalendarEvent(data: { eventId: string }): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION delete]';
    const validationResult = deleteEventSchema.safeParse(data);
    if (!validationResult.success) { /* ... handle validation error ... */ return { success: false, message: 'Invalid Event ID for deletion.', errors: validationResult.error.issues }; }
    const { eventId } = validationResult.data;
    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const eventToDelete = currentEvents.find(e => e.id === eventId);
        if (!eventToDelete) { /* ... handle not found ... */ return { success: false, message: `Event ID ${eventId} not found.` }; }
        const updatedEvents = currentEvents.filter(event => event.id !== eventId);
        const updatedJsonString = JSON.stringify(updatedEvents, null, 2);
        const commitMessage = `Delete event: ${eventToDelete.title} (ID: ${eventId})`;
        await updateFileContent(updatedJsonString, sha, commitMessage);
        revalidatePath('/');
        return { success: true, message: 'Event deleted successfully!' };
    } catch (error: unknown) { // Use unknown
        let message = 'Failed to delete event';
        if (error instanceof Error) message = error.message;
        console.error(`${logPrefix} Error: ${message}`);
        return { success: false, message: message };
    }
}


// --- Function: Fetch Events for Display (WITH CATCH BLOCK FIX) ---
export async function fetchCalendarEvents(): Promise<BigCalendarEvent[]> {
  const logPrefix = '[fetchCalendarEvents]';
  try {
    const { content } = await getFileContent(); // getFileContent handles its errors
    if (!content || content.trim() === '' || content.trim() === '[]') { return []; }

    let data: CalendarEvent[];
    try { data = JSON.parse(content); }
    catch (error: unknown) { // Use unknown
        let message = 'JSON Parsing Error';
        if (error instanceof Error) message = error.message;
        console.error(`${logPrefix} !!! ${message}`);
        return [];
    }
    if (!Array.isArray(data)) { console.error(`${logPrefix} Parsed data is not an array.`); return []; }

    const processedEvents: BigCalendarEvent[] = [];
    for (const event of data) { /* ... process and push valid events ... */
        if (!event || !event.id || !event.start || !event.end) { continue; }
        const start = new Date(event.start); const end = new Date(event.end);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start < end) {
            processedEvents.push({ id: event.id, title: event.title, status: event.status, notes: event.notes, start: start, end: end });
        } else { console.warn(`${logPrefix} Skipping Event ID ${event.id} invalid date/range.`); }
    }
    return processedEvents;
  } catch (error: unknown) { // Use unknown
    let message = 'Unexpected Error during fetch/process';
    if (error instanceof Error) message = error.message;
    console.error(`${logPrefix} !!! ${message}`);
    console.error(error); // Log full error object if needed
    return []; // Return empty array on any major error
  }
}