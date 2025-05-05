// --- START FILE: components/EditEventModal.tsx ---
'use client';

import React, { useState, useEffect, FormEvent } from 'react';
import {
    CalendarEvent,
    updateCalendarEventRefined,
    createCalendarEvent,
    deleteCalendarEvent
} from '@/app/actions';
import { ZodIssue } from 'zod';

// Props Interface
interface EditEventModalProps {
  event: CalendarEvent | null;
  onClose: () => void;
}

// Date Formatting Helper for datetime-local input
const formatDateForInput = (date: Date | string | undefined): string => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  // Format required by datetime-local: YYYY-MM-DDTHH:mm
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// Define the shape of the form data
interface EventFormData {
    title: string;
    start: string; // Corresponds to Approval Date
    end: string;   // Corresponds to Publishing Date
    status: string;
    notes: string;
    attachment: string; // Field for attachment links (newline separated)
}

// Default Form Data
const defaultFormData: EventFormData = {
    title: '',
    start: formatDateForInput(new Date()),
    end: formatDateForInput(new Date(Date.now() + 60 * 60 * 1000)),
    status: '',
    notes: '',
    attachment: '',
};

// Helper to check if a string looks like a URL
const isUrl = (text: string): boolean => {
    const trimmed = text.trim();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

export default function EditEventModal({ event, onClose }: EditEventModalProps) {
  const isEditMode = !!event?.id;
  const [formData, setFormData] = useState<EventFormData>(defaultFormData);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined> | null>(null);

  // Effect to populate/reset form
  useEffect(() => {
    if (isEditMode && event) {
      setFormData({
        title: event.title,
        start: formatDateForInput(event.start),
        end: formatDateForInput(event.end),
        status: event.status,
        notes: event.notes || '',
        attachment: event.attachment || '',
      });
    } else {
      setFormData(defaultFormData);
    }
    setErrorMessage(null);
    setFieldErrors(null);
  }, [event, isEditMode]);

  // Input change handler
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear specific field error on change
    if (fieldErrors?.[name]) {
        setFieldErrors(prev => {
            if (!prev) return null;
            const updatedErrors = { ...prev };
            delete updatedErrors[name];
            // Return null if no errors left, useful for conditional styling
            const hasErrors = Object.values(updatedErrors).some(v => v && v.length > 0);
            return hasErrors ? updatedErrors : null;
        });
    }
    // Clear general error message when user starts typing again
    if (errorMessage) setErrorMessage(null);
  };

  // Form Submit Handler (Create/Update)
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setIsLoading(true); setErrorMessage(null); setFieldErrors(null);
    const dataToSend = {
        ...formData,
        start: formData.start ? new Date(formData.start).toISOString() : '',
        end: formData.end ? new Date(formData.end).toISOString() : '',
    };
    let result: { success: boolean; message: string; errors?: ZodIssue[] };
    try {
        if (isEditMode && event?.id) { result = await updateCalendarEventRefined({ ...dataToSend, id: event.id }); }
        else { result = await createCalendarEvent(dataToSend); }
        setIsLoading(false);
        if (result.success) { onClose(); }
        else {
            setErrorMessage(result.message);
            if (result.errors) {
                const mappedErrors: Record<string, string[]> = {};
                result.errors.forEach(issue => {
                    const path = issue.path[0] as string;
                    if (!mappedErrors[path]) mappedErrors[path] = [];
                    mappedErrors[path].push(issue.message);
                });
                setFieldErrors(mappedErrors);
                 // Focus the first field with an error for better UX
                 if (result.errors.length > 0) {
                    const firstErrorPath = result.errors[0].path[0];
                    const elementToFocus = document.getElementById(firstErrorPath as string);
                    elementToFocus?.focus();
                 }
            }
        }
    } catch (error) { setIsLoading(false); console.error("Submit Error:", error); setErrorMessage("An unexpected error occurred."); }
  };

  // Delete Handler
  const handleDelete = async () => {
      if (!isEditMode || !event?.id) return;
      const confirmed = window.confirm(`Delete "${event.title}"? This cannot be undone.`);
      if (!confirmed) return;
      setIsDeleting(true); setErrorMessage(null); setFieldErrors(null);
      try {
            const result = await deleteCalendarEvent({ eventId: event.id });
            setIsDeleting(false);
            if (result.success) { onClose(); }
            else { setErrorMessage(result.message); }
      } catch(error) { setIsDeleting(false); console.error("Delete Error:", error); setErrorMessage("An unexpected error occurred during delete."); }
  };

  // Spinner SVG Component
  const Spinner = () => (
    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

  // --- Render Modal ---
  return (
    // Increased max-width slightly
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-lg shadow-2xl w-full max-w-xl m-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <h2 className="text-xl sm:text-2xl font-semibold mb-6 text-gray-800 dark:text-gray-100 border-b pb-3 dark:border-gray-600">
            {isEditMode ? 'Edit Content Event' : 'Add New Content Event'}
        </h2>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-5"> {/* Added space-y for default spacing */}
          {/* General Error Message - Only show if no field-specific errors */}
          {errorMessage && !fieldErrors && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-600 rounded-md text-sm">
              {errorMessage}
            </div>
          )}

          {/* Title Input */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title <span className="text-red-500">*</span></label>
            <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                // Conditional styling for error state
                className={`w-full px-3 py-2 border rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                    fieldErrors?.title ? 'border-red-500 dark:border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-primary'
                }`}
                disabled={isLoading || isDeleting}
            />
             {fieldErrors?.title && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.title.join(', ')}</p>}
          </div>

          {/* Approval/Publishing Date Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5"> {/* Adjusted gap */}
            <div>
              <label htmlFor="start" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Approval Date <span className="text-red-500">*</span></label>
              <input
                  type="datetime-local"
                  id="start"
                  name="start"
                  value={formData.start}
                  onChange={handleChange}
                  required
                  className={`w-full px-3 py-2 border rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 appearance-none focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                    fieldErrors?.start ? 'border-red-500 dark:border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-primary'
                  }`}
                  disabled={isLoading || isDeleting}
              />
               {fieldErrors?.start && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.start.join(', ')}</p>}
            </div>
            <div>
              <label htmlFor="end" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Publishing Date <span className="text-red-500">*</span></label>
              <input
                  type="datetime-local"
                  id="end"
                  name="end"
                  value={formData.end}
                  onChange={handleChange}
                  required
                  className={`w-full px-3 py-2 border rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 appearance-none focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                    fieldErrors?.end ? 'border-red-500 dark:border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-primary'
                  }`}
                  disabled={isLoading || isDeleting}
              />
              {fieldErrors?.end && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.end.join(', ')}</p>}
            </div>
          </div>

          {/* Status Select */}
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status <span className="text-red-500">*</span></label>
            <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                required
                className={`w-full px-3 py-2 border rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                    fieldErrors?.status ? 'border-red-500 dark:border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-primary'
                }`}
                disabled={isLoading || isDeleting}
            >
              <option value="" disabled>Select Status</option>
              <option value="Draft">Draft</option><option value="Planned">Planned</option><option value="In Progress">In Progress</option><option value="Needs Review">Needs Review</option><option value="Approved">Approved</option><option value="Published">Published</option><option value="Confirmed">Confirmed</option>
            </select>
             {fieldErrors?.status && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.status.join(', ')}</p>}
          </div>

          {/* Notes Textarea */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
                id="notes"
                name="notes"
                rows={5} // Increased rows for "bigger" notes area
                value={formData.notes}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                    fieldErrors?.notes ? 'border-red-500 dark:border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-primary'
                }`}
                disabled={isLoading || isDeleting}
                placeholder="Add relevant details, instructions, or context. Use new lines for lists." // Added helpful placeholder
            />
              {fieldErrors?.notes && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.notes.join(', ')}</p>}
          </div>

          {/* Attachment Section */}
          <div>
            <label htmlFor="attachment" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Attachment Links</label>
            <textarea
                id="attachment"
                name="attachment"
                rows={3} // Keep rows moderate
                value={formData.attachment}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                    fieldErrors?.attachment ? 'border-red-500 dark:border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-primary'
                }`}
                disabled={isLoading || isDeleting}
                placeholder="Enter external URLs (e.g., Google Docs, Figma), one per line..."
            />
             {fieldErrors?.attachment && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.attachment.join(', ')}</p>}

            {/* Clickable Links Preview Area */}
            {formData.attachment && formData.attachment.trim() !== '' && (
                 // Slightly different background for visual distinction
                <div className="mt-2 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-900/30">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">Clickable Links:</h4>
                    <div className="space-y-1">
                        {formData.attachment
                            .split('\n')
                            .map(line => line.trim())
                            .filter(line => isUrl(line))
                            .map((url, index) => (
                                <a
                                    key={index}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block text-sm text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-800 dark:hover:text-blue-300 break-all transition-colors duration-150"
                                >
                                    {url}
                                </a>
                         ))}
                         {/* Message if no valid URLs found */}
                         {formData.attachment.split('\n').map(line => line.trim()).filter(line => isUrl(line)).length === 0 && (
                            <p className='text-xs text-gray-500 dark:text-gray-400 italic'>No valid URLs (starting with http:// or https://) found above.</p>
                         )}
                    </div>
                </div>
            )}
          </div>
          {/* --- End Attachment Section --- */}

          {/* Action Buttons Area */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-5 border-t border-gray-200 dark:border-gray-700 mt-6">
              {/* Delete Button */}
              <div className="flex-shrink-0 w-full sm:w-auto">
                 {isEditMode ? (
                     <button type="button" onClick={handleDelete} disabled={isDeleting || isLoading} className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 bg-red-600 text-white rounded-lg font-semibold text-sm shadow-md hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500 dark:focus-visible:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all duration-150 ease-in-out">
                        {isDeleting ? <><Spinner /> Deleting...</> : '🗑️ Delete'}
                     </button>
                 ) : (<div className="h-11"></div>)} {/* Placeholder for layout consistency */}
             </div>
             {/* Cancel & Save/Create Buttons */}
            <div className="flex gap-4 w-full sm:w-auto justify-end">
                 <button type="button" onClick={onClose} disabled={isLoading || isDeleting} className="px-5 py-2.5 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg font-semibold text-sm hover:bg-gray-300 dark:hover:bg-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500 dark:focus-visible:ring-offset-gray-800 disabled:opacity-50 active:scale-95 transition-colors duration-150 ease-in-out">
                     Cancel
                 </button>
                 <button type="submit" disabled={isLoading || isDeleting} className="inline-flex items-center justify-center px-5 py-2.5 bg-primary text-white rounded-lg font-semibold text-sm shadow-md hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-600 dark:focus-visible:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all duration-150 ease-in-out">
                    {isLoading ? <><Spinner /> Saving...</> : (isEditMode ? 'Save Changes' : 'Create Event')}
                 </button>
            </div>
          </div>
        </form> 
      </div>
    </div>
  );
}
