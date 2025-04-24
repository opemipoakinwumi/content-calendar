// app/actions.ts
'use server';

import { Octokit } from '@octokit/rest';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { randomUUID } from 'crypto'; // Import for generating unique IDs

// --- Interfaces ---
// Base event structure (used in JSON and actions with string dates)
export interface CalendarEvent {
    id: string;
    title: string;
    start: string; // ISO 8601 string format (e.g., "2024-09-25T10:00:00Z")
    end: string;   // ISO 8601 string format
    status: string;
    notes?: string;
}
// Event structure for React Big Calendar (uses Date objects)
export interface BigCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> {
    start: Date;
    end: Date;
}

// --- Zod Schemas (Corrected Structure) ---
// 1. Define the base object structure first
const baseEventSchema = z.object({
  id: z.string().min(1), // Include ID here for the base
  title: z.string().min(1, 'Title is required'),
  start: z.string().datetime({ message: 'Invalid start date/time format (YYYY-MM-DDTHH:mm:ssZ)' }),
  end: z.string().datetime({ message: 'Invalid end date/time format (YYYY-MM-DDTHH:mm:ssZ)' }),
  status: z.string().min(1, 'Status is required'),
  notes: z.string().optional(),
});

// 2. Define the schema for NEW events by omitting 'id' from the BASE schema THEN refining
const newEventSchema = baseEventSchema.omit({ id: true })
  .refine(data => new Date(data.start) < new Date(data.end), {
      message: "End date must be after start date", path: ["end"],
  });

// 3. Define the schema for EXISTING events (used for updates/validation)
//    by adding the refinement to the BASE schema (which includes 'id')
const eventSchema = baseEventSchema
  .refine(data => new Date(data.start) < new Date(data.end), {
      message: "End date must be after start date", path: ["end"],
  });

// Schema for deleting (just needs ID)
const deleteEventSchema = z.object({
    eventId: z.string().min(1, "Event ID is required for deletion"),
});
// --- END Zod Schemas ---


// --- Environment Variables & Octokit Setup ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const REPO_NAME = process.env.GITHUB_REPO_NAME;
const FILE_PATH = process.env.GITHUB_FILE_PATH;

// Validate environment variables on server start
if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME || !FILE_PATH) {
  console.error("CRITICAL ERROR: Missing one or more GitHub environment variables (GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME, GITHUB_FILE_PATH).");
  throw new Error('Missing GitHub environment variables needed for Server Actions. Check server logs.');
}
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- GitHub API Helper Functions ---
// Fetches the current content and SHA of the JSON file
async function getFileContent(): Promise<{ content: string; sha: string | null }> {
    const logPrefix = '[getFileContent]';
    try {
        const response = await octokit.repos.getContent({ owner: REPO_OWNER!, repo: REPO_NAME!, path: FILE_PATH! });
        if (response.data && typeof response.data === 'object' && 'type' in response.data && response.data.type === 'file') {
            if ('content' in response.data && response.data.content) {
                const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
                const sha = 'sha' in response.data ? response.data.sha : null;
                return { content, sha };
            } else {
                console.warn(`${logPrefix} Path is a file but content is missing or empty.`);
                const sha = 'sha' in response.data ? response.data.sha : null;
                return { content: '[]', sha: sha }; // Return empty array string
            }
        } else {
             console.warn(`${logPrefix} Path ${FILE_PATH} is not a file. Found type: ${'type' in response.data ? response.data.type : 'unknown'}`);
             return { content: '[]', sha: null }; // Treat as non-existent if not a file
        }
    } catch (error: any) {
        if (error?.status === 404) {
            console.warn(`${logPrefix} File not found (404): ${FILE_PATH}. Returning empty.`);
            return { content: '[]', sha: null }; // Indicate non-existence
        }
        console.error(`${logPrefix} GitHub API Error: ${error?.status} ${error?.message}`);
        throw new Error(`Failed to fetch file from GitHub (${error?.status}): ${error?.message}`);
    }
}

// Updates or creates the JSON file on GitHub
async function updateFileContent(newContent: string, sha: string | null, commitMessage: string): Promise<void> {
    const logPrefix = '[updateFileContent]';
    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER!, repo: REPO_NAME!, path: FILE_PATH!, message: commitMessage,
            content: Buffer.from(newContent).toString('base64'),
            sha: sha ?? undefined, // Use undefined for creation if sha is null
        });
        console.log(`${logPrefix} Success: ${commitMessage}`);
    } catch (error: any) {
        console.error(`${logPrefix} GitHub API Error: ${error?.status} ${error?.message}`);
        if (error.status === 409) { throw new Error(`Failed update (409 Conflict): File updated concurrently. Refresh & try again.`); }
        if (error.status === 422) { throw new Error(`Failed update (422 Invalid Data/SHA): State mismatch or invalid data. Refresh & try again.`); }
        throw new Error(`Failed to update file on GitHub (${error?.status}): ${error.message}`);
    }
}

// --- Helper to Fetch and Parse Events for Updates/Creates/Deletes ---
async function fetchRawCalendarEventsForUpdate(): Promise<{ events: CalendarEvent[], sha: string | null }> {
    const logPrefix = '[fetchRawForUpdate]';
    const { content, sha } = await getFileContent();
    try {
        const events: CalendarEvent[] = JSON.parse(content || '[]'); // Default to empty array if content is null/empty
        if (!Array.isArray(events)) throw new Error("Parsed content is not an array");
        return { events, sha };
    } catch (parseError: any) {
        console.error(`${logPrefix} Failed to parse JSON: ${parseError.message}`);
        console.error(`${logPrefix} Raw content causing error: ${content.substring(0, 200)}...`);
        // Return empty array but keep original sha status if parsing failed
        return { events: [], sha };
    }
}


