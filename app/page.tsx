// app/page.tsx
import { fetchCalendarEvents } from '@/app/actions';
import CalendarView from '@/components/CalendarView';

// Ensure dynamic fetching for testing
export const dynamic = 'force-dynamic';
// Turn off caching for fetch calls made by this page or its children
// export const fetchCache = 'force-no-store'; // Alternative to dynamic = 'force-dynamic'


export default async function HomePage() {
  console.log('--- [SERVER PAGE Log] ---');
  console.log('[SERVER PAGE] Calling fetchCalendarEvents...');
  const initialEvents = await fetchCalendarEvents(); // Fetch fresh data
  console.log(`[SERVER PAGE] fetchCalendarEvents returned ${initialEvents.length} events.`);
  console.log('[SERVER PAGE] Passing events to CalendarView component.');
  console.log('-------------------------');

  return (
    <main className="min-h-screen">
       <CalendarView initialEvents={initialEvents} />
    </main>
  );
}