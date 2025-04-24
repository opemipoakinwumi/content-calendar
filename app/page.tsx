// app/page.tsx
import { fetchCalendarEvents } from '@/app/actions'; // Import the fetch function
import CalendarView from '@/components/CalendarView'; // Client Component for the calendar UI

// Revalidate this page on-demand or based on time
// export const revalidate = 60; // Revalidate every 60 seconds (alternative to fetch revalidate)
// export const dynamic = 'force-dynamic' // Optional: Force dynamic rendering if needed

export default async function HomePage() {
  // Fetch data on the server during rendering
  const initialEvents = await fetchCalendarEvents();
   // Dates might be strings or Date objects depending on fetchCalendarEvents implementation
   // CalendarView expects Date objects, so ensure fetchCalendarEvents provides them
   // Or handle conversion within CalendarView as done above

  return (
    <main className="min-h-screen">
       {/* Header or other layout elements can go here */}
       {/* The CalendarView is a Client Component, but it's rendered by this Server Component */}
       <CalendarView initialEvents={initialEvents} />
    </main>
  );
}