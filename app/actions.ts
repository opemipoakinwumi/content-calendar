// app/actions.ts
'use server';

import { Octokit } from '@octokit/rest';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { randomUUID } from 'crypto';

export interface CalendarEvent {
    id: string;
    title: string;
    start: string; // Approval Date (ISO String)
    end: string;   // Publishing Date (ISO String)
    status: string;
    notes?: string | null; // Keep optional/nullable
    attachment?: string | null; // <-- ADDED: Optional attachment field
}

export interface BigCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> {
    start: Date; // Approval Date (Date object)
    end: Date;   // Publishing Date (Date object)
    // attachment is inherited and correctly typed as string | null | undefined
}


// --- Zod Schemas ---
// ADD 'attachment' to the base schema
const baseEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1, 'Title is required'),
  start: z.string().datetime({ message: 'Invalid approval date/time format (e.g., YYYY-MM-DDTHH:mm)' }), // Updated message
  end: z.string().datetime({ message: 'Invalid publishing date/time format (e.g., YYYY-MM-DDTHH:mm)' }),   // Updated message
  status: z.string().min(1, 'Status is required'),
  notes: z.string().optional().nullable(), // Allow empty string or null
  attachment: z.string().optional().nullable(), // <-- ADDED: Optional and nullable attachment field
});

// Refine logic needs to correctly compare dates after parsing
const dateRefinement = (data: { start: string, end: string }) => {
    try {
        return new Date(data.start) < new Date(data.end);
    } catch (e) {
        return false; // Invalid date strings would fail comparison
    }
};

const newEventSchema = baseEventSchema
    .omit({ id: true })
    .refine(dateRefinement, {
        message: "Publishing date must be after approval date", // <-- (Maybe intended location?)
        path: ["end"],
    });

const eventSchema = baseEventSchema // <-- (Or here?)
    .refine(dateRefinement, {
        message: "Publishing date must be after approval date", // <-- (Or here?)
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

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME || !FILE_PATH) {
    console.error("CRITICAL ERROR: Missing GitHub environment variables!");
    // Throwing error prevents app start/build if config is missing
    throw new Error('Missing GitHub environment variables. Check .env.local or deployment environment variables.');
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });


// --- GitHub API Helper Functions (Error handling improved) ---

// Function to safely get file content and SHA
async function getFileContent(): Promise<{ content: string; sha: string | null }> {
    const logPrefix = '[getFileContent]';
    try {
        console.log(`${logPrefix} Fetching file: ${REPO_OWNER}/${REPO_NAME}/${FILE_PATH}`);
        const response = await octokit.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: FILE_PATH,
            // Cache busting might be useful if GitHub's cache is aggressive
            // headers: { 'If-None-Match': '' }
        });

        // Check if the response data is an object representing a file
        if (response.data && typeof response.data === 'object' && 'type' in response.data && response.data.type === 'file') {
            const fileData = response.data as { content?: string; sha: string }; // Type assertion for clarity
            if (fileData.content) {
                const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
                console.log(`${logPrefix} File found. SHA: ${fileData.sha}. Content length: ${content.length}`);
                return { content, sha: fileData.sha };
            } else {
                console.warn(`${logPrefix} File found but content is missing or empty. SHA: ${fileData.sha}`);
                return { content: '[]', sha: fileData.sha }; // Treat as empty array if content missing
            }
        } else {
            // Handle cases where the path exists but is not a file (e.g., directory)
            console.warn(`${logPrefix} Path exists but is not a file: ${FILE_PATH}`);
            return { content: '[]', sha: null }; // Treat as empty array
        }
    } catch (error: any) { // Catch 'any' for easier status checking
        if (error.status === 404) {
            console.warn(`${logPrefix} File not found (404) at path: ${FILE_PATH}. Assuming empty.`);
            return { content: '[]', sha: null }; // File doesn't exist, treat as empty array, no SHA
        } else {
            // Log other errors and re-throw a more specific error
            const status = error.status || 'Unknown';
            const message = error.message || 'Failed to fetch file content';
            console.error(`${logPrefix} GitHub API Error (${status}): ${message}`, error);
            throw new Error(`Failed to fetch file from GitHub (${status}). ${message}`);
        }
    }
}

