'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  audiencePreviewSchema,
  createScheduleResultSchema,
  scheduleDetailSchema,
  scheduleDraftSchema,
  scheduleFunnelSchema,
  scheduleListSchema,
  scheduleMediaSchema,
  scheduleOptionsSchema,
  scheduleRecipientListSchema,
  warmerListSchema,
  warmerNumberSchema,
  type CreateScheduleInput,
  type ListScheduleRecipientsQuery,
  type RetryScheduleInput,
  type UpdateScheduleInput,
  type WarmerProfileInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { PAGE_SIZE, POLL_MS, type ListState } from '../lib/schedule-model';

export const KEYS = {
  all: ['sched'] as const,
  list: ['sched', 'list'] as const,
  options: ['sched', 'options'] as const,
  detail: (id: string) => ['sched', 'detail', id] as const,
  draft: (id: string) => ['sched', 'draft', id] as const,
  funnel: (id: string) => ['sched', 'funnel', id] as const,
  recipients: (id: string, q: unknown) => ['sched', 'recipients', id, q] as const,
  warmer: ['sched', 'warmer'] as const,
};

export type ScheduleAction = 'pause' | 'resume' | 'cancel' | 'run-now';

/** Every scheduled-message call. Schedules are named by uuid; the proxy adds the session token. */
export const scheduleApi = {
  list: (s: ListState, signal?: AbortSignal) =>
    apiFetch('/scheduled', {
      query: {
        tab: s.tab === 'all' ? undefined : s.tab,
        q: s.q || undefined,
        limit: PAGE_SIZE,
        offset: (s.page - 1) * PAGE_SIZE,
      },
      schema: scheduleListSchema,
      signal,
    }),
  options: (signal?: AbortSignal) =>
    apiFetch('/scheduled/options', { schema: scheduleOptionsSchema, signal }),
  preview: (body: unknown, signal?: AbortSignal) =>
    apiFetch('/scheduled/audience-preview', {
      method: 'POST',
      body,
      schema: audiencePreviewSchema,
      signal,
    }),
  create: (input: CreateScheduleInput, idempotencyKey?: string) =>
    apiFetch('/scheduled', {
      method: 'POST',
      body: input,
      schema: createScheduleResultSchema,
      idempotencyKey,
    }),
  detail: (id: string, signal?: AbortSignal) =>
    apiFetch(`/scheduled/${id}`, { schema: scheduleDetailSchema, signal }),
  draft: (id: string, signal?: AbortSignal) =>
    apiFetch(`/scheduled/${id}/draft`, { schema: scheduleDraftSchema, signal }),
  update: (id: string, input: UpdateScheduleInput) =>
    apiFetch(`/scheduled/${id}`, { method: 'PATCH', body: input, schema: scheduleDetailSchema }),
  funnel: (id: string, signal?: AbortSignal) =>
    apiFetch(`/scheduled/${id}/funnel`, { schema: scheduleFunnelSchema, signal }),
  recipients: (id: string, q: Partial<ListScheduleRecipientsQuery>, signal?: AbortSignal) =>
    apiFetch(`/scheduled/${id}/recipients`, {
      query: {
        status: q.status && q.status !== 'all' ? q.status : undefined,
        q: q.q || undefined,
        limit: q.limit,
        offset: q.offset,
      },
      schema: scheduleRecipientListSchema,
      signal,
    }),
  act: (id: string, action: ScheduleAction) =>
    apiFetch(`/scheduled/${id}/${action}`, { method: 'POST', schema: scheduleDetailSchema }),
  retry: (id: string, input: RetryScheduleInput) =>
    apiFetch(`/scheduled/${id}/retry`, {
      method: 'POST',
      body: input,
      schema: scheduleDetailSchema,
    }),
  remove: (id: string) => apiFetch(`/scheduled/${id}`, { method: 'DELETE' }),
};

/** Uploads the file a schedule sends (stored on the workspace's storage; the schedule is given its id). */
export async function uploadScheduleMedia(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.set('file', file);
  const res = await fetch('/api/v2/scheduled/media', {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
    signal,
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return scheduleMediaSchema.parse(json);
}

export const warmerApi = {
  list: (signal?: AbortSignal) => apiFetch('/warmer', { schema: warmerListSchema, signal }),
  save: (key: string, profile: WarmerProfileInput) =>
    apiFetch(`/warmer/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: profile,
      schema: warmerNumberSchema,
    }),
};

export const refresh = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.all });

export function useSchedules(state: ListState) {
  return useQuery({
    queryKey: [...KEYS.list, state],
    queryFn: ({ signal }) => scheduleApi.list(state, signal),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  });
}

export function useScheduleOptions() {
  return useQuery({
    queryKey: KEYS.options,
    queryFn: ({ signal }) => scheduleApi.options(signal),
    retry: false,
  });
}

/** Who a draft would reach; asked again whenever the chosen audience changes. */
export function useAudiencePreview(input: unknown, enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.all, 'preview', input],
    enabled,
    queryFn: ({ signal }) => scheduleApi.preview(input, signal),
    retry: false,
  });
}

export function useScheduleDetail(id: string) {
  return useQuery({
    queryKey: KEYS.detail(id),
    queryFn: ({ signal }) => scheduleApi.detail(id, signal),
    refetchInterval: POLL_MS,
  });
}

export function useScheduleDraft(id: string) {
  return useQuery({
    queryKey: KEYS.draft(id),
    queryFn: ({ signal }) => scheduleApi.draft(id, signal),
    retry: false,
    // The person is editing it: a refetch must not replace their form.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useScheduleFunnel(id: string) {
  return useQuery({
    queryKey: KEYS.funnel(id),
    queryFn: ({ signal }) => scheduleApi.funnel(id, signal),
    refetchInterval: POLL_MS,
  });
}

export function useScheduleRecipients(id: string, q: Partial<ListScheduleRecipientsQuery>) {
  return useQuery({
    queryKey: KEYS.recipients(id, q),
    queryFn: ({ signal }) => scheduleApi.recipients(id, q, signal),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  });
}

export function useUpdateSchedule(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateScheduleInput) => scheduleApi.update(id, input),
    onSuccess: () => void refresh(qc),
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: { input: CreateScheduleInput; key: string }) =>
      scheduleApi.create(input, key),
    onSuccess: () => void refresh(qc),
  });
}

export function useWarmer() {
  return useQuery({
    queryKey: KEYS.warmer,
    queryFn: ({ signal }) => warmerApi.list(signal),
    refetchInterval: POLL_MS,
  });
}
