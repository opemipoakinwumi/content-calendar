// components/EditEventModal.tsx
'use client';

import React, { useState, useEffect, FormEvent } from 'react';
import { CalendarEvent, updateCalendarEventRefined } from '@/app/actions'; // Use refined action

// Define the props for the modal
interface EditEventModalProps {
  event: CalendarEvent | null; // Event to edit, or null if modal is closed
  onClose: () => void;
  onSave: (updatedEvent: CalendarEvent) => Promise<{ success: boolean; message: string; errors?: any }>; // Use the Server Action type
}

// Helper to format date for datetime-local input
const formatDateForInput = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return ''; // Handle invalid date

  // Format: YYYY-MM-DDTHH:mm
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};


export default function EditEventModal({ event, onClose, onSave }: EditEventModalProps) {
  const [formData, setFormData] = useState<Omit<CalendarEvent, 'id' | 'start' | 'end'> & { start: string; end: string }>({
    title: '',
    start: '',
    end: '',
    status: '',
    notes: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined> | null>(null);


  // Update form data when the event prop changes
  useEffect(() => {
    if (event) {
      setFormData({
        title: event.title,
        // Convert Date objects back to string format suitable for input type="datetime-local"
        start: formatDateForInput(event.start),
        end: formatDateForInput(event.end),
        status: event.status,
        notes: event.notes || '',
      });
       setErrorMessage(null); // Clear previous errors
       setFieldErrors(null);
    }
  }, [event]);

  if (!event) {
    return null; // Don't render the modal if no event is selected
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setFieldErrors(null);

    // Prepare data for the server action (ensure dates are valid ISO strings)
    const eventToSave: CalendarEvent = {
      ...event, // Keep the original ID
      ...formData,
       // Convert local datetime string back to ISO string (UTC assumed for this example)
       // Consider timezone handling if necessary
       start: new Date(formData.start).toISOString(),
       end: new Date(formData.end).toISOString(),
    };

    console.log('Submitting event:', eventToSave);

    const result = await onSave(eventToSave); // Call the Server Action passed via props

    setIsLoading(false);

    if (result.success) {
      console.log('Save successful');
      onClose(); // Close the modal on success
    } else {
      console.error('Save failed:', result.message, result.errors);
      setErrorMessage(result.message);
       if (result.errors) {
           setFieldErrors(result.errors as Record<string, string[] | undefined>);
       }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm">
      <div className="bg-white p-6 md:p-8 rounded-lg shadow-2xl w-full max-w-lg m-4">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800">Edit Content Event</h2>
        <form onSubmit={handleSubmit}>
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 border border-red-300 rounded">
              {errorMessage}
            </div>
          )}
          <div className="mb-4">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary"
            />
             {fieldErrors?.title && <p className="text-red-500 text-xs mt-1">{fieldErrors.title.join(', ')}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="start" className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input
                type="datetime-local"
                id="start"
                name="start"
                value={formData.start}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary"
              />
               {fieldErrors?.start && <p className="text-red-500 text-xs mt-1">{fieldErrors.start.join(', ')}</p>}
            </div>
            <div>
              <label htmlFor="end" className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input
                type="datetime-local"
                id="end"
                name="end"
                value={formData.end}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary"
              />
              {fieldErrors?.end && <p className="text-red-500 text-xs mt-1">{fieldErrors.end.join(', ')}</p>}
            </div>
          </div>

          <div className="mb-4">
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              id="status"
              name="status"
              value={formData.status}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary bg-white"
            >
              <option value="">Select Status</option>
              <option value="Draft">Draft</option>
              <option value="Planned">Planned</option>
              <option value="In Progress">In Progress</option>
              <option value="Needs Review">Needs Review</option>
              <option value="Approved">Approved</option>
              <option value="Published">Published</option>
              <option value="Confirmed">Confirmed</option> {/* Added from example */}
            </select>
             {fieldErrors?.status && <p className="text-red-500 text-xs mt-1">{fieldErrors.status.join(', ')}</p>}
          </div>

          <div className="mb-6">
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              value={formData.notes}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary"
            />
              {fieldErrors?.notes && <p className="text-red-500 text-xs mt-1">{fieldErrors.notes.join(', ')}</p>}
          </div>

          <div className="flex justify-end gap-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-primary text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}