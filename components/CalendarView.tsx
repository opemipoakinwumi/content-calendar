// components/CalendarView.tsx
'use client';

import React, { useState, useEffect } from 'react';
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

// Corrected Props Interface
interface CalendarViewProps {
  initialEvents: BigCalendarEvent[];
}

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
  // --- Logging Start (Browser Console) ---
  useEffect(() => {
    console.log('[CLIENT CalendarView] Received initialEvents prop:', initialEvents);
    const container = document.getElementById('calendar-container');
    if (container) {
        setTimeout(() => {
            console.log('[CLIENT CalendarView] Calendar container height:', container.offsetHeight);
             if (container.offsetHeight < 50) {
                console.warn('[CLIENT CalendarView] Calendar container height seems too small. Check parent styling and CSS for h-[calc(100vh-120px)].');
            }
        }, 100);
    } else {
        console.warn('[CLIENT CalendarView] Calendar container element not found for height check.');
    }
  }, [initialEvents]);
  // --- Logging End ---

  const [selectedEvent, setSelectedEvent] = useState<BigCalendarEvent | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Use the prop directly, ensure it's an array
  const eventsToRender = Array.isArray(initialEvents) ? initialEvents : [];
  // Log what's actually being passed to the Calendar component
  console.log('[CLIENT CalendarView] Events being passed to <Calendar>:', eventsToRender);


  const handleSelectEvent = (event: BigCalendarEvent) => {
    console.log('[CLIENT CalendarView] Event selected:', event);
    setSelectedEvent(event);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedEvent(null);
  };

  const handleSaveEvent = async (updatedEventData: CalendarEvent) => {
      console.log('[CLIENT CalendarView] Calling Server Action handleSaveEvent with:', updatedEventData);
      if (!updatedEventData.id) {
        console.error("[CLIENT CalendarView] Event ID missing in handleSaveEvent");
        return { success: false, message: "Event ID is missing." };
      }
      return await updateCalendarEventRefined(updatedEventData);
  };

  return (
    <div id="calendar-container" className="p-4 md:p-6 lg:p-8 h-[calc(100vh-120px)]">
       <h1 className="text-3xl font-bold mb-6 text-primary">Content Calendar</h1>

       {eventsToRender.length === 0 && (
         <p className="text-center text-gray-500 my-4">
           No events to display. Check server logs for data fetching/parsing issues, verify JSON date format (YYYY-MM-DDTHH:mm:ssZ), and ensure calendar view includes event dates.
         </p>
       )}

      <Calendar
        localizer={localizer}
        events={eventsToRender} // Use the validated array
        startAccessor="start"
        endAccessor="end"
        style={{ height: '100%' }}
        views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
        selectable
        onSelectEvent={handleSelectEvent}
        popup
        components={{
            event: CustomEvent,
        }}
        defaultDate={new Date()} // Start view on current month/week
      />

      {isModalOpen && selectedEvent && (
        <EditEventModal
          event={{
              ...selectedEvent,
              start: selectedEvent.start.toISOString(),
              end: selectedEvent.end.toISOString(),
          }}
          onClose={handleCloseModal}
          onSave={handleSaveEvent}
        />
      )}
    </div>
  );
}