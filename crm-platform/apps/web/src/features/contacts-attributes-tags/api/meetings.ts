'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  contactMeetingResponseSchema,
  type ContactMeetingResponse,
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

/**
 * A contact's meetings (typed in, and the mirror of each booking), latest start first, fifty at a time. `when: 'all'` asks the API to
 * order by start, so a meeting still to come is on the first page however many past ones there are.
 */
export const MEETING_QUERY = { when: 'all' } as const;

export function useContactMeetings(contactId: string, enabled = true) {
  return useCursorList(
    MEETING_KEYS.list(contactId),
    `/contacts/${contactId}/meetings`,
    contactMeetingResponseSchema,
    MEETING_QUERY,
    { enabled },
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

type MeetingPages = {
  pages: Array<{ data: ContactMeetingResponse[]; page: unknown }>;
  pageParams: unknown[];
};

/**
 * Shows a meeting that is still being saved at the top of the contact's meetings (a made-up id the list draws dimmed), before the
 * server has answered; `rollback` puts the cache back exactly as it was if the save fails. The real list replaces it when the save
 * lands and the list is refetched.
 */
export function addPendingMeeting(
  qc: QueryClient,
  contactId: string,
  input: CreateContactMeetingInput,
): { rollback: () => void; meeting: ContactMeetingResponse } {
  const now = new Date().toISOString();
  const meeting: ContactMeetingResponse = {
    id: `pending-${Date.now()}`,
    contactId,
    title: input.title,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    location: input.location ?? null,
    createdBy: null,
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    appointmentId: null,
    status: null,
    joinUrl: null,
    canManageBooking: false,
  };
  const before = qc.getQueriesData<MeetingPages>({ queryKey: MEETING_KEYS.list(contactId) });
  for (const [key, data] of before) {
    if (!data) continue;
    qc.setQueryData<MeetingPages>(key, {
      ...data,
      pages: data.pages.map((p, i) => (i === 0 ? { ...p, data: [meeting, ...p.data] } : p)),
    });
  }
  return {
    meeting,
    rollback: () => {
      for (const [key, data] of before) qc.setQueryData(key, data);
    },
  };
}