// Function to safely update file content
async function updateFileContent(newContent: string, sha: string | null, commitMessage: string): Promise<void> {
    const logPrefix = '[updateFileContent]';
    try {
        console.log(`${logPrefix} Attempting to update file. SHA: ${sha ?? 'None (creating new)'}`);
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: FILE_PATH,
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64'),
            sha: sha ?? undefined, // Use undefined if SHA is null (for file creation)
        });
        console.log(`${logPrefix} File update successful: ${commitMessage}`);
    } catch (error: any) { // Catch 'any' for easier status checking
        const status = error.status || 'Unknown';
        const message = error.message || 'Failed to update file content';
        console.error(`${logPrefix} GitHub API Error (${status}): ${message}`, error);

        // Provide more specific user-facing error messages based on status
        if (status === 409) { // Conflict - SHA mismatch
            throw new Error(`Update Conflict (409): The file was modified by someone else. Please refresh and try again.`);
        } else if (status === 422) { // Unprocessable Entity - often bad SHA or empty file commit attempt
             throw new Error(`Update Failed (422): Could not process the update. If the file was previously empty, this might be expected on first save. Otherwise, check data or refresh.`);
        } else {
            throw new Error(`Failed to update file on GitHub (${status}). ${message}`);
        }
    }
}

// Helper to get current events AND sha for updates/creates/deletes
async function fetchRawCalendarEventsForUpdate(): Promise<{ events: CalendarEvent[], sha: string | null }> {
    const logPrefix = '[fetchRawForUpdate]';
    // getFileContent now includes better error handling
    const { content, sha } = await getFileContent();
    try {
        // Ensure content is valid JSON array before parsing
        const events: CalendarEvent[] = JSON.parse(content || '[]');
        if (!Array.isArray(events)) {
            console.error(`${logPrefix} Parsed content is not an array. Content: ${content.substring(0,100)}...`);
            throw new Error("Invalid data structure in storage file: Expected an array.");
        }
        console.log(`${logPrefix} Parsed ${events.length} events. SHA: ${sha}`);
        return { events, sha };
    } catch (error) { // Catch JSON parsing errors specifically
        console.error(`${logPrefix} Failed to parse JSON content. SHA: ${sha}`, error);
        console.error(`${logPrefix} Raw content causing error: ${content.substring(0, 200)}...`);
        // Depending on policy, you might want to throw here or return empty with SHA
        // Returning empty allows potential recovery if the file is manually fixed later
         throw new Error(`Failed to parse the calendar data file. Please check its content on GitHub.`);
        // return { events: [], sha }; // Alternative: return empty, potentially losing data if saved over
    }
}


// --- Server Action: Update Existing Event ---
export async function updateCalendarEventRefined(updatedEventData: CalendarEvent): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION update]';
    // Validate incoming data against the schema (which now includes attachment)
    const validationResult = eventSchema.safeParse(updatedEventData);

    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten().fieldErrors);
        return { success: false, message: 'Invalid data provided.', errors: validationResult.error.issues };
    }
    // validatedEvent now includes the (optional) attachment field
    const validatedEvent = validationResult.data;
    console.log(`${logPrefix} Attempting update for ID: ${validatedEvent.id}`);

    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const eventIndex = currentEvents.findIndex((e) => e.id === validatedEvent.id);

        if (eventIndex === -1) {
            console.warn(`${logPrefix} Event ID ${validatedEvent.id} not found for update.`);
            return { success: false, message: `Event ID ${validatedEvent.id} not found. It might have been deleted.` };
        }

        // Replace the old event with the validated new data (includes attachment)
        currentEvents[eventIndex] = validatedEvent;
        const updatedJsonString = JSON.stringify(currentEvents, null, 2); // Pretty print JSON
        const commitMessage = `Update event: ${validatedEvent.title} (ID: ${validatedEvent.id})`;

        await updateFileContent(updatedJsonString, sha, commitMessage);

        revalidatePath('/'); // Revalidate the cache for the homepage/calendar page
        console.log(`${logPrefix} Update successful for ID: ${validatedEvent.id}`);
        return { success: true, message: 'Event updated successfully!' };

    } catch (error: unknown) { // Catch potential errors from fetch or update helpers
        const message = error instanceof Error ? error.message : 'An unexpected error occurred during update.';
        console.error(`${logPrefix} Error during update process for ID ${validatedEvent.id}: ${message}`, error);
        return { success: false, message: message }; // Return specific error message from helpers or generic one
    }
}


