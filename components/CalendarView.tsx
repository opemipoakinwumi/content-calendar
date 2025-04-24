// components/CalendarView.tsx
'use client';

import React, { useState, useMemo } from 'react';
import { Calendar, dateFnsLocalizer, Views, EventProps } from 'react-big-calendar';
// Corrected date-fns imports
import { format } from 'date-fns/format';
import { parse } from 'date-fns/parse';
import { startOfWeek } from 'date-fns/startOfWeek';
import { getDay } from 'date-fns/getDay';
import { enUS } from 'date-fns/locale/en-US';
import EditEventModal from './EditEventModal';
// Import both types: CalendarEvent for Modal/Action, BigCalendarEvent for internal Calendar state
import { CalendarEvent, updateCalendarEventRefined } from '@/app/actions';

// Setup the localizer by providing the required functions
const locales = {
  'en-US': enUS,
};
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: enUS }),
  getDay,
  locales,
});

// Define the structure for react-big-calendar (Date objects)
interface BigCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> {
    start: Date;
    end: Date;
}

// --- Corrected Props Interface ---
// Expects initialEvents with Date objects, matching fetchCalendarEvents return type
interface CalendarViewProps {
  initialEvents: BigCalendarEvent[];
}
// --- End of Props Interface Correction ---

// Custom Event component (Optional)
const CustomEvent: React.FC<EventProps<BigCalendarEvent>> = ({ event }) => {
  return (
    <div className="text-xs p-1 overflow-hidden">
      <strong className='block truncate'>{event.title}</strong>
      <em className='block truncate text-purple-100'>{event.status}</em>
    </div>
  );
};

export default function CalendarView({ initialEvents }: CalendarViewProps) {
  // State for the selected event (using Date objects for internal calendar state)
  const [selectedEvent, setSelectedEvent] = useState<BigCalendarEvent | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Memoize and validate the events received from props
  // Since props now provide BigCalendarEvent[], we primarily just filter invalid ones
  const events = useMemo(() => {
       return initialEvents.filter(event =>
           event.start instanceof Date && !isNaN(event.start.getTime()) &&
           event.end instanceof Date && !isNaN(event.end.getTime())
       );
   }, [initialEvents]);


  const handleSelectEvent = (event: BigCalendarEvent) => {
    console.log('Event selected:', event);
    // Store the selected event with Date objects
    setSelectedEvent(event);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedEvent(null);
  };

  // Server action function passed to the modal
  // This function expects the CalendarEvent format (string dates) from the modal
  const handleSaveEvent = async (updatedEventData: CalendarEvent) => {
      console.log('Calling Server Action from CalendarView with:', updatedEventData);
      if (!updatedEventData.id) {
        console.error("Event ID missing in handleSaveEvent");
        return { success: false, message: "Event ID is missing." };
      }
      // Call the imported Server Action directly
      return await updateCalendarEventRefined(updatedEventData);
  };

  return (
    // Main container div
    <div className="p-4 md:p-6 lg:p-8 h-[calc(100vh-120px)]"> {/* Adjust height as needed */}
       <h1 className="text-3xl font-bold mb-6 text-primary">Content Calendar</h1>

      {/* React Big Calendar component */}
      <Calendar
        localizer={localizer}
        events={events} // Pass the validated events (BigCalendarEvent[])
        startAccessor="start" // Accessor expects Date object
        endAccessor="end"     // Accessor expects Date object
        style={{ height: '100%' }}
        views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
        selectable
        onSelectEvent={handleSelectEvent} // Called when an event is clicked
        popup
        components={{
            event: CustomEvent, // Use custom styling for events
        }}
        // Add more react-big-calendar props here if needed
      />

      {/* Edit Event Modal */}
      {/* Render modal only when an event is selected */}
      {/* Convert selectedEvent (Date objects) back to CalendarEvent (string dates) for the modal */}
      {isModalOpen && selectedEvent && (
        <EditEventModal
          event={{
              ...selectedEvent, // Copy id, title, status, notes
              start: selectedEvent.start.toISOString(), // Convert Date -> ISO String
              end: selectedEvent.end.toISOString(),     // Convert Date -> ISO String
          }}
          onClose={handleCloseModal}
          onSave={handleSaveEvent} // Pass the server action handler
        />
      )}
    </div>
  );
}