'use server';

import { Octokit } from '@octokit/rest';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// --- Interfaces ---
export interface CalendarEvent {
    id: string;
    title: string;
    start: string; // Approval Date (ISO String)
    end: string;   // Publishing Date (ISO String)
    status: string;
    notes?: string | null;
    attachment?: string | null;
}

export interface BigCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> {
    start: Date; // Approval Date (Date object)
    end: Date;   // Publishing Date (Date object)
}


// --- Zod Schemas ---
const baseEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1 /* 'Title is required' */),
  start: z.string().datetime(/*{ message: 'Invalid approval date/time format (e.g., YYYY-MM-DDTHH:mm)' }*/),
  end: z.string().datetime(/*{ message: 'Invalid publishing date/time format (e.g., YYYY-MM-DDTHH:mm)' }*/),
  status: z.string().min(1 /* 'Status is required' */),
  notes: z.string().optional().nullable(),
  attachment: z.string().optional().nullable(),
});

const dateRefinement = (data: { start: string, end: string }) => {
    try {
        return new Date(data.start) < new Date(data.end);
    } catch (_e) { // eslint-disable-line @typescript-eslint/no-unused-vars
        return false;
    }
};

const newEventSchema = baseEventSchema
    .omit({ id: true })
    .refine(dateRefinement, {
        message: "Publishing date must be after approval date",
        path: ["end"],
    });

const eventSchema = baseEventSchema
    .refine(dateRefinement, {
        message: "Publishing date must be after approval date",
        path: ["end"],
    });

const deleteEventSchema = z.object({
  eventId: z.string().min(1, "Event ID is required for deletion"),
});


// --- Environment Variables & Octokit Setup ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const REPO_NAME = process.env.GITHUB_REPO_NAME;
const FILE_PATH = process.env.GITHUB_FILE_PATH;

// This check ensures the variables are defined if the code proceeds
if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME || !FILE_PATH) {
    console.error("CRITICAL ERROR: Missing GitHub environment variables!");
    throw new Error('Missing GitHub environment variables. Check .env.local or deployment environment variables.');
}
const octokit = new Octokit({ auth: GITHUB_TOKEN });


// --- GitHub API Helper Functions ---
async function getFileContent(): Promise<{ content: string; sha: string | null }> {
    const logPrefix = '[getFileContent]';
    try {
        console.log(`${logPrefix} Fetching file: ${REPO_OWNER}/${REPO_NAME}/${FILE_PATH}`);
        // Use non-null assertion operator (!) because the check above guarantees they exist
        const response = await octokit.repos.getContent({
            owner: REPO_OWNER!, // <-- ADDED !
            repo: REPO_NAME!,  // <-- ADDED !
            path: FILE_PATH!,  // <-- ADDED !
        });
        if (response.data && typeof response.data === 'object' && 'type' in response.data && response.data.type === 'file') {
            const fileData = response.data as { content?: string; sha: string };
            if (fileData.content) {
                const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
                console.log(`${logPrefix} File found. SHA: ${fileData.sha}. Content length: ${content.length}`);
                return { content, sha: fileData.sha };
            } else {
                console.warn(`${logPrefix} File found but content is missing or empty. SHA: ${fileData.sha}`);
                return { content: '[]', sha: fileData.sha };
            }
        } else {
            console.warn(`${logPrefix} Path exists but is not a file: ${FILE_PATH}`);
            return { content: '[]', sha: null };
        }
    } catch (error: unknown) {
        let status: number | string = 'Unknown';
        let message = 'Failed to fetch file content';
        if (error && typeof error === 'object') {
            if ('status' in error) status = (error as { status?: number }).status ?? 'Unknown';
             if ('message' in error) message = (error as { message?: string }).message ?? message;
        } else if (error instanceof Error) {
            message = error.message;
        }
        if (status === 404) {
            console.warn(`${logPrefix} File not found (404) at path: ${FILE_PATH}. Assuming empty.`);
            return { content: '[]', sha: null };
        } else {
            console.error(`${logPrefix} GitHub API Error (${status}): ${message}`, error);
            throw new Error(`Failed to fetch file from GitHub (${status}). ${message}`);
        }
    }
}

