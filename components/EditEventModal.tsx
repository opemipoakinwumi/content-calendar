// --- START FILE: components/EditEventModal.tsx ---
'use client';

import React, { useState, useEffect, FormEvent, useRef } from 'react'; // Added useRef
import {
    CalendarEvent,
    updateCalendarEventRefined,
    createCalendarEvent,
    deleteCalendarEvent
} from '@/app/actions';
import { ZodIssue } from 'zod';

// --- Icons --- (Keep existing icon components)
const TitleIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1.5 inline-block text-gray-400 dark:text-gray-500"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>;
const CalendarIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1.5 inline-block text-gray-400 dark:text-gray-500"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12v-.008zM15 12h.008v.008H15v-.008zM15 15h.008v.008H15v-.008zM9 15h.008v.008H9v-.008z" /></svg>;
const StatusIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1.5 inline-block text-gray-400 dark:text-gray-500"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0l-3.75-3.75M17.25 21L21 17.25" /></svg>;
const NotesIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1.5 inline-block text-gray-400 dark:text-gray-500"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>;
const AttachmentIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1.5 inline-block text-gray-400 dark:text-gray-500"><path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.122 2.122l7.81-7.81" /></svg>;
const RemoveIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
// --- End Icons ---

interface EditEventModalProps {
  event: CalendarEvent | null;
  onClose: () => void;
}

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

interface EventFormData {
    title: string;
    start: string;
    end: string;
    status: string;
    notes: string;
}

interface AttachmentState {
    urls: string[];
    newUrlInput: string;
    error: string | null;
}

const defaultFormData: EventFormData = {
    title: '',
    start: formatDateForInput(new Date()),
    end: formatDateForInput(new Date(Date.now() + 60 * 60 * 1000)),
    status: '', // Default status will be set in useEffect for new events
    notes: '',
};

const defaultAttachmentState: AttachmentState = {
    urls: [],
    newUrlInput: '',
    error: null,
}

const isUrl = (text: string): boolean => {
    try {
        const url = new URL(text.trim());
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) { return false; }
}

