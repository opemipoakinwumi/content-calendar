// app/actions.ts
'use server'; // Mark this module as Server Actions

import { Octokit } from '@octokit/rest';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

// Define the structure for JSON storage and server actions (string dates)
export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // Keep as ISO string for consistency
  end: string;   // Keep as ISO string
  status: string;
  notes?: string;
}

// Define the structure expected by react-big-calendar (Date objects)
// (We need this for the fetchCalendarEvents return type)
interface BigCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> {
    start: Date;
    end: Date;
}


// Zod schema for validation (uses string dates matching CalendarEvent)
const eventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1, 'Title is required'),
  // Accept string datetimes, validation happens here
  start: z.string().datetime({ message: 'Invalid start date/time format' }),
  end: z.string().datetime({ message: 'Invalid end date/time format' }),
  status: z.string().min(1, 'Status is required'),
  notes: z.string().optional(),
}).refine(data => new Date(data.start) < new Date(data.end), {
    message: "End date must be after start date",
    path: ["end"], // Attach error to the 'end' field
});


// Ensure environment variables are set
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const REPO_NAME = process.env.GITHUB_REPO_NAME;
const FILE_PATH = process.env.GITHUB_FILE_PATH;

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME || !FILE_PATH) {
  throw new Error('Missing GitHub environment variables for Server Actions');
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- GitHub API Helper Functions ---

async function getFileContent(): Promise<{ content: string; sha: string | null }> { // Allow null SHA for new files
  try {
    const response = await octokit.repos.getContent({
      owner: REPO_OWNER!,
      repo: REPO_NAME!,
      path: FILE_PATH!,
    });

    if ('type' in response.data && response.data.type === 'file' && response.data.content) {
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      return { content, sha: response.data.sha };
    } else {
       // Handle case where path is a directory or other non-file type
       console.error(`Path ${FILE_PATH} is not a file.`);
       throw new Error(`Path is not a file: ${FILE_PATH}`);
    }

  } catch (error: any) {
     // *** FIX 1: Cast error.status to allow comparison with 404 ***
     if (error && (error as any).status === 404) {
        console.warn(`File ${FILE_PATH} not found during getFileContent. Assuming empty.`);
        // If file doesn't exist, return empty array content and null sha to indicate creation
        return { content: '[]', sha: null };
     }
     console.error('GitHub API Error (getFileContent):', error.message);
     // Log more details if available
     if (error.status) console.error('Status Code:', error.status);
     throw new Error(`Failed to fetch file from GitHub: ${error.message}`);
  }
}

async function updateFileContent(newContent: string, sha: string | null, commitMessage: string): Promise<void> {
  try {
    console.log(`Attempting to update ${FILE_PATH} with SHA: ${sha ?? 'None (creating)'}`);
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER!,
      repo: REPO_NAME!,
      path: FILE_PATH!,
      message: commitMessage,
      content: Buffer.from(newContent).toString('base64'),
      sha: sha ?? undefined, // Pass sha if it exists (update), otherwise undefined (create)
    });
    console.log('Successfully updated file on GitHub:', FILE_PATH);
  } catch (error: any) {
    console.error('GitHub API Error (updateFileContent):', error.message);
    console.error('Request details:', { owner: REPO_OWNER, repo: REPO_NAME, path: FILE_PATH, sha });
    if (error.status) console.error('Status Code:', error.status);
    // Provide more specific error messages if possible
    if (error.status === 409) { // Conflict error (SHA mismatch)
        throw new Error(`Failed to update file: Conflict detected. The file may have been updated by someone else. Please refresh and try again. ${error.message}`);
    }
    if (error.status === 404 && sha) { // Trying to update a file that was deleted
        throw new Error(`Failed to update file: File not found (it might have been deleted). Please refresh. ${error.message}`);
    }
     if (error.status === 422 && error.message?.includes("sha")) { // Invalid SHA provided
         throw new Error(`Failed to update file: Invalid state detected (SHA mismatch). Please refresh and try again. ${error.message}`);
     }
    throw new Error(`Failed to update file on GitHub: ${error.message}`);
  }
}


// --- Function to fetch events specifically for the Server Action (keeping dates as strings) ---
async function fetchRawCalendarEventsForUpdate(): Promise<{ events: CalendarEvent[], sha: string | null }> {
    console.log('Fetching raw calendar events for update...');
    const { content, sha } = await getFileContent(); // sha can be null if file doesn't exist
    try {
        const events: CalendarEvent[] = JSON.parse(content || '[]'); // Default to empty array if content is null/empty
        if (!Array.isArray(events)) throw new Error("Parsed content is not an array");
        // Dates remain strings here
        return { events, sha };
    } catch (parseError: any) {
        console.error("Failed to parse existing JSON for update:", parseError);
        // If parsing fails drastically, maybe return an error state? Or attempt recovery?
        // For now, treat as empty, but retain the sha if it existed.
        // If sha was null (file didn't exist), this is fine. If sha existed but content was bad,
        // the update might fail later if the sha is required.
        return { events: [], sha }; // Return empty array, keep original sha status
    }
}