async function updateFileContent(newContent: string, sha: string | null, commitMessage: string): Promise<void> {
    const logPrefix = '[updateFileContent]';
    try {
        console.log(`${logPrefix} Attempting to update file. SHA: ${sha ?? 'None (creating new)'}`);
         // Use non-null assertion operator (!) because the check above guarantees they exist
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER!, // <-- ADDED !
            repo: REPO_NAME!,  // <-- ADDED !
            path: FILE_PATH!,  // <-- ADDED !
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64'),
            sha: sha ?? undefined,
        });
        console.log(`${logPrefix} File update successful: ${commitMessage}`);
    } catch (error: unknown) {
        let status: number | string = 'Unknown';
        let message = 'Failed to update file content';
        if (error && typeof error === 'object') {
            if ('status' in error) status = (error as { status?: number }).status ?? 'Unknown';
             if ('message' in error) message = (error as { message?: string }).message ?? message;
        } else if (error instanceof Error) {
            message = error.message;
        }
        console.error(`${logPrefix} GitHub API Error (${status}): ${message}`, error);
        if (status === 409) {
            throw new Error(`Update Conflict (409): The file was modified by someone else. Please refresh and try again.`);
        } else if (status === 422) {
             throw new Error(`Update Failed (422): Could not process the update. If the file was previously empty, this might be expected on first save. Otherwise, check data or refresh.`);
        } else {
            throw new Error(`Failed to update file on GitHub (${status}). ${message}`);
        }
    }
}

async function fetchRawCalendarEventsForUpdate(): Promise<{ events: CalendarEvent[], sha: string | null }> {
    const logPrefix = '[fetchRawForUpdate]';
    const { content, sha } = await getFileContent();
    try {
        const events: CalendarEvent[] = JSON.parse(content || '[]');
        if (!Array.isArray(events)) {
            console.error(`${logPrefix} Parsed content is not an array. Content: ${content.substring(0,100)}...`);
            throw new Error("Invalid data structure in storage file: Expected an array.");
        }
        console.log(`${logPrefix} Parsed ${events.length} events. SHA: ${sha}`);
        return { events, sha };
    } catch (error) {
        console.error(`${logPrefix} Failed to parse JSON content. SHA: ${sha}`, error);
        console.error(`${logPrefix} Raw content causing error: ${content.substring(0, 200)}...`);
         throw new Error(`Failed to parse the calendar data file. Please check its content on GitHub.`);
    }
}


// --- Server Action: Update Existing Event ---
export async function updateCalendarEventRefined(updatedEventData: CalendarEvent): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION update]';
    const validationResult = eventSchema.safeParse(updatedEventData);

    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten().fieldErrors);
        return { success: false, message: 'Invalid data provided.', errors: validationResult.error.issues };
    }
    const validatedEvent = validationResult.data;
    console.log(`${logPrefix} Attempting update for ID: ${validatedEvent.id}`);

    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const eventIndex = currentEvents.findIndex((e) => e.id === validatedEvent.id);

        if (eventIndex === -1) {
            console.warn(`${logPrefix} Event ID ${validatedEvent.id} not found for update.`);
            return { success: false, message: `Event ID ${validatedEvent.id} not found. It might have been deleted.` };
        }
        currentEvents[eventIndex] = validatedEvent;
        const updatedJsonString = JSON.stringify(currentEvents, null, 2);
        const commitMessage = `Update event: ${validatedEvent.title} (ID: ${validatedEvent.id})`;
        await updateFileContent(updatedJsonString, sha, commitMessage);
        revalidatePath('/');
        console.log(`${logPrefix} Update successful for ID: ${validatedEvent.id}`);
        return { success: true, message: 'Event updated successfully!' };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred during update.';
        console.error(`${logPrefix} Error during update process for ID ${validatedEvent.id}: ${message}`, error);
        return { success: false, message: message };
    }
}

