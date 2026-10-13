import {
  conversationEventListResponseSchema,
  conversationNoteSchema,
  pageResponseSchema,
  type CreateConversationNoteInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** Internal notes and the activity timeline of a conversation: staff only, never sent to the customer. */

const NOTES_LIMIT = 100;
const EVENTS_LIMIT = 100;
const notePageSchema = pageResponseSchema(conversationNoteSchema);

/** The notes, newest first (`inbox.conversation.read`). */
export const fetchNotes = (conversationId: string, signal?: AbortSignal) =>
  apiFetch(`/v2/inbox/conversations/${conversationId}/notes`, {
    query: { limit: NOTES_LIMIT },
    schema: notePageSchema,
    signal,
  });

/** Adds a note (`inbox.conversation.note`); the key makes a repeat of the same press one note. */
export const addNote = (
  conversationId: string,
  input: CreateConversationNoteInput,
  idempotencyKey?: string,
) =>
  apiFetch(`/v2/inbox/conversations/${conversationId}/notes`, {
    method: 'POST',
    body: input,
    schema: conversationNoteSchema,
    idempotencyKey,
  });

/** Deletes a note: its author may, and so may anyone who manages assignments. */
export const deleteNote = (conversationId: string, noteId: string) =>
  apiFetch(`/v2/inbox/conversations/${conversationId}/notes/${noteId}`, { method: 'DELETE' });

/** What happened to the conversation, newest first: assigned, resolved, labelled, snoozed and so on. */
export const fetchEvents = (conversationId: string, signal?: AbortSignal) =>
  apiFetch(`/v2/inbox/conversations/${conversationId}/events`, {
    query: { limit: EVENTS_LIMIT },
    schema: conversationEventListResponseSchema,
    signal,
  });