// --- Server Action: Create New Event ---
export async function createCalendarEvent(newEventData: Omit<CalendarEvent, 'id'>): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION create]';
    // Validate incoming data (which now includes optional attachment)
    const validationResult = newEventSchema.safeParse(newEventData);

    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten().fieldErrors);
        return { success: false, message: 'Invalid data for new event.', errors: validationResult.error.issues };
    }
    // validatedData includes the (optional) attachment
    const validatedData = validationResult.data;
    const newEventId = randomUUID(); // Generate unique ID
    console.log(`${logPrefix} Attempting create for Title: ${validatedData.title}, New ID: ${newEventId}`);

    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();

        // Construct the full event object including the new ID and validated data
        const newEvent: CalendarEvent = { ...validatedData, id: newEventId };

        const updatedEvents = [...currentEvents, newEvent]; // Add the new event
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
    // Validate the event ID
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
            // It's arguably not a failure if it's already gone, return success but maybe different message?
            // return { success: true, message: `Event ID ${eventId} was already deleted.` };
            return { success: false, message: `Event ID ${eventId} not found.` }; // Or treat as failure
        }

        // Filter out the event to be deleted
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
// Fetches events and transforms them into the format needed by react-big-calendar (with Date objects)
export async function fetchCalendarEvents(): Promise<BigCalendarEvent[]> {
  const logPrefix = '[fetchCalendarEvents]';
  console.log(`${logPrefix} Fetching events for display...`);
  try {
    // Use the robust getFileContent which handles 404s etc.
    const { content } = await getFileContent();

    // Handle empty or potentially invalid content gracefully
    if (!content || content.trim() === '' || content.trim() === '[]') {
        console.log(`${logPrefix} No events found or file empty.`);
        return [];
    }

    let storedEvents: CalendarEvent[];
    try {
        storedEvents = JSON.parse(content);
        if (!Array.isArray(storedEvents)) {
             console.error(`${logPrefix} Parsed data is not an array.`);
             throw new Error("Invalid data format."); // Throw to be caught below
        }
    } catch (error) {
        console.error(`${logPrefix} Error parsing JSON from storage file.`, error);
        // Return empty array or re-throw depending on desired behavior on data corruption
        return []; // Gracefully return empty on parse error
    }

    const processedEvents: BigCalendarEvent[] = [];
    for (const event of storedEvents) {
        // Basic validation for core fields before processing
        if (!event || typeof event !== 'object' || !event.id || !event.start || !event.end || !event.title || !event.status) {
            console.warn(`${logPrefix} Skipping invalid event object:`, event);
            continue;
        }

        try {
            const start = new Date(event.start); // Parse Approval Date string
            const end = new Date(event.end);     // Parse Publishing Date string

            // Validate parsed dates
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                console.warn(`${logPrefix} Skipping Event ID ${event.id} due to invalid date format (Start: "${event.start}", End: "${event.end}").`);
                continue; // Skip if dates are invalid
            }
            // Note: BigCalendar often handles start === end, but refining here ensures end > start
             if (start >= end) {
                console.warn(`${logPrefix} Skipping Event ID ${event.id} because publishing date is not after approval date.`);
                 continue;
             }

            // Push the transformed event, including the attachment field
            processedEvents.push({
                id: event.id,
                title: event.title,
                status: event.status,
                notes: event.notes, // Pass through notes
                attachment: event.attachment, // <-- ADDED: Pass through attachment
                start: start, // Use Date object
                end: end,     // Use Date object
            });
        } catch (dateError) {
             console.warn(`${logPrefix} Error processing dates for Event ID ${event.id}.`, dateError);
             // Skip this event if date processing fails
             continue;
        }
    }

    console.log(`${logPrefix} Successfully processed ${processedEvents.length} events for display.`);
    return processedEvents;

  } catch (error: unknown) { // Catch errors from getFileContent or unexpected issues
    const message = error instanceof Error ? error.message : 'An unexpected error occurred while fetching events.';
    console.error(`${logPrefix} Failed to fetch or process calendar events: ${message}`, error);
    return []; // Return empty array on any major error during the fetch process
  }
}