// --- Server Action: Update Event (Refined) ---
export async function updateCalendarEventRefined(
  // Input data can have string dates from the form/modal
  updatedEventData: Omit<CalendarEvent, 'id'> & { id: string }
): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> { // Return Zod issues for better form errors
  console.log('Server Action: updateCalendarEventRefined called with:', updatedEventData);

   // Validate the input data (expects string dates)
   const validationResult = eventSchema.safeParse(updatedEventData);
   if (!validationResult.success) {
       console.error('Validation failed:', validationResult.error.flatten());
       return {
           success: false,
           message: 'Invalid data provided. Please check the fields.',
           // Return Zod errors for detailed feedback
           errors: validationResult.error.issues,
       };
   }
   const validatedEvent = validationResult.data; // Data is valid, dates are still strings

  try {
      // Fetch current data and the SHA needed for update/create
      const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();

      const eventIndex = currentEvents.findIndex((e) => e.id === validatedEvent.id);
      if (eventIndex === -1) {
          // Optionally, implement event creation here if ID not found
          return { success: false, message: `Event with ID ${validatedEvent.id} not found.` };
      }

      // Update the event in the array (dates are already valid strings from validation)
      currentEvents[eventIndex] = {
          ...validatedEvent, // validatedEvent already has the correct string format dates
      };

      const updatedJsonString = JSON.stringify(currentEvents, null, 2);
      const commitMessage = `Update event: ${validatedEvent.title} (ID: ${validatedEvent.id})`;

      // Commit the changes using the fetched SHA (can be null for creation)
      await updateFileContent(updatedJsonString, sha, commitMessage);

      revalidatePath('/'); // Revalidate the page cache

      console.log('Server Action: updateCalendarEventRefined completed successfully.');
      return { success: true, message: 'Event updated successfully!' };

  } catch (error: any) {
      console.error('Error in updateCalendarEventRefined Server Action:', error);
      // Return specific error messages caught from updateFileContent
      return { success: false, message: `Failed to update event: ${error.message}` };
  }
}


// --- Server Action: Fetch Events (for Client Component) ---
// Fetches data and converts dates to Date objects for react-big-calendar
// *** FIX 2: Changed return type to Promise<BigCalendarEvent[]> ***
export async function fetchCalendarEvents(): Promise<BigCalendarEvent[]> {
  console.log('Fetching calendar events from GitHub for display...');
  // Use raw URL for potentially faster reads, assuming main branch
  const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${FILE_PATH}`; // Adjust branch if needed

  try {
    const response = await fetch(rawUrl, {
      headers: {
        // Add token ONLY if the repo is private AND raw access requires it. Often not needed if Vercel/deployment has repo access.
        // 'Authorization': `token ${GITHUB_TOKEN}`,
        'Cache-Control': 'no-cache', // Ensure fresh data is fetched from GitHub raw
      },
      next: {
          revalidate: 0, // Revalidate on demand (triggered by revalidatePath) - Recommended
          // Or use time-based: revalidate: 60, // Revalidate data approx every 60 seconds
          tags: ['calendarData'], // Tag for potential on-demand revalidation via API later
      }
    });

    if (!response.ok) {
        if (response.status === 404) {
            console.warn(`Calendar data file not found at ${rawUrl}. Returning empty array. Please ensure the file exists at data/content-calendar.json in the main branch.`);
            return []; // Return empty array if file doesn't exist yet
        }
      throw new Error(`Failed to fetch calendar data: ${response.status} ${response.statusText} from ${rawUrl}`);
    }

    const jsonText = await response.text();
     if (!jsonText) {
        console.warn("Calendar data file is empty. Returning empty array.");
        return [];
    }

    // Parse the JSON (expecting CalendarEvent[] with string dates)
    const data: CalendarEvent[] = JSON.parse(jsonText);

    if (!Array.isArray(data)) {
        throw new Error("Fetched data is not a valid JSON array.");
    }

    // *** Convert to BigCalendarEvent[] with Date objects and filter invalid dates ***
    return data
      .map(event => {
        const start = new Date(event.start);
        const end = new Date(event.end);
        // Return event with Date objects ONLY if dates are valid
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            return {
                ...event,
                start: start,
                end: end,
            };
        } else {
            console.warn(`Invalid date format encountered for event ID ${event.id}: start='${event.start}', end='${event.end}'. Skipping event.`);
            return null; // Return null for invalid events
        }
      })
      .filter((event): event is BigCalendarEvent => event !== null); // Filter out the nulls and assert type


  } catch (error: any) {
    console.error("Error fetching or processing calendar events:", error);
    // Don't crash the page load, return an empty array
    return [];
  }
}