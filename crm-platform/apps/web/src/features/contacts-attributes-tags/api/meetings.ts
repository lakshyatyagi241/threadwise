'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  contactMeetingResponseSchema,
  type CreateContactMeetingInput,
  type UpdateContactMeetingInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useCursorList } from '@/lib/api/use-cursor-list';

export const MEETING_KEYS = {
  list: (contactId: string) => ['cat', 'meetings', contactId] as const,
  /** The contact's timeline: a meeting change adds a line to it. */
  activities: (contactId: string) => ['cat', 'activities', contactId] as const,
};

/** A contact's logged meetings, in the order the API returns them, fifty at a time. */
export function useContactMeetings(contactId: string) {
  return useCursorList(
    MEETING_KEYS.list(contactId),
    `/contacts/${contactId}/meetings`,
    contactMeetingResponseSchema,
  );
}

/** Log, edit (with the `rowVersion` the person saw) and delete a meeting; each refreshes the meetings and the timeline. */
export function useMeetingMutations(contactId: string) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: MEETING_KEYS.list(contactId) }),
      qc.invalidateQueries({ queryKey: MEETING_KEYS.activities(contactId) }),
    ]);
  const path = `/contacts/${contactId}/meetings`;

  const create = useMutation({
    mutationFn: (input: CreateContactMeetingInput) =>
      apiFetch(path, { method: 'POST', body: input, schema: contactMeetingResponseSchema }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateContactMeetingInput & { id: string }) =>
      apiFetch(`${path}/${id}`, { method: 'PATCH', body, schema: contactMeetingResponseSchema }),
    onSuccess: refresh,
    // A stale `rowVersion` (409) or a meeting gone elsewhere: show what is there now; the person decides, nothing is retried.
    onError: () => qc.invalidateQueries({ queryKey: MEETING_KEYS.list(contactId) }),
  });
  const remove = useMutation({
    mutationFn: (id: string): Promise<void> => apiFetch(`${path}/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: () => qc.invalidateQueries({ queryKey: MEETING_KEYS.list(contactId) }),
  });
  return { create, update, remove };
}
