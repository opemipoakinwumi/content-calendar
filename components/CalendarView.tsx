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
    CalendarEvent,         // Interface with string dates (for actions/modal)
    BigCalendarEvent,      // Interface with Date objects (for calendar rendering)
    updateCalendarEventRefined, // Action for updating events
 } from '@/app/actions';

// Setup the date-fns localizer
const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: () => startOfWeek(new Date(), { locale: enUS }), getDay, locales });

// Create the Drag-and-Drop enabled Calendar component, specifying our event type
const DnDCalendar = withDragAndDrop<BigCalendarEvent>(Calendar);

// Props Interface
interface CalendarViewProps {
    initialEvents: BigCalendarEvent[]; // Events received from the server (source of truth)
}

// Status Colors Mapping (as before)
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

// Custom Event Component (as before)
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
  // Local state to hold events for rendering. Initialized with props. This enables optimistic updates.
  const [localEvents, setLocalEvents] = useState<BigCalendarEvent[]>(initialEvents);
  // Modal state
  const [selectedEvent, setSelectedEvent] = useState<BigCalendarEvent | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Filter/Search state
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // --- Synchronization Effect ---
  // Update local state if the initialEvents prop changes (e.g., after server revalidation)
  useEffect(() => {
    console.log("[CLIENT CalendarView] Prop 'initialEvents' changed, updating local state.");
    setLocalEvents(initialEvents);
  }, [initialEvents]);


  // --- Derived State (Filtering/Searching) ---
  // Calculate unique statuses based on the *local* events state
  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(localEvents.map(event => event.status));
    return Array.from(statuses).sort();
  }, [localEvents]); // Depends on localEvents now

  // Filter and search the *local* events state
  const filteredEvents = useMemo(() => {
    let events = Array.isArray(localEvents) ? localEvents : [];
    if (statusFilter) {
      events = events.filter(event => event.status === statusFilter);
    }
    if (searchTerm.trim() !== '') {
      const lowerSearchTerm = searchTerm.toLowerCase();
      events = events.filter(event =>
        event.title.toLowerCase().includes(lowerSearchTerm) ||
        (event.notes && event.notes.toLowerCase().includes(lowerSearchTerm))
      );
    }
    // console.log(`[CLIENT CalendarView] Filtered/Searched Events Count: ${events.length}`);
    return events; // Return the list to be rendered
  }, [localEvents, statusFilter, searchTerm]); // Depends on localEvents


  // --- Event Handlers ---
  // Select existing event for editing
  const handleSelectEvent = (event: BigCalendarEvent) => {
    console.log('[CLIENT CalendarView] Event selected for edit:', event.id);
    setSelectedEvent(event); // Store event with Date objects
    setIsModalOpen(true);
  };

  // Open modal for adding a new event
  const handleOpenAddModal = () => {
    console.log('[CLIENT CalendarView] Opening Add Modal');
    setSelectedEvent(null); // Null signifies "Add" mode
    setIsModalOpen(true);
  };

  // Open modal for adding from an empty slot click
   const handleSelectSlot = useCallback(({ start, end }: SlotInfo) => {
        console.log('[CLIENT CalendarView] Opening Add Modal from slot selection:', start, end);
        setSelectedEvent(null); // Signal Add Mode
        setIsModalOpen(true);
        // TODO: Enhance modal to pre-fill dates from start/end args
    }, []);

  // Close the Add/Edit modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedEvent(null); // Clear selection
  };

  // --- Optimistic Drag and Drop Handler ---
   type OnEventDropFn = (args: EventInteractionArgs<BigCalendarEvent>) => void;

   const handleEventDrop = useCallback<OnEventDropFn>(
    async ({ event, start, end }) => {
      // 0. Validate Inputs from DND library
      if (!(start instanceof Date) || !(end instanceof Date)) {
         console.error("[CLIENT DND Optimistic] Dropped event has invalid start/end types:", start, end);
         alert("Error processing dropped event dates.");
         return;
      }
      if (start >= end) {
        console.warn("[CLIENT DND Optimistic] Dropped event has start >= end. Ignoring.");
        alert("Event end time must be after start time.");
        return; // Don't proceed if dates are invalid
      }

      console.log(`[CLIENT DND Optimistic] Event Dropped: ${event.id}, New Start: ${start}, New End: ${end}`);

      // 1. Store the original state for potential rollback
      const originalEvents = [...localEvents]; // Shallow copy is sufficient here

      // 2. Create the updated event data for the optimistic UI update
      const updatedOptimisticEvent = { ...event, start, end }; // Use new Date objects

      // 3. Create the new state array with the updated event
      const optimisticEvents = originalEvents.map(ev =>
          ev.id === event.id ? updatedOptimisticEvent : ev
      );

      // 4. Update the local state IMMEDIATELY for instant UI feedback
      setLocalEvents(optimisticEvents);
      console.log(`[CLIENT DND Optimistic] UI updated optimistically for ${event.id}`);

      // 5. Prepare data for the server action (needs ISO strings)
      const dataForAction: CalendarEvent = {
        id: event.id,
        title: event.title,
        status: event.status,
        notes: event.notes,
        start: start.toISOString(),
        end: end.toISOString(),
      };

      // 6. Call the server action in the background
      try {
        const result = await updateCalendarEventRefined(dataForAction);

        // 7. Handle Server Action Result
        if (!result.success) {
          // --- FAILURE: Revert UI and show error ---
          console.error("[CLIENT DND Optimistic] Failed server update action:", result.message);
          alert(`Error updating schedule: ${result.message}. Reverting change.`);
          setLocalEvents(originalEvents); // Rollback local state
        } else {
          // --- SUCCESS: Log confirmation ---
          console.log(`[CLIENT DND Optimistic] Server update successful for ${event.id}. Revalidation pending.`);
          // UI is already updated. Server action's revalidatePath will eventually confirm this.
          // No further local state change needed on success.
        }
      } catch (error) {
        // --- UNEXPECTED ERROR: Revert UI and show error ---
        console.error("[CLIENT DND Optimistic] Error calling update action after drop:", error);
        alert("An unexpected error occurred while saving the schedule change. Reverting change.");
        setLocalEvents(originalEvents); // Rollback on unexpected errors
      }
    },
    [localEvents] // DEPENDENCY: Need current localEvents to map and revert
  );

  // --- Render Component ---
  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header Section */}
      <header className="p-4 md:p-6 border-b dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm flex-shrink-0">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-primary dark:text-purple-400">ULE Homes Content Calendar</h1>
            {/* Refined Add Event Button */}
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
                 <input type="search" id="searchTerm" placeholder="🔍 Search by title or notes..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-primary focus:border-primary shadow-sm text-sm" />
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
            {/* Use DnDCalendar and pass the filtered LOCAL state */}
            <DnDCalendar
                localizer={localizer}
                events={filteredEvents} // USE THE STATE-DRIVEN FILTERED LIST
                startAccessor={(event: BigCalendarEvent) => event.start}
                endAccessor={(event: BigCalendarEvent) => event.end}
                style={{ minHeight: '600px' }}
                views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
                selectable
                onSelectEvent={handleSelectEvent}
                onSelectSlot={handleSelectSlot}
                popup
                components={{ event: CustomEvent }}
                defaultDate={new Date()}
                onEventDrop={handleEventDrop} // Use the optimistic handler
                resizable // Keep resizing enabled if desired
                // onEventResize={handleEventResize} // Implement if needed
            />
          </div>
      </div>

      {/* Edit/Add Event Modal */}
      {isModalOpen && (
        <EditEventModal
          event={selectedEvent ? { // If editing, create CalendarEvent structure for modal
              ...selectedEvent,
              // Assert as Date before calling toISOString
              start: (selectedEvent.start instanceof Date ? selectedEvent.start : new Date(selectedEvent.start)).toISOString(),
              end: (selectedEvent.end instanceof Date ? selectedEvent.end : new Date(selectedEvent.end)).toISOString(),
          } : null} // Pass null if adding
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}