import { contactFileResponseSchema, pageResponseSchema } from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch } from '@/lib/api';

export const contactFilePageSchema = pageResponseSchema(contactFileResponseSchema);
export type ContactFilePage = z.infer<typeof contactFilePageSchema>;

/** The paging the API takes (`listContactFilesQuerySchema`); newest first is its default order. */
export type FilePageParams = { limit: number; cursor?: string };

const filesPath = (contactId: string) => `/v2/contacts/${encodeURIComponent(contactId)}/files`;

/**
 * One page of a contact's files, newest first. The API keeps file records only (name, size, type, date): there is no route to
 * upload the bytes or to download them, so the app can list and delete records but not add or open a file.
 */
export const listContactFiles = (contactId: string, params: FilePageParams, signal?: AbortSignal) =>
  apiFetch(filesPath(contactId), { query: params, schema: contactFilePageSchema, signal });

/** Deletes a file record. The API answers 204 with no body. */
export const deleteContactFile = (contactId: string, id: string) =>
  apiFetch(`${filesPath(contactId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
