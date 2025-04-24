// app/page.tsx
import { fetchCalendarEvents } from '@/app/actions';
import CalendarView from '@/components/CalendarView'; // Client Component for the calendar UI

// Ensure the page fetches fresh data on each request during development/testing
// Consider changing this for production based on caching needs
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function HomePage() {
  // Fetch initial event data on the server when the page loads
  const initialEvents = await fetchCalendarEvents();
  console.log(`[SERVER PAGE] Passing ${initialEvents.length} events to CalendarView.`);

  return (
    // The main layout likely handles min-height, so this can be simpler
    <main className="h-full"> {/* Ensure main takes available height */}
       <CalendarView initialEvents={initialEvents} />
    </main>
  );
}