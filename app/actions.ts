// app/actions.ts
'use server';

import { Octokit } from '@octokit/rest';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

// --- Interfaces ---
export interface CalendarEvent { id: string; title: string; start: string; end: string; status: string; notes?: string; }
interface BigCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> { start: Date; end: Date; }

// --- Zod Schema ---
const eventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1, 'Title is required'),
  start: z.string().datetime({ message: 'Invalid start date/time format (YYYY-MM-DDTHH:mm:ssZ)' }),
  end: z.string().datetime({ message: 'Invalid end date/time format (YYYY-MM-DDTHH:mm:ssZ)' }),
  status: z.string().min(1, 'Status is required'),
  notes: z.string().optional(),
}).refine(data => new Date(data.start) < new Date(data.end), {
    message: "End date must be after start date",
    path: ["end"],
});

// --- Environment Variables & Octokit Setup ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const REPO_NAME = process.env.GITHUB_REPO_NAME;
const FILE_PATH = process.env.GITHUB_FILE_PATH;

// --- Log Environment Variables on Server Startup ---
console.log('--- [ACTIONS Server Startup Log] ---');
console.log(`REPO_OWNER: ${REPO_OWNER}`);
console.log(`REPO_NAME: ${REPO_NAME}`);
console.log(`FILE_PATH: ${FILE_PATH}`);
console.log(`GITHUB_TOKEN Loaded: ${!!GITHUB_TOKEN}`); // Avoid logging the token itself
console.log('-------------------------------------');
// --- End Env Var Log ---

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME || !FILE_PATH) {
  console.error("CRITICAL ERROR: Missing GitHub environment variables!");
  if (!GITHUB_TOKEN) console.error("- GITHUB_TOKEN is missing");
  if (!REPO_OWNER) console.error("- GITHUB_REPO_OWNER is missing");
  if (!REPO_NAME) console.error("- GITHUB_REPO_NAME is missing");
  if (!FILE_PATH) console.error("- GITHUB_FILE_PATH is missing");
  throw new Error('Missing GitHub environment variables needed for Server Actions. Check server logs.');
}
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- GitHub API Helpers (getFileContent, updateFileContent) ---
async function getFileContent(): Promise<{ content: string; sha: string | null }> {
  const logPrefix = '[getFileContent]';
  console.log(`${logPrefix} Attempting to fetch: ${REPO_OWNER}/${REPO_NAME}/${FILE_PATH}`);
  try {
    const response = await octokit.repos.getContent({
      owner: REPO_OWNER!,
      repo: REPO_NAME!,
      path: FILE_PATH!,
    });
    console.log(`${logPrefix} GitHub API Response Status: ${response.status}`);

    if (response.data && typeof response.data === 'object' && 'type' in response.data && response.data.type === 'file') {
         if ('content' in response.data && response.data.content) {
            const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
            const sha = 'sha' in response.data ? response.data.sha : null;
            console.log(`${logPrefix} Success. SHA: ${sha}, Content length: ${content.length}`);
            console.log(`${logPrefix} Content (start): ${content.substring(0, 200)}...`);
            return { content, sha };
         } else {
             console.warn(`${logPrefix} Path is a file but content is missing or empty.`);
             const sha = 'sha' in response.data ? response.data.sha : null;
             return { content: '[]', sha: sha };
         }
    } else if (response.data && typeof response.data === 'object' && 'type' in response.data) {
        console.error(`${logPrefix} Path exists but is not a file. Type: ${response.data.type}`);
        throw new Error(`Path is not a file: ${FILE_PATH}. Found type: ${response.data.type}`);
    } else {
        console.error(`${logPrefix} Unexpected response structure from GitHub API.`);
        throw new Error(`Unexpected response structure retrieving file: ${FILE_PATH}`);
    }
  } catch (error: any) {
     if (error && error.status === 404) {
        console.warn(`${logPrefix} File not found (404) at path: ${FILE_PATH}. Returning empty.`);
        return { content: '[]', sha: null };
     }
     console.error(`${logPrefix} GitHub API Error Status: ${error?.status}`);
     console.error(`${logPrefix} GitHub API Error Message: ${error?.message}`);
     throw new Error(`Failed to fetch file from GitHub (${error?.status}): ${error?.message}`);
  }
}

async function updateFileContent(newContent: string, sha: string | null, commitMessage: string): Promise<void> {
    const logPrefix = '[updateFileContent]';
    console.log(`${logPrefix} Attempting update. SHA: ${sha ?? 'None (create)'}`);
    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER!, repo: REPO_NAME!, path: FILE_PATH!,
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64'),
            sha: sha ?? undefined,
        });
        console.log(`${logPrefix} Success.`);
    } catch (error: any) {
        console.error(`${logPrefix} GitHub API Error Status: ${error?.status}`);
        console.error(`${logPrefix} GitHub API Error Message: ${error?.message}`);
        if (error.status === 409) { throw new Error(`Failed update (409 Conflict): File updated concurrently. Refresh & try again.`); }
        if (error.status === 422 && error.message?.includes("sha")) { throw new Error(`Failed update (422 Invalid SHA): State mismatch. Refresh & try again.`); }
        throw new Error(`Failed to update file on GitHub (${error?.status}): ${error.message}`);
    }
}

