

// --- File: components/CalendarView.tsx ---
// components/CalendarView.tsx (with Optimistic Update for Drag & Drop)
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views, EventProps, SlotInfo } from 'react-big-calendar';
import withDragAndDrop, { EventInteractionArgs } from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';

// Date-fns imports
import { format } from 'date-fns/format';
import { parse } from 'date-fns/parse';
import { startOfWeek } from 'date-fns/startOfWeek';
import { getDay } from 'date-fns/getDay';
import { enUS } from 'date-fns/locale/en-US';

// Components and Actions
import EditEventModal from './EditEventModal';
import {
    CalendarEvent,         // Interface for actions/modal (uses 'start', 'end') - Ensure includes 'attachment'
    BigCalendarEvent,      // Interface for calendar rendering (uses 'start', 'end') - Ensure includes 'attachment'
    updateCalendarEventRefined, // Action for updating events - Ensure handles 'attachment'
 } from '@/app/actions';

// Setup the date-fns localizer
const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: () => startOfWeek(new Date(), { locale: enUS }), getDay, locales });

// Create the Drag-and-Drop enabled Calendar component
const DnDCalendar = withDragAndDrop<BigCalendarEvent>(Calendar);

// Props Interface
interface CalendarViewProps {
    initialEvents: BigCalendarEvent[]; // Should include 'attachment'
}

// Status Colors Mapping
const statusColors: { [key: string]: string } = {
    'Draft': 'bg-gray-400 hover:bg-gray-500 border-gray-500',
    'Planned': 'bg-blue-500 hover:bg-blue-600 border-blue-700',
    'In Progress': 'bg-yellow-400 hover:bg-yellow-500 border-yellow-600 text-black',
    'Needs Review': 'bg-orange-500 hover:bg-orange-600 border-orange-700',
    'Approved': 'bg-teal-500 hover:bg-teal-600 border-teal-700',
    'Published': 'bg-green-600 hover:bg-green-700 border-green-800',
    'Confirmed': 'bg-indigo-500 hover:bg-indigo-600 border-indigo-700',
    'Default': 'bg-primary hover:bg-purple-700 border-purple-800',
};

// Custom Event Component
const CustomEvent: React.FC<EventProps<BigCalendarEvent>> = ({ event }) => {
  const colorClass = statusColors[event.status] || statusColors['Default'];
  const textColorClass = event.status === 'In Progress' ? 'text-black' : 'text-white';
  return (
    <div className={`text-xs p-1 rounded border-l-4 h-full overflow-hidden cursor-move ${colorClass} ${textColorClass} transition-colors duration-150 ease-in-out`}>
      <strong className='block truncate font-semibold'>{event.title}</strong>
      <em className='block truncate opacity-90'>{event.status}</em>
    </div>
  );
};