// --- Server Action: Create New Event ---
export async function createCalendarEvent(newEventData: Omit<CalendarEvent, 'id'>): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION create]';
    const validationResult = newEventSchema.safeParse(newEventData);
    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten().fieldErrors);
        return { success: false, message: 'Invalid data for new event.', errors: validationResult.error.issues };
    }
    const validatedData = validationResult.data;
    const newEventId = randomUUID();
    console.log(`${logPrefix} Attempting create for Title: ${validatedData.title}, New ID: ${newEventId}`);
    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const newEvent: CalendarEvent = { ...validatedData, id: newEventId };
        const updatedEvents = [...currentEvents, newEvent];
        const updatedJsonString = JSON.stringify(updatedEvents, null, 2);
        const commitMessage = `Create event: ${newEvent.title} (ID: ${newEvent.id})`;
        await updateFileContent(updatedJsonString, sha, commitMessage);
        revalidatePath('/');
        console.log(`${logPrefix} Create successful for ID: ${newEvent.id}`);
        return { success: true, message: 'Event created successfully!' };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred during creation.';
        console.error(`${logPrefix} Error during create process for Title ${validatedData.title}: ${message}`, error);
        return { success: false, message: message };
    }
}

// --- Server Action: Delete Event ---
export async function deleteCalendarEvent(data: { eventId: string }): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION delete]';
    const validationResult = deleteEventSchema.safeParse(data);
    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten().fieldErrors);
        return { success: false, message: 'Invalid Event ID for deletion.', errors: validationResult.error.issues };
    }
    const { eventId } = validationResult.data;
    console.log(`${logPrefix} Attempting delete for ID: ${eventId}`);
    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const eventToDelete = currentEvents.find(e => e.id === eventId);
        if (!eventToDelete) {
            console.warn(`${logPrefix} Event ID ${eventId} not found for deletion.`);
            return { success: false, message: `Event ID ${eventId} not found.` };
        }
        const updatedEvents = currentEvents.filter(event => event.id !== eventId);
        const updatedJsonString = JSON.stringify(updatedEvents, null, 2);
        const commitMessage = `Delete event: ${eventToDelete.title} (ID: ${eventId})`;
        await updateFileContent(updatedJsonString, sha, commitMessage);
        revalidatePath('/');
        console.log(`${logPrefix} Delete successful for ID: ${eventId}`);
        return { success: true, message: 'Event deleted successfully!' };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred during deletion.';
        console.error(`${logPrefix} Error during delete process for ID ${eventId}: ${message}`, error);
        return { success: false, message: message };
    }
}


// --- Function: Fetch Events for Display ---
export async function fetchCalendarEvents(): Promise<BigCalendarEvent[]> {
  const logPrefix = '[fetchCalendarEvents]';
  console.log(`${logPrefix} Fetching events for display...`);
  try {
    const { content } = await getFileContent();
    if (!content || content.trim() === '' || content.trim() === '[]') {
        console.log(`${logPrefix} No events found or file empty.`);
        return [];
    }
    let storedEvents: CalendarEvent[];
    try {
        storedEvents = JSON.parse(content);
        if (!Array.isArray(storedEvents)) {
             console.error(`${logPrefix} Parsed data is not an array.`);
             throw new Error("Invalid data format.");
        }
    } catch (error) {
        console.error(`${logPrefix} Error parsing JSON from storage file.`, error);
        return [];
    }
    const processedEvents: BigCalendarEvent[] = [];
    for (const event of storedEvents) {
        if (!event || typeof event !== 'object' || !event.id || !event.start || !event.end || !event.title || !event.status) {
            console.warn(`${logPrefix} Skipping invalid event object:`, event);
            continue;
        }
        try {
            const start = new Date(event.start);
            const end = new Date(event.end);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                console.warn(`${logPrefix} Skipping Event ID ${event.id} due to invalid date format (Start: "${event.start}", End: "${event.end}").`);
                continue;
            }
             if (start >= end) {
                console.warn(`${logPrefix} Skipping Event ID ${event.id} because publishing date is not after approval date.`);
                 continue;
             }
            processedEvents.push({
                id: event.id, title: event.title, status: event.status, notes: event.notes,
                attachment: event.attachment, // Pass through attachment
                start: start, end: end,
            });
        } catch (dateError) {
             console.warn(`${logPrefix} Error processing dates for Event ID ${event.id}.`, dateError);
             continue;
        }
    }
    console.log(`${logPrefix} Successfully processed ${processedEvents.length} events for display.`);
    return processedEvents;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred while fetching events.';
    console.error(`${logPrefix} Failed to fetch or process calendar events: ${message}`, error);
    return [];
  }
}