// --- Server Action: Update Existing Event ---
export async function updateCalendarEventRefined(
  updatedEventData: CalendarEvent // Expect full event including ID
): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION update]';
    // console.log(`${logPrefix} Received for ID: ${updatedEventData.id}`);
    // Validate the incoming data using the schema that expects an ID
    const validationResult = eventSchema.safeParse(updatedEventData);
    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten());
        return { success: false, message: 'Invalid data provided.', errors: validationResult.error.issues };
    }
    const validatedEvent = validationResult.data; // Data is valid and includes ID

    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const eventIndex = currentEvents.findIndex((e) => e.id === validatedEvent.id);
        if (eventIndex === -1) {
            console.warn(`${logPrefix} Event ID ${validatedEvent.id} not found for update.`);
            return { success: false, message: `Event ID ${validatedEvent.id} not found.` };
        }
        currentEvents[eventIndex] = validatedEvent;
        const updatedJsonString = JSON.stringify(currentEvents, null, 2);
        const commitMessage = `Update event: ${validatedEvent.title} (ID: ${validatedEvent.id})`;
        await updateFileContent(updatedJsonString, sha, commitMessage);
        revalidatePath('/');
        console.log(`${logPrefix} Success for ID: ${validatedEvent.id}`);
        return { success: true, message: 'Event updated successfully!' };
    } catch (error: any) {
        console.error(`${logPrefix} Error: ${error.message}`);
        return { success: false, message: `Failed to update event: ${error.message}` };
    }
}

// --- Server Action: Create New Event ---
export async function createCalendarEvent(
    newEventData: Omit<CalendarEvent, 'id'> // Expect data without an ID
): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION create]';
    // console.log(`${logPrefix} Received new event data: ${newEventData.title}`);
    // Validate the incoming data using the schema that omits the ID
    const validationResult = newEventSchema.safeParse(newEventData);
    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten());
        return { success: false, message: 'Invalid data for new event.', errors: validationResult.error.issues };
    }
    const validatedData = validationResult.data; // Valid data (without ID)

    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const newEvent: CalendarEvent = {
            ...validatedData,
            id: randomUUID(), // Generate a unique ID
        };
        const updatedEvents = [...currentEvents, newEvent];
        const updatedJsonString = JSON.stringify(updatedEvents, null, 2);
        const commitMessage = `Create event: ${newEvent.title} (ID: ${newEvent.id})`;
        await updateFileContent(updatedJsonString, sha, commitMessage);
        revalidatePath('/');
        console.log(`${logPrefix} Success for ID: ${newEvent.id}`);
        return { success: true, message: 'Event created successfully!' };
    } catch (error: any) {
        console.error(`${logPrefix} Error: ${error.message}`);
        return { success: false, message: `Failed to create event: ${error.message}` };
    }
}

// --- Server Action: Delete Event ---
export async function deleteCalendarEvent(
    data: { eventId: string } // Expect an object containing the ID to delete
): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION delete]';
    // console.log(`${logPrefix} Received request for ID: ${data.eventId}`);
    // Validate the incoming request (ensure eventId is provided)
    const validationResult = deleteEventSchema.safeParse(data);
    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten());
        return { success: false, message: 'Invalid Event ID for deletion.', errors: validationResult.error.issues };
    }
    const { eventId } = validationResult.data; // Validated event ID

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
        console.log(`${logPrefix} Success for ID: ${eventId}`);
        return { success: true, message: 'Event deleted successfully!' };
    } catch (error: any) {
        console.error(`${logPrefix} Error: ${error.message}`);
        return { success: false, message: `Failed to delete event: ${error.message}` };
    }
}


// --- Function: Fetch Events for Display (Called by Page Component) ---
// Fetches events and converts dates to Date objects for the calendar component
export async function fetchCalendarEvents(): Promise<BigCalendarEvent[]> {
  const logPrefix = '[fetchCalendarEvents]';
  try {
    const { content } = await getFileContent();
    if (!content || content.trim() === '' || content.trim() === '[]') { return []; }

    let data: CalendarEvent[];
    try { data = JSON.parse(content); }
    catch (parseError: any) { console.error(`${logPrefix} !!! JSON Parsing Error: ${parseError.message}`); return []; }

    if (!Array.isArray(data)) { console.error(`${logPrefix} Parsed data is not an array.`); return []; }

    const processedEvents: BigCalendarEvent[] = [];
    for (const event of data) {
        if (!event || !event.id || !event.start || !event.end) { continue; } // Basic validation
        const start = new Date(event.start);
        const end = new Date(event.end);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start < end) {
            processedEvents.push({ // Reconstruct to match BigCalendarEvent type
                id: event.id, title: event.title, status: event.status, notes: event.notes,
                start: start, end: end,
            });
        } else {
            console.warn(`${logPrefix} Skipping Event ID ${event.id} due to invalid date(s) or start >= end. Start: '${event.start}', End: '${event.end}'`);
        }
    }
    return processedEvents;
  } catch (error: any) {
    console.error(`${logPrefix} !!! Unexpected Error during fetch/process: ${error.message}`);
    return []; // Return empty array on any major error
  }
}