// components/EditEventModal.tsx
'use client';

import React, { useState, useEffect, FormEvent } from 'react';
import {
    CalendarEvent,
    updateCalendarEventRefined,
    createCalendarEvent,
    deleteCalendarEvent
} from '@/app/actions';
import { ZodIssue } from 'zod';

// Props Interface (onSave removed)
interface EditEventModalProps {
  event: CalendarEvent | null;
  onClose: () => void;
}

// Date Formatting Helper
const formatDateForInput = (date: Date | string | undefined): string => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// Default Form Data
const defaultFormData = {
    title: '',
    start: formatDateForInput(new Date()),
    end: formatDateForInput(new Date(Date.now() + 60 * 60 * 1000)),
    status: '',
    notes: '',
};

export default function EditEventModal({ event, onClose }: EditEventModalProps) {
  const isEditMode = !!event?.id;
  const [formData, setFormData] = useState<Omit<CalendarEvent, 'id'>>(defaultFormData);
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
      });
    } else { setFormData(defaultFormData); }
    setErrorMessage(null); setFieldErrors(null);
  }, [event, isEditMode]);

  // Input change handler
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors?.[name]) { setFieldErrors(prev => ({...prev, [name]: undefined})); }
    setErrorMessage(null);
  };

  // Form Submit Handler (Create/Update)
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setIsLoading(true); setErrorMessage(null); setFieldErrors(null);
    const dataToSend = { ...formData, start: formData.start ? new Date(formData.start).toISOString() : '', end: formData.end ? new Date(formData.end).toISOString() : '' };
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
                result.errors.forEach(issue => { const path = issue.path[0] as string; if (!mappedErrors[path]) mappedErrors[path] = []; mappedErrors[path].push(issue.message); });
                setFieldErrors(mappedErrors);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-lg shadow-2xl w-full max-w-lg m-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl sm:text-2xl font-semibold mb-6 text-gray-800 dark:text-gray-100 border-b pb-3 dark:border-gray-600">
            {isEditMode ? 'Edit Content Event' : 'Add New Content Event'}
        </h2>
        <form onSubmit={handleSubmit}>
          {/* General Error Message */}
          {errorMessage && !Object.values(fieldErrors ?? {}).some(v => v && v.length > 0) && ( // Show only if no specific field errors exist
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-600 rounded-md text-sm">
              {errorMessage}
            </div>
          )}
          {/* Title Input */}
          <div className="mb-4">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title <span className="text-red-500">*</span></label>
            <input type="text" id="title" name="title" value={formData.title} onChange={handleChange} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary focus:border-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60" disabled={isLoading || isDeleting}/>
             {fieldErrors?.title && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.title.join(', ')}</p>}
          </div>
          {/* Start/End Time Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="start" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Time <span className="text-red-500">*</span></label>
              <input type="datetime-local" id="start" name="start" value={formData.start} onChange={handleChange} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary focus:border-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 appearance-none" disabled={isLoading || isDeleting}/>
               {fieldErrors?.start && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.start.join(', ')}</p>}
            </div>
            <div>
              <label htmlFor="end" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Time <span className="text-red-500">*</span></label>
              <input type="datetime-local" id="end" name="end" value={formData.end} onChange={handleChange} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary focus:border-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 appearance-none" disabled={isLoading || isDeleting}/>
              {fieldErrors?.end && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.end.join(', ')}</p>}
            </div>
          </div>
          {/* Status Select */}
          <div className="mb-4">
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status <span className="text-red-500">*</span></label>
            <select id="status" name="status" value={formData.status} onChange={handleChange} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary focus:border-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60" disabled={isLoading || isDeleting}>
              <option value="" disabled>Select Status</option>
              <option value="Draft">Draft</option><option value="Planned">Planned</option><option value="In Progress">In Progress</option><option value="Needs Review">Needs Review</option><option value="Approved">Approved</option><option value="Published">Published</option><option value="Confirmed">Confirmed</option>
            </select>
             {fieldErrors?.status && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.status.join(', ')}</p>}
          </div>
          {/* Notes Textarea */}
          <div className="mb-6">
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea id="notes" name="notes" rows={3} value={formData.notes} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary focus:border-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60" disabled={isLoading || isDeleting} placeholder="Add any relevant details or links..."/>
              {fieldErrors?.notes && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.notes.join(', ')}</p>}
          </div>
          {/* Action Buttons Area */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-gray-200 dark:border-gray-700 mt-2">
              {/* Delete Button */}
              <div className="flex-shrink-0 w-full sm:w-auto">
                 {isEditMode ? (
                     <button type="button" onClick={handleDelete} disabled={isDeleting || isLoading} className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 bg-red-600 text-white rounded-lg font-semibold text-sm shadow-md hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500 dark:focus-visible:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all duration-150 ease-in-out">
                        {isDeleting ? <><Spinner /> Deleting...</> : '🗑️ Delete'}
                     </button>
                 ) : (<div className="h-11"></div>) /* Placeholder */}
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