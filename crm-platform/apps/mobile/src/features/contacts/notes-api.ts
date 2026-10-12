import {
  contactNoteResponseSchema,
  pageResponseSchema,
  type CreateContactNoteInput,
  type UpdateContactNoteInput,
} from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch } from '@/lib/api';

export const contactNotePageSchema = pageResponseSchema(contactNoteResponseSchema);
export type ContactNotePage = z.infer<typeof contactNotePageSchema>;

/** The paging the API takes (`listContactNotesQuerySchema`); newest first is its default order. */
export type NotePageParams = { limit: number; cursor?: string };

const notesPath = (contactId: string) => `/v2/contacts/${encodeURIComponent(contactId)}/notes`;

/** One page of a contact's notes, newest first. */
export const listContactNotes = (contactId: string, params: NotePageParams, signal?: AbortSignal) =>
  apiFetch(notesPath(contactId), { query: params, schema: contactNotePageSchema, signal });

export const createContactNote = (
  contactId: string,
  body: CreateContactNoteInput,
  idempotencyKey?: string,
) =>
  apiFetch(notesPath(contactId), {
    method: 'POST',
    body,
    schema: contactNoteResponseSchema,
    idempotencyKey,
  });

/** Changes a note's text. `rowVersion` is the version that was read; a stale one is 409 ROW_VERSION_CONFLICT. */
export const updateContactNote = (
  contactId: string,
  id: string,
  body: UpdateContactNoteInput,
  idempotencyKey?: string,
) =>
  apiFetch(`${notesPath(contactId)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    schema: contactNoteResponseSchema,
    idempotencyKey,
  });

/** Deletes a note. The API answers 204 with no body, so there is no schema to parse. */
export const deleteContactNote = (contactId: string, id: string) =>
  apiFetch(`${notesPath(contactId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