export default function EditEventModal({ event, onClose }: EditEventModalProps) {
  const isEditMode = !!event?.id;
  const [formData, setFormData] = useState<EventFormData>(defaultFormData);
  const [attachments, setAttachments] = useState<AttachmentState>(defaultAttachmentState);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null); // Ref for focusing title input

  useEffect(() => {
    if (isEditMode && event) {
      setFormData({
        title: event.title,
        start: formatDateForInput(event.start),
        end: formatDateForInput(event.end),
        status: event.status,
        notes: event.notes || '',
      });
      const initialUrls = event.attachment?.split('\n').map(u => u.trim()).filter(u => u !== '' && isUrl(u)) ?? [];
      setAttachments({ urls: initialUrls, newUrlInput: '', error: null });
    } else {
      setFormData({...defaultFormData, status: 'Draft'}); // Default to Draft
      setAttachments(defaultAttachmentState);
      // Focus title input on mount for new events
      titleInputRef.current?.focus();
    }
    setErrorMessage(null);
    setFieldErrors(null);
  }, [event, isEditMode]); // Rerun only when event or mode changes

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    clearFieldError(name);
  };

  const handleAttachmentInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachments(prev => ({ ...prev, newUrlInput: e.target.value, error: null }));
  }

  const handleAddAttachment = () => {
      const urlToAdd = attachments.newUrlInput.trim();
      if (!urlToAdd) { setAttachments(prev => ({...prev, error: 'Please enter a URL.'})); return; }
      if (!isUrl(urlToAdd)) { setAttachments(prev => ({...prev, error: 'Invalid URL format (must start with http:// or https://)'})); return; }
      if (attachments.urls.includes(urlToAdd)) { setAttachments(prev => ({...prev, error: 'This URL has already been added.'})); return; }
      setAttachments(prev => ({ urls: [...prev.urls, urlToAdd], newUrlInput: '', error: null }));
      clearFieldError('attachment');
  }

  const handleRemoveAttachment = (urlToRemove: string) => {
      setAttachments(prev => ({ ...prev, urls: prev.urls.filter(url => url !== urlToRemove) }));
      clearFieldError('attachment');
  }

  const clearFieldError = (fieldName: string) => {
        if (fieldErrors?.[fieldName]) {
            setFieldErrors(prev => {
                if (!prev) return null;
                const updatedErrors = { ...prev };
                delete updatedErrors[fieldName];
                const hasErrors = Object.values(updatedErrors).some(v => v && v.length > 0);
                return hasErrors ? updatedErrors : null;
            });
        }
         if (errorMessage) setErrorMessage(null);
   }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setIsLoading(true); setErrorMessage(null); setFieldErrors(null);
    const startIso = formData.start ? new Date(formData.start).toISOString() : '';
    const endIso = formData.end ? new Date(formData.end).toISOString() : '';
    const dataForValidation = {
        title: formData.title, status: formData.status, notes: formData.notes,
        start: startIso, end: endIso,
        attachment: attachments.urls.join('\n') || null,
    };
    let result: { success: boolean; message: string; errors?: ZodIssue[] };
    try {
        if (isEditMode && event?.id) {
            const updateData = { ...dataForValidation, id: event.id };
            result = await updateCalendarEventRefined(updateData);
        } else {
            result = await createCalendarEvent(dataForValidation);
        }
        if (result.success) { onClose(); } // Close immediately on success
        else {
            setIsLoading(false); // Keep modal open on error
            setErrorMessage(result.message);
            if (result.errors) {
                const mappedErrors: Record<string, string[]> = {};
                result.errors.forEach(issue => { const path = issue.path[0] as string; if (!mappedErrors[path]) mappedErrors[path] = []; mappedErrors[path].push(issue.message); });
                setFieldErrors(mappedErrors);
                 if (result.errors.length > 0) {
                    const firstErrorPath = result.errors[0].path[0];
                    const elementToFocus = document.getElementById(firstErrorPath as string);
                    elementToFocus?.focus({ preventScroll: true });
                 }
            }
        }
    } catch (error) {
        setIsLoading(false); // Ensure loading is stopped on catch
        console.error("Submit Error:", error);
        setErrorMessage("An unexpected error occurred.");
     }
  };

  const handleDelete = async () => {
      if (!isEditMode || !event?.id) return;
      const confirmed = window.confirm(`Delete "${event.title}"? This cannot be undone.`);
      if (!confirmed) return;
      setIsDeleting(true); setErrorMessage(null); setFieldErrors(null);
      try {
            const result = await deleteCalendarEvent({ eventId: event.id });
            // No need to set deleting false if closing anyway
            if (result.success) { onClose(); } else {
                setIsDeleting(false); // Keep modal open on error
                setErrorMessage(result.message);
            }
      } catch(error) {
          setIsDeleting(false); // Ensure deleting is stopped on catch
          console.error("Delete Error:", error);
          setErrorMessage("An unexpected error occurred during delete.");
      }
  };

  const Spinner = () => (
    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
  );

   // Base input classes
   const inputBaseClasses = "block w-full px-3 py-2 border rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800";
   const inputErrorClasses = "border-red-500 dark:border-red-400 focus:border-red-500 focus:ring-red-500";
   const inputValidClasses = "border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-primary";

  // Style for form overlay when loading/deleting
  const overlayActive = isLoading || isDeleting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4">
      {/* Added relative positioning for overlay */}
      <div className="relative bg-white dark:bg-gray-800 p-6 md:p-8 rounded-lg shadow-2xl w-full max-w-xl m-4 max-h-[90vh] overflow-y-auto">
        {/* Loading/Deleting Overlay */}
        {overlayActive && (
            <div className="absolute inset-0 bg-white/70 dark:bg-gray-800/70 flex items-center justify-center rounded-lg z-10 cursor-wait">
                 {/* Optional: Add a larger spinner here if desired */}
                 {/* <Spinner /> */}
            </div>
        )}

        {/* Header */}
        <h2 className="text-xl sm:text-2xl font-semibold mb-6 text-gray-800 dark:text-gray-100 border-b pb-3 dark:border-gray-600">
            {isEditMode ? 'Edit Content Event' : 'Add New Content Event'}
        </h2>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* General Error Message */}
          {errorMessage && !fieldErrors && ( <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-600 rounded-md text-sm">{errorMessage}</div> )}

          {/* --- Group 1: Core Details --- */}
          <div className="space-y-5 p-4 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50/50 dark:bg-gray-900/20">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wider">Details</h3>
            <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"><TitleIcon />Title <span className="text-red-500">*</span></label>
                <input type="text" id="title" name="title" value={formData.title} onChange={handleInputChange} required ref={titleInputRef} // Added ref
                    className={`${inputBaseClasses} ${fieldErrors?.title ? inputErrorClasses : inputValidClasses}`}
                    disabled={overlayActive} />
                {fieldErrors?.title && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.title.join(', ')}</p>}
            </div>
            <div>
                <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"><StatusIcon />Status <span className="text-red-500">*</span></label>
                <select id="status" name="status" value={formData.status} onChange={handleInputChange} required
                    className={`${inputBaseClasses} ${fieldErrors?.status ? inputErrorClasses : inputValidClasses}`}
                    disabled={overlayActive}>
                <option value="" disabled>Select Status</option>
                <option value="Draft">Draft</option><option value="Planned">Planned</option><option value="In Progress">In Progress</option><option value="Needs Review">Needs Review</option><option value="Approved">Approved</option><option value="Published">Published</option><option value="Confirmed">Confirmed</option>
                </select>
                {fieldErrors?.status && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.status.join(', ')}</p>}
            </div>
          </div>

           {/* --- Group 2: Scheduling --- */}
           <div className="space-y-5 p-4 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50/50 dark:bg-gray-900/20">
             <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wider">Scheduling</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5">
                  <div>
                    <label htmlFor="start" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"><CalendarIcon />Approval Date <span className="text-red-500">*</span></label>
                    <input type="datetime-local" id="start" name="start" value={formData.start} onChange={handleInputChange} required
                           className={`appearance-none ${inputBaseClasses} ${fieldErrors?.start ? inputErrorClasses : inputValidClasses}`}
                           disabled={overlayActive} />
                    {fieldErrors?.start && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.start.join(', ')}</p>}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Date content creation is approved.</p> {/* Helper text */}
                  </div>
                  <div>
                    <label htmlFor="end" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"><CalendarIcon />Publishing Date <span className="text-red-500">*</span></label>
                    <input type="datetime-local" id="end" name="end" value={formData.end} onChange={handleInputChange} required
                           className={`appearance-none ${inputBaseClasses} ${fieldErrors?.end ? inputErrorClasses : inputValidClasses}`}
                           disabled={overlayActive} min={formData.start || undefined} />
                    {fieldErrors?.end && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.end.join(', ')}</p>}
                     <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Date content goes live.</p> {/* Helper text */}
                  </div>
              </div>
            </div>

           {/* --- Group 3: Content --- */}
            <div className="space-y-5 p-4 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50/50 dark:bg-gray-900/20">
                 <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wider">Content Details</h3>
                <div>
                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"><NotesIcon />Notes</label>
                    <textarea id="notes" name="notes" rows={5} value={formData.notes} onChange={handleInputChange}
                        className={`font-mono ${inputBaseClasses} ${fieldErrors?.notes ? inputErrorClasses : inputValidClasses}`}
                        disabled={overlayActive}
                        placeholder="Add details, instructions, content goals, CTAs, etc. Use new lines and symbols like - or * for structure." />
                    {fieldErrors?.notes && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.notes.join(', ')}</p>}
                </div>
                <div>
                    <label htmlFor="attachment-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"><AttachmentIcon />Attachment Links</label>
                     <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Add external links (e.g., Instagram, TikTok) relevant to this content piece.</p> {/* Helper text */}
                    <div className="flex items-center gap-2">
                        <input type="url" id="attachment-input" value={attachments.newUrlInput} onChange={handleAttachmentInputChange}
                            className={`flex-grow ${inputBaseClasses} ${attachments.error ? inputErrorClasses : inputValidClasses}`}
                            placeholder="Paste URL (http:// or https://)" disabled={overlayActive} aria-invalid={!!attachments.error} aria-describedby={attachments.error ? "attachment-error-msg" : undefined} />
                        <button type="button" onClick={handleAddAttachment}
                            className="flex-shrink-0 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800 disabled:opacity-50"
                            disabled={overlayActive || !attachments.newUrlInput} > Add </button>
                    </div>
                    {attachments.error && <p id="attachment-error-msg" className="text-red-500 dark:text-red-400 text-xs mt-1">{attachments.error}</p>}
                    {fieldErrors?.attachment && !attachments.error && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{fieldErrors.attachment.join(', ')}</p>}
                    {attachments.urls.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
                            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Added Links:</h4>
                            <ul className="list-none p-0 m-0 space-y-1">
                                {attachments.urls.map((url, index) => (
                                    <li key={index} className="flex items-center justify-between text-sm bg-white dark:bg-gray-700/80 p-2 rounded border border-gray-200 dark:border-gray-600 shadow-sm">
                                        <a href={url} target="_blank" rel="noopener noreferrer" title={url}
                                            className="text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-800 dark:hover:text-blue-300 break-all mr-2 flex-grow min-w-0">
                                            {url.length > 60 ? `${url.substring(0, 57)}...` : url}
                                        </a>
                                        <button type="button" onClick={() => handleRemoveAttachment(url)} disabled={overlayActive}
                                            className="flex-shrink-0 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 focus:outline-none p-1 rounded-full hover:bg-red-100 dark:hover:bg-red-800/50 transition-colors duration-150"
                                            aria-label={`Remove ${url}`} title="Remove link">
                                            <RemoveIcon />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

          {/* Action Buttons Area */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-5 border-t border-gray-200 dark:border-gray-700 mt-6">
              <div className="flex-shrink-0 w-full sm:w-auto">
                 {isEditMode ? (
                     <button type="button" onClick={handleDelete} disabled={overlayActive} /* Disable during any loading */
                         className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 bg-red-600 text-white rounded-lg font-semibold text-sm shadow-md hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500 dark:focus-visible:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all duration-150 ease-in-out">
                        {isDeleting ? <><Spinner /> Deleting...</> : '🗑️ Delete'}
                     </button>
                 ) : (<div className="h-11"></div>)}
             </div>
            <div className="flex gap-3 w-full sm:w-auto justify-end"> {/* Reduced gap slightly */}
                 {/* Cancel Button - Secondary Style */}
                 <button type="button" onClick={onClose} disabled={overlayActive}
                     className="px-5 py-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-offset-gray-800 disabled:opacity-50 active:scale-95 transition-colors duration-150 ease-in-out">
                     Cancel
                 </button>
                 {/* Save/Create Button - Primary Style */}
                 <button type="submit" disabled={overlayActive}
                     className="inline-flex items-center justify-center px-5 py-2.5 bg-primary text-white rounded-lg font-semibold text-sm shadow-md hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-600 dark:focus-visible:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all duration-150 ease-in-out">
                    {isLoading ? <><Spinner /> Saving...</> : (isEditMode ? 'Save Changes' : 'Create Event')}
                 </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}