// --- Main Calendar View Component ---
export default function CalendarView({ initialEvents }: CalendarViewProps) {
  // --- State Management ---
  const [localEvents, setLocalEvents] = useState<BigCalendarEvent[]>(initialEvents);
  const [selectedEvent, setSelectedEvent] = useState<BigCalendarEvent | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // --- Synchronization Effect ---
  useEffect(() => {
    console.log("[CLIENT CalendarView] Prop 'initialEvents' changed, updating local state.");
    setLocalEvents(initialEvents);
  }, [initialEvents]);


  // --- Derived State (Filtering/Searching) ---
  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(localEvents.map(event => event.status));
    return Array.from(statuses).sort();
  }, [localEvents]);

  const filteredEvents = useMemo(() => {
    let events = Array.isArray(localEvents) ? localEvents : [];
    if (statusFilter) {
      events = events.filter(event => event.status === statusFilter);
    }
    if (searchTerm.trim() !== '') {
      const lowerSearchTerm = searchTerm.toLowerCase();
      events = events.filter(event =>
        event.title.toLowerCase().includes(lowerSearchTerm) ||
        (event.notes && event.notes.toLowerCase().includes(lowerSearchTerm)) ||
        (event.attachment && event.attachment.toLowerCase().includes(lowerSearchTerm)) // Search attachments too
      );
    }
    return events;
  }, [localEvents, statusFilter, searchTerm]);


  // --- Event Handlers ---
  const handleSelectEvent = (event: BigCalendarEvent) => {
    console.log('[CLIENT CalendarView] Event selected for edit:', event.id);
    setSelectedEvent(event); // Store event with Date objects, including 'start' and 'attachment'
    setIsModalOpen(true);
  };

  const handleOpenAddModal = () => {
    console.log('[CLIENT CalendarView] Opening Add Modal');
    setSelectedEvent(null);
    setIsModalOpen(true);
  };

   const handleSelectSlot = useCallback(({ start, end }: SlotInfo) => {
        // 'start' here refers to the beginning of the selected empty slot time
        console.log('[CLIENT CalendarView] Opening Add Modal from slot selection. Slot starts at:', start);
        setSelectedEvent(null);
        setIsModalOpen(true);
        // TODO: Could enhance modal to pre-fill Approval Date ('start') based on the clicked slot's 'start' time
    }, []);

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedEvent(null);
  };

  // --- Optimistic Drag and Drop Handler ---
   type OnEventDropFn = (args: EventInteractionArgs<BigCalendarEvent>) => void;

   const handleEventDrop = useCallback<OnEventDropFn>(
    // 'start' and 'end' arguments from the library refer to the new drop times
    async ({ event, start, end }) => {
      // 0. Validate Inputs
      if (!(start instanceof Date) || !(end instanceof Date) || start >= end) {
         console.error("[CLIENT DND Optimistic] Invalid approval/publishing dates on drop:", start, end);
         alert("Error: Invalid date range for dropped event.");
         return;
      }

      // Log using the new terminology
      console.log(`[CLIENT DND Optimistic] Event Dropped: ${event.id}, New Approval Date: ${start}, New Publishing Date: ${end}`);

      // 1. Store original state for rollback
      const originalEvents = [...localEvents];

      // 2. Create updated event for optimistic UI (includes all existing fields)
      const updatedOptimisticEvent: BigCalendarEvent = {
        ...event,
        start,    // Update internal 'start' (Approval Date)
        end       // Update internal 'end' (Publishing Date)
      };

      // 3. Create new state array with updated event
      const optimisticEvents = originalEvents.map(ev =>
          ev.id === event.id ? updatedOptimisticEvent : ev
      );

      // 4. Update local state IMMEDIATELY
      setLocalEvents(optimisticEvents);
      console.log(`[CLIENT DND Optimistic] UI updated optimistically for ${event.id}`);

      // 5. Prepare data for server action (using ISO strings and internal 'start'/'end' keys)
      const dataForAction: CalendarEvent = {
        id: event.id,
        title: event.title,
        status: event.status,
        notes: event.notes,
        attachment: event.attachment,
        start: start.toISOString(), // NEW Approval Date
        end: end.toISOString(),     // NEW Publishing Date
      };

      // 6. Call server action
      try {
        const result = await updateCalendarEventRefined(dataForAction);

        // 7. Handle Server Result
        if (!result.success) {
          console.error("[CLIENT DND Optimistic] Failed server update action:", result.message);
          alert(`Error updating schedule: ${result.message}. Reverting change.`);
          setLocalEvents(originalEvents); // Rollback
        } else {
          console.log(`[CLIENT DND Optimistic] Server update successful for ${event.id}. Revalidation pending.`);
          // Success: UI already updated.
        }
      } catch (error) {
        console.error("[CLIENT DND Optimistic] Error calling update action after drop:", error);
        alert("An unexpected error occurred while saving the schedule change. Reverting change.");
        setLocalEvents(originalEvents); // Rollback on unexpected errors
      }
    },
    [localEvents] // Dependency
  );

  // --- Render Component ---
  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header Section */}
      <header className="p-4 md:p-6 border-b dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm flex-shrink-0">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-primary dark:text-purple-400">ULE Homes Content Calendar</h1>
            <button
                onClick={handleOpenAddModal}
                className="inline-flex items-center justify-center px-5 py-2.5 bg-primary text-white rounded-lg font-semibold text-sm shadow-md hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-600 dark:focus-visible:ring-offset-gray-800 active:scale-95 transition-all duration-150 ease-in-out"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Event
            </button>
        </div>
         {/* Filter and Search Controls */}
         <div className="mt-4 flex flex-col sm:flex-row gap-4 items-center">
             <div className="flex-shrink-0">
                 <label htmlFor="statusFilter" className="sr-only">Filter by Status</label>
                 <select id="statusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-primary focus:border-primary shadow-sm text-sm">
                     <option value="">All Statuses</option>
                     {uniqueStatuses.map(status => (<option key={status} value={status}>{status}</option>))}
                 </select>
             </div>
             <div className="flex-grow">
                  <label htmlFor="searchTerm" className="sr-only">Search Events</label>
                 <input type="search" id="searchTerm" placeholder="🔍 Search title, notes, attachments..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-primary focus:border-primary shadow-sm text-sm" />
             </div>
         </div>
      </header>

      {/* Calendar Area */}
      <div id="calendar-container" className="flex-grow p-4 md:p-6 lg:p-8 overflow-hidden">
          {/* Message for no matching events */}
          {filteredEvents.length === 0 && !searchTerm && !statusFilter && initialEvents.length > 0 && (
               <p className="text-center text-gray-500 dark:text-gray-400 my-4">Loading events or no events in this date range.</p>
          )}
           {filteredEvents.length === 0 && (searchTerm || statusFilter) && (
              <p className="text-center text-gray-500 dark:text-gray-400 my-4">
                  No events match your current filter or search criteria.
              </p>
          )}
          {/* Inner scrollable container for calendar */}
          <div className="h-full overflow-y-auto">
            <DnDCalendar
                localizer={localizer}
                events={filteredEvents}
                // Crucial: Accessors MUST point to the 'start' and 'end' properties internally
                startAccessor={(event: BigCalendarEvent) => event.start} // Represents Approval Date
                endAccessor={(event: BigCalendarEvent) => event.end}     // Represents Publishing Date
                style={{ minHeight: '600px' }}
                views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
                selectable
                onSelectEvent={handleSelectEvent}
                onSelectSlot={handleSelectSlot} // 'start'/'end' in slot info refer to slot timing
                popup
                components={{ event: CustomEvent }}
                defaultDate={new Date()}
                onEventDrop={handleEventDrop} // 'start'/'end' in drop info refer to new drop timing
                resizable
                // onEventResize={handleEventResize} // Implement if needed, 'start'/'end' refer to resize timing
            />
          </div>
      </div>

      {/* Edit/Add Event Modal */}
      {isModalOpen && (
        <EditEventModal
          // Pass data to modal using internal 'start'/'end' keys, converted to ISO strings
          event={selectedEvent ? {
              id: selectedEvent.id,
              title: selectedEvent.title,
              status: selectedEvent.status,
              notes: selectedEvent.notes,
              attachment: selectedEvent.attachment,
              // Convert Date objects (Approval/Publishing) to ISO strings for the modal's input fields
              start: (selectedEvent.start instanceof Date ? selectedEvent.start : new Date(selectedEvent.start)).toISOString(), // Approval Date
              end: (selectedEvent.end instanceof Date ? selectedEvent.end : new Date(selectedEvent.end)).toISOString(),         // Publishing Date
          } : null}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}