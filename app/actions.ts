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
interface BigCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> {
    start: Date;
    end: Date;
}


// Zod schema for validation (uses string dates matching CalendarEvent)
const eventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1, 'Title is required'),
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

async function getFileContent(): Promise<{ content: string; sha: string | null }> {
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
       console.error(`Path ${FILE_PATH} is not a file.`);
       throw new Error(`Path is not a file: ${FILE_PATH}`);
    }

  } catch (error: any) {
     if (error && (error as any).status === 404) {
        console.warn(`File ${FILE_PATH} not found during getFileContent. Assuming empty.`);
        return { content: '[]', sha: null };
     }
     console.error('GitHub API Error (getFileContent):', error.message);
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
      sha: sha ?? undefined,
    });
    console.log('Successfully updated file on GitHub:', FILE_PATH);
  } catch (error: any) {
    console.error('GitHub API Error (updateFileContent):', error.message);
    console.error('Request details:', { owner: REPO_OWNER, repo: REPO_NAME, path: FILE_PATH, sha });
    if (error.status) console.error('Status Code:', error.status);
    if (error.status === 409) {
        throw new Error(`Failed to update file: Conflict detected. The file may have been updated by someone else. Please refresh and try again. ${error.message}`);
    }
    if (error.status === 404 && sha) {
        throw new Error(`Failed to update file: File not found (it might have been deleted). Please refresh. ${error.message}`);
    }
     if (error.status === 422 && error.message?.includes("sha")) {
         throw new Error(`Failed to update file: Invalid state detected (SHA mismatch). Please refresh and try again. ${error.message}`);
     }
    throw new Error(`Failed to update file on GitHub: ${error.message}`);
  }
}


// --- Function to fetch events specifically for the Server Action (keeping dates as strings) ---
async function fetchRawCalendarEventsForUpdate(): Promise<{ events: CalendarEvent[], sha: string | null }> {
    console.log('Fetching raw calendar events for update...');
    const { content, sha } = await getFileContent();
    try {
        const events: CalendarEvent[] = JSON.parse(content || '[]');
        if (!Array.isArray(events)) throw new Error("Parsed content is not an array");
        return { events, sha };
    } catch (parseError: any) {
        console.error("Failed to parse existing JSON for update:", parseError);
        return { events: [], sha };
    }
}

// --- Server Action: Update Event (Refined) ---
export async function updateCalendarEventRefined(
  updatedEventData: Omit<CalendarEvent, 'id'> & { id: string }
): Promise<{ success: boolean; message: string; errors?: z.ZodIssue[] }> {
  console.log('Server Action: updateCalendarEventRefined called with:', updatedEventData);

   const validationResult = eventSchema.safeParse(updatedEventData);
   if (!validationResult.success) {
       console.error('Validation failed:', validationResult.error.flatten());
       return {
           success: false,
           message: 'Invalid data provided. Please check the fields.',
           errors: validationResult.error.issues,
       };
   }
   const validatedEvent = validationResult.data;

  try {
      const { events: currentEvents, sha } = await fetchRawCalendarEventsForUpdate();

      const eventIndex = currentEvents.findIndex((e) => e.id === validatedEvent.id);
      if (eventIndex === -1) {
          return { success: false, message: `Event with ID ${validatedEvent.id} not found.` };
      }

      currentEvents[eventIndex] = { ...validatedEvent };

      const updatedJsonString = JSON.stringify(currentEvents, null, 2);
      const commitMessage = `Update event: ${validatedEvent.title} (ID: ${validatedEvent.id})`;
      await updateFileContent(updatedJsonString, sha, commitMessage);

      revalidatePath('/');
      console.log('Server Action: updateCalendarEventRefined completed successfully.');
      return { success: true, message: 'Event updated successfully!' };

  } catch (error: any) {
      console.error('Error in updateCalendarEventRefined Server Action:', error);
      return { success: false, message: `Failed to update event: ${error.message}` };
  }
}


// --- Server Action: Fetch Events (for Client Component) ---
export async function fetchCalendarEvents(): Promise<BigCalendarEvent[]> {
  // --- Logging Start ---
  console.log('[SERVER ACTION] Fetching calendar events from GitHub for display...');
  const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${FILE_PATH}`; // Adjust branch if needed
  console.log('[SERVER ACTION] Fetching from URL:', rawUrl);
  // --- Logging End ---

  try {
    const response = await fetch(rawUrl, {
      headers: {
        'Cache-Control': 'no-cache',
      },
      next: {
          revalidate: 0, // On-demand revalidation
          tags: ['calendarData'],
      }
    });

    // --- Logging Start ---
    console.log('[SERVER ACTION] Fetch response status:', response.status);
    // --- Logging End ---

    if (!response.ok) {
        if (response.status === 404) {
            console.warn(`[SERVER ACTION] Calendar data file not found at ${rawUrl}. Returning empty array.`);
            return [];
        }
      throw new Error(`Failed to fetch calendar data: ${response.status} ${response.statusText} from ${rawUrl}`);
    }

    const jsonText = await response.text();
    // --- Logging Start ---
    console.log('[SERVER ACTION] Fetched Raw JSON Text:', jsonText.substring(0, 500) + '...');
    // --- Logging End ---

     if (!jsonText) {
        console.warn("[SERVER ACTION] Calendar data file is empty. Returning empty array.");
        return [];
    }

    // Parse the JSON (expecting CalendarEvent[] with string dates)
    const data: CalendarEvent[] = JSON.parse(jsonText);
    // --- Logging Start ---
    console.log('[SERVER ACTION] Parsed JSON Data (raw):', data);
    // --- Logging End ---

    if (!Array.isArray(data)) {
        throw new Error("Fetched data is not a valid JSON array.");
    }

    // Convert to BigCalendarEvent[] with Date objects and filter invalid dates
    const processedEvents = data
      .map(event => {
        const start = new Date(event.start);
        const end = new Date(event.end);
        // --- Logging Start ---
        // Log conversion attempt for each event
        console.log(`[SERVER ACTION] Processing Event ID ${event.id}: Start String='${event.start}', End String='${event.end}', Start Date=${start}, End Date=${end}, Start Valid=${!isNaN(start.getTime())}, End Valid=${!isNaN(end.getTime())}`);
        // --- Logging End ---
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            return {
                ...event,
                start: start,
                end: end,
            };
        } else {
            console.warn(`[SERVER ACTION] Invalid date format encountered for event ID ${event.id}: start='${event.start}', end='${event.end}'. Skipping event.`);
            return null; // Return null for invalid events
        }
      })
      .filter((event): event is BigCalendarEvent => event !== null); // Filter out the nulls and assert type

    // --- Logging Start ---
    console.log('[SERVER ACTION] Final Processed Events (with Date objects):', processedEvents);
    // --- Logging End ---
    return processedEvents;


  } catch (error: any) {
    console.error("[SERVER ACTION] Error fetching or processing calendar events:", error);
    return [];
  }
}