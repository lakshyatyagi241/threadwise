'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  contactNoteResponseSchema,
  type CreateContactNoteInput,
  type UpdateContactNoteInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useCursorList } from '@/lib/api/use-cursor-list';

/** The longest note the API takes (`createContactNoteSchema`). */
export const NOTE_BODY_MAX = 10_000;

export const NOTE_KEYS = {
  list: (contactId: string) => ['cat', 'notes', contactId] as const,
  /** The contact's timeline: a note change adds a line to it. */
  activities: (contactId: string) => ['cat', 'activities', contactId] as const,
};

/** A contact's notes, newest first (the order the API returns), fifty at a time. */
export function useContactNotes(contactId: string, enabled = true) {
  return useCursorList(
    NOTE_KEYS.list(contactId),
    `/contacts/${contactId}/notes`,
    contactNoteResponseSchema,
    {},
    { enabled },
  );
}

/** Create, edit (with the `rowVersion` the person saw) and delete a note; each refreshes the notes and the timeline. */
export function useNoteMutations(contactId: string) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: NOTE_KEYS.list(contactId) }),
      qc.invalidateQueries({ queryKey: NOTE_KEYS.activities(contactId) }),
    ]);
  const path = `/contacts/${contactId}/notes`;

  const create = useMutation({
    mutationFn: (input: CreateContactNoteInput) =>
      apiFetch(path, { method: 'POST', body: input, schema: contactNoteResponseSchema }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateContactNoteInput & { id: string }) =>
      apiFetch(`${path}/${id}`, { method: 'PATCH', body, schema: contactNoteResponseSchema }),
    onSuccess: refresh,
    // A stale `rowVersion` (409) or a note gone elsewhere: show what is there now; the person decides, nothing is retried.
    onError: () => qc.invalidateQueries({ queryKey: NOTE_KEYS.list(contactId) }),
  });
  const remove = useMutation({
    mutationFn: (id: string): Promise<void> => apiFetch(`${path}/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: () => qc.invalidateQueries({ queryKey: NOTE_KEYS.list(contactId) }),
  });
  return { create, update, remove };
}
