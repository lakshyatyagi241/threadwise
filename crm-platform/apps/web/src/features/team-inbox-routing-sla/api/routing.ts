'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  businessHoursSchema,
  handoffSettingsSchema,
  inboxAssigneesResponseSchema,
  routingRuleListResponseSchema,
  routingRuleSchema,
  routingSettingsSchema,
  type CreateRoutingRuleInput,
  type HandoffSettings,
  type UpdateBusinessHoursInput,
  type UpdateHandoffSettingsInput,
  type UpdateRoutingRuleInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { flowsApi } from '@/features/flow-builder-editor/api/flows';

export const KEYS = {
  rules: ['routing-rules'] as const,
  list: (q: string) => ['routing-rules', 'list', q] as const,
  rule: (id: string) => ['routing-rules', 'rule', id] as const,
  settings: ['routing-rules', 'settings'] as const,
  businessHours: ['routing-rules', 'business-hours'] as const,
  assignees: ['routing-rules', 'assignees'] as const,
  handoffSettings: ['inbox', 'handoff-settings'] as const,
};

const PAGE = 50;
const ok = z.object({ ok: z.literal(true) });

/** Every call of the Auto-assignment screens. Rules are named by uuid. */
export const routingApi = {
  list: (q: string, cursor: string | undefined, signal?: AbortSignal) =>
    apiFetch('/inbox/routing/rules', {
      query: { q: q || undefined, limit: PAGE, cursor },
      schema: routingRuleListResponseSchema,
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/routing/rules/${encodeURIComponent(id)}`, {
      schema: routingRuleSchema,
      signal,
    }),
  create: (input: Partial<CreateRoutingRuleInput>) =>
    apiFetch('/inbox/routing/rules', { method: 'POST', body: input, schema: routingRuleSchema }),
  update: (id: string, input: UpdateRoutingRuleInput) =>
    apiFetch(`/inbox/routing/rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      schema: routingRuleSchema,
    }),
  remove: (id: string) =>
    apiFetch(`/inbox/routing/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicate: (id: string) =>
    apiFetch(`/inbox/routing/rules/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      schema: routingRuleSchema,
    }),
  reorder: (ids: string[]) =>
    apiFetch('/inbox/routing/rules/reorder', { method: 'POST', body: { ids }, schema: ok }),
  settings: (signal?: AbortSignal) =>
    apiFetch('/inbox/routing/settings', { schema: routingSettingsSchema, signal }),
  updateSettings: (keepContactAgent: boolean) =>
    apiFetch('/inbox/routing/settings', {
      method: 'PUT',
      body: { keepContactAgent },
      schema: routingSettingsSchema,
    }),
  businessHours: (signal?: AbortSignal) =>
    apiFetch('/inbox/routing/business-hours', { schema: businessHoursSchema, signal }),
  updateBusinessHours: (input: UpdateBusinessHoursInput) =>
    apiFetch('/inbox/routing/business-hours', {
      method: 'PUT',
      body: input,
      schema: businessHoursSchema,
    }),
  assignees: (signal?: AbortSignal) =>
    apiFetch('/inbox/assignees', { schema: inboxAssigneesResponseSchema, signal }),
};

/** The workspace's flows (the first 100, newest activity first) for the rule's "also start a flow" choice. A person without access to flows gets an empty choice, never an error page. */
export function useFlowChoices() {
  return useQuery({
    queryKey: [...KEYS.rules, 'flows'] as const,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => flowsApi.list({ limit: 100 }, signal),
    select: (r) => r.data.map((f) => ({ id: f.id, name: f.name, isActive: f.isActive })),
  });
}

export const refresh = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.rules });

/** The rules in priority order, a page at a time ("Load more"); a search is the server's. */
export function useRules(q: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: KEYS.list(q),
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => routingApi.list(q, pageParam, signal),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
}

export function useRule(id: string | null) {
  return useQuery({
    queryKey: KEYS.rule(id ?? ''),
    enabled: id !== null,
    retry: false,
    queryFn: ({ signal }) => routingApi.get(id!, signal),
  });
}

export function useRoutingSettings(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    retry: false,
    queryFn: ({ signal }) => routingApi.settings(signal),
  });
}

/** The workspace's business hours (the schedule and the time zone), read by the "Business hours" dialog. */
export function useBusinessHours(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.businessHours,
    enabled,
    retry: false,
    // The dialog's form is filled from this once per opening; a background refetch must not wipe what the person is typing.
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => routingApi.businessHours(signal),
  });
}

/** Who a conversation can be given to (needs the inbox right; without it the screen shows counts instead of names). */
export function useAssignees(enabled = true) {
  return useQuery({
    queryKey: KEYS.assignees,
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => routingApi.assignees(signal),
  });
}

/** The handoff and assignment settings (BL-396..BL-404) with what the plan includes; open to every plan, so no paywall here. */
export function useHandoffSettings(enabled = true) {
  return useQuery({
    queryKey: KEYS.handoffSettings,
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      apiFetch('/inbox/handoff-settings', { schema: handoffSettingsSchema, signal }),
  });
}

export function useUpdateHandoffSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateHandoffSettingsInput) =>
      apiFetch('/inbox/handoff-settings', {
        method: 'PUT',
        body: input,
        schema: handoffSettingsSchema,
      }),
    onSuccess: (data: HandoffSettings) => qc.setQueryData(KEYS.handoffSettings, data),
  });
}
