'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { contactFileResponseSchema, type ContactFileResponse } from '@crm/contracts';
import { API_CALL_TIMEOUT_MS, apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { useCursorList } from '@/lib/api/use-cursor-list';

export const FILE_KEYS = {
  list: (contactId: string) => ['cat', 'files', contactId] as const,
  activities: (contactId: string) => ['cat', 'activities', contactId] as const,
};

/** The files recorded against a contact, newest first. */
export function useContactFiles(contactId: string, enabled = true) {
  return useCursorList(
    FILE_KEYS.list(contactId),
    `/contacts/${contactId}/files`,
    contactFileResponseSchema,
    {},
    { enabled },
  );
}

/**
 * Sends one file (`POST /contacts/:id/files/upload`, multipart field `file`). `apiFetch` only speaks JSON, so this does the same
 * request by hand through the same-origin proxy: the browser sets the multipart boundary, the proxy adds the token.
 */
async function uploadContactFile(contactId: string, file: File): Promise<ContactFileResponse> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`/api/v2/contacts/${contactId}/files/upload`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body,
    signal: AbortSignal.timeout(API_CALL_TIMEOUT_MS),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return contactFileResponseSchema.parse(json);
}

/** Adds a file to the contact (`record.contacts.update`). The list and the activity feed are refreshed on success. */
export function useUploadContactFile(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadContactFile(contactId, file),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: FILE_KEYS.list(contactId) }),
        qc.invalidateQueries({ queryKey: FILE_KEYS.activities(contactId) }),
      ]),
  });
}

/** Removes a file record from the contact (`record.contacts.update`). */
export function useRemoveContactFile(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<void> =>
      apiFetch(`/contacts/${contactId}/files/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: FILE_KEYS.list(contactId) }),
        qc.invalidateQueries({ queryKey: FILE_KEYS.activities(contactId) }),
      ]),
    onError: () => qc.invalidateQueries({ queryKey: FILE_KEYS.list(contactId) }),
  });
}
