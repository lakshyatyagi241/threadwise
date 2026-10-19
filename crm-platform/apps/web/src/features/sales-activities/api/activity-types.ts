'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activityTypeSchema,
  activityTypesResponseSchema,
  meetingResultSchema,
  meetingResultsResponseSchema,
  type ActivityType,
  type AddActivityOptionInput,
  type CreateActivityTypeInput,
  type ReorderActivityOptionsInput,
  type SetMeetingResultInput,
  type UpdateActivityTypeInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';

export const ACTIVITY_KEYS = {
  all: ['sales-activities'] as const,
  list: ['sales-activities', 'list'] as const,
  meetingResults: (contactId: string) => ['sales-activities', 'meeting-results', contactId] as const,
};

/** Every call of Settings > Sales Activities. Activities and their items are named by uuid. */
export const activityTypesApi = {
  list: (signal?: AbortSignal) =>
    apiFetch('/activity-types', { schema: activityTypesResponseSchema, signal }),
  create: (input: CreateActivityTypeInput) =>
    apiFetch('/activity-types', { method: 'POST', body: input, schema: activityTypeSchema }),
  update: (id: string, input: UpdateActivityTypeInput) =>
    apiFetch(`/activity-types/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      schema: activityTypeSchema,
    }),
  remove: (id: string): Promise<void> =>
    apiFetch(`/activity-types/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addOption: (id: string, input: AddActivityOptionInput) =>
    apiFetch(`/activity-types/${encodeURIComponent(id)}/options`, {
      method: 'POST',
      body: input,
      schema: activityTypeSchema,
    }),
  removeOption: (id: string, optionId: string) =>
    apiFetch(
      `/activity-types/${encodeURIComponent(id)}/options/${encodeURIComponent(optionId)}`,
      { method: 'DELETE', schema: activityTypeSchema },
    ),
  reorder: (id: string, input: ReorderActivityOptionsInput) =>
    apiFetch(`/activity-types/${encodeURIComponent(id)}/options/order`, {
      method: 'PUT',
      body: input,
      schema: activityTypeSchema,
    }),
  meetingResults: (contactId: string, signal?: AbortSignal) =>
    apiFetch(`/contacts/${encodeURIComponent(contactId)}/meeting-results`, {
      schema: meetingResultsResponseSchema,
      signal,
    }),
  setMeetingResult: (contactId: string, meetingId: string, input: SetMeetingResultInput) =>
    apiFetch(
      `/contacts/${encodeURIComponent(contactId)}/meeting-results/${encodeURIComponent(meetingId)}`,
      { method: 'PUT', body: input, schema: meetingResultSchema },
    ),
  clearMeetingResult: (contactId: string, meetingId: string): Promise<void> =>
    apiFetch(
      `/contacts/${encodeURIComponent(contactId)}/meeting-results/${encodeURIComponent(meetingId)}`,
      { method: 'DELETE' },
    ),
};

/**
 * The workspace's activities. Shared by the settings page and the pickers on tasks, meetings and calls, so one fetch serves them all.
 * A person who may use tasks but not read settings still gets the lists (the route accepts the task, contact and call keys).
 */
export function useActivityTypes(enabled = true) {
  return useQuery({
    queryKey: ACTIVITY_KEYS.list,
    queryFn: ({ signal }) => activityTypesApi.list(signal).then((r) => r.data),
    enabled,
    staleTime: 60_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

/** What a screen does when the lists have not loaded (or cannot be read): behave as before, i.e. permissive and unchanged. */
export const FALLBACK_SETTINGS = {
  showInCalendar: true,
  allowComplete: true,
  allowEditCompleted: false,
  mobileCheckIn: false,
  outcomesEnabled: true,
} as const;

/** The switches and lists of one default activity ('task', 'meeting', 'phone'), or the unchanged behaviour while unknown. */
export function useActivitySettings(key: 'task' | 'meeting' | 'phone'): {
  activity: ActivityType | undefined;
  allowComplete: boolean;
  allowEditCompleted: boolean;
  outcomesEnabled: boolean;
  loaded: boolean;
} {
  const q = useActivityTypes();
  const activity = q.data?.find((a) => a.key === key);
  return {
    activity,
    allowComplete: activity?.allowComplete ?? FALLBACK_SETTINGS.allowComplete,
    allowEditCompleted: activity?.allowEditCompleted ?? FALLBACK_SETTINGS.allowEditCompleted,
    outcomesEnabled: activity?.outcomesEnabled ?? false,
    loaded: q.isSuccess,
  };
}

/** Runs a settings write, then replaces the cached lists with the answer (the API returns the whole activity). */
export function useActivityMutation<V>(fn: (v: V) => Promise<ActivityType | void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: ACTIVITY_KEYS.list }),
  });
}

export function useMeetingResults(contactId: string, enabled = true) {
  return useQuery({
    queryKey: ACTIVITY_KEYS.meetingResults(contactId),
    queryFn: ({ signal }) => activityTypesApi.meetingResults(contactId, signal).then((r) => r.data),
    enabled,
    staleTime: 30_000,
  });
}