// --- Function for Server Action (fetch raw data) ---
async function fetchRawCalendarEventsForUpdate(): Promise<{ events: CalendarEvent[], sha: string | null }> {
    const logPrefix = '[fetchRawForUpdate]';
    console.log(`${logPrefix} Fetching raw events and SHA...`);
    const { content, sha } = await getFileContent();
    try {
        const events: CalendarEvent[] = JSON.parse(content || '[]');
        if (!Array.isArray(events)) throw new Error("Parsed content is not an array");
        console.log(`${logPrefix} Parsed ${events.length} raw events. SHA: ${sha}`);
        return { events, sha };
    } catch (parseError: any) {
        console.error(`${logPrefix} Failed to parse JSON: ${parseError.message}`);
        console.error(`${logPrefix} Raw content was: ${content.substring(0,200)}...`);
        return { events: [], sha };
    }
}


// --- Server Action: Update Event ---
export async function updateCalendarEventRefined(updatedEventData: Omit<CalendarEvent, 'id'> & { id: string }): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
    const logPrefix = '[ACTION update]';
    console.log(`${logPrefix} Received for ID: ${updatedEventData.id}`);
    const validationResult = eventSchema.safeParse(updatedEventData);
    if (!validationResult.success) {
        console.warn(`${logPrefix} Validation failed:`, validationResult.error.flatten());
        return { success: false, message: 'Invalid data provided.', errors: validationResult.error.issues };
    }
    const validatedEvent = validationResult.data;
    try {
        const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();
        const eventIndex = currentEvents.findIndex((e) => e.id === validatedEvent.id);
        if (eventIndex === -1) {
            console.warn(`${logPrefix} Event ID ${validatedEvent.id} not found for update.`);
            return { success: false, message: `Event ID ${validatedEvent.id} not found.` };
        }
        currentEvents[eventIndex] = { ...validatedEvent };
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


// --- Function: Fetch Events for Display (called by Page) ---
export async function fetchCalendarEvents(): Promise<BigCalendarEvent[]> {
  const logPrefix = '[fetchCalendarEvents]';
  console.log(`${logPrefix} Fetching events for display...`);

  try {
    // Use getFileContent to fetch data and handle basic errors/existence
    const { content } = await getFileContent(); // Contains detailed logging inside

    // Check if content is effectively empty after fetching
    if (!content || content.trim() === '' || content.trim() === '[]') {
        console.log(`${logPrefix} Fetched content is empty or just an empty array string.`);
        return []; // Return empty array directly
    }

    // --- JSON Parsing ---
    let data: CalendarEvent[];
    try {
        data = JSON.parse(content);
        console.log(`${logPrefix} Successfully parsed JSON. Found ${Array.isArray(data) ? data.length : 'non-array'} items.`);
    } catch (parseError: any) {
        console.error(`${logPrefix} !!! JSON Parsing Error: ${parseError.message}`);
        console.error(`${logPrefix} !!! Content that failed parsing: ${content.substring(0, 500)}...`);
        return []; // Return empty array if JSON is invalid
    }

    if (!Array.isArray(data)) {
        console.error(`${logPrefix} Parsed data is not an array. Type: ${typeof data}`);
        return []; // Return empty array if it's not an array
    }

    console.log(`${logPrefix} Starting date conversion for ${data.length} events...`);
    // --- Date Conversion & Filtering ---
    const processedEvents: BigCalendarEvent[] = []; // Build array incrementally
    for (const event of data) {
        if (!event || !event.id || !event.start || !event.end) {
            console.warn(`${logPrefix} Skipping event due to missing id, start, or end:`, JSON.stringify(event));
            continue;
        }

        const start = new Date(event.start);
        const end = new Date(event.end);

        const isStartValid = !isNaN(start.getTime());
        const isEndValid = !isNaN(end.getTime());
        // Log the attempt for EVERY event
        console.log(`${logPrefix}   - Processing ID ${event.id}: Start='${event.start}' -> Valid: ${isStartValid}, End='${event.end}' -> Valid: ${isEndValid}`);

        if (isStartValid && isEndValid) {
             // Double-check start is before end after conversion
             if (start >= end) {
                 console.warn(`${logPrefix}   - SKIPPING Event ID ${event.id} because start date is not before end date after parsing.`);
                 continue;
             }
            processedEvents.push({
                // Reconstruct carefully to match BigCalendarEvent
                id: event.id,
                title: event.title,
                status: event.status,
                notes: event.notes,
                start: start, // Use the Date object
                end: end,     // Use the Date object
            });
        } else {
            // Log ONLY if invalid
            console.warn(`${logPrefix}   - SKIPPING Event ID ${event.id} due to invalid date string(s).`);
        }
    }

    console.log(`${logPrefix} Finished date conversion. Returning ${processedEvents.length} valid events.`);
    return processedEvents;

  } catch (error: any) {
    console.error(`${logPrefix} !!! Unexpected Error during fetch/process: ${error.message}`);
    console.error(error); // Log the full error object
    return []; // Return empty array on any major error
  }
}