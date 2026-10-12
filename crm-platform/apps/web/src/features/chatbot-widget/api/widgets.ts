'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  flowWidgetResponseSchema,
  listWidgetsResponseSchema,
  registrationConfigResponseSchema,
  rotateWidgetTokenResponseSchema,
  webBotsResponseSchema,
  widgetAssistantsResponseSchema,
  widgetSchema,
  type CreateWidgetInput,
  type FlowWidgetResponse,
  type FlowWidgetSaveInput,
  type ListWidgetsResponse,
  type UpdateWidgetInput,
  type WebBotsResponse,
  type Widget,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['wgt'] as const,
  list: ['wgt', 'list'] as const,
  one: (id: string) => ['wgt', 'one', id] as const,
  assistants: ['wgt', 'assistants'] as const,
  flow: (flowId: string) => ['wgt', 'flow', flowId] as const,
  webBots: ['wgt', 'web-bots'] as const,
};

const PAGE = 20;

/** The list, newest first, a cursor page at a time; the stat numbers come with every page and are always workspace-wide. */
export function useWidgets() {
  return useInfiniteQuery({
    queryKey: [...KEYS.list, 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<ListWidgetsResponse> =>
      apiFetch('/widgets', {
        query: { limit: PAGE, cursor: pageParam },
        schema: listWidgetsResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
}

export function useWidget(id: string | null) {
  return useQuery({
    queryKey: KEYS.one(id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) => apiFetch(`/widgets/${id}`, { schema: widgetSchema, signal }),
    // The builder owns its copy once it has loaded: a background refetch must not replace what the person is typing.
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useAssistants() {
  return useQuery({
    queryKey: KEYS.assistants,
    queryFn: ({ signal }) =>
      apiFetch('/widgets/assistants', { schema: widgetAssistantsResponseSchema, signal }),
  });
}

/** Where the WhatsApp number picker opens: the platform's default country (a public setting). */
export function useDefaultCountry() {
  return useQuery({
    queryKey: ['auth', 'registration-config'],
    queryFn: () =>
      apiFetch('/auth/registration-config', { schema: registrationConfigResponseSchema }),
    staleTime: Infinity,
    retry: false,
    select: (c) => c.defaultCountryIso,
  });
}

export const createWidget = (body: CreateWidgetInput): Promise<Widget> =>
  apiFetch('/widgets', { method: 'POST', body, schema: widgetSchema });

export const updateWidget = (id: string, body: UpdateWidgetInput): Promise<Widget> =>
  apiFetch(`/widgets/${id}`, { method: 'PATCH', body, schema: widgetSchema });

export const duplicateWidget = (id: string): Promise<Widget> =>
  apiFetch(`/widgets/${id}/duplicate`, { method: 'POST', schema: widgetSchema });

export const rotateWidgetToken = (id: string) =>
  apiFetch(`/widgets/${id}/rotate-token`, {
    method: 'POST',
    schema: rotateWidgetTokenResponseSchema,
  });

export const deleteWidget = (id: string): Promise<void> =>
  apiFetch(`/widgets/${id}`, { method: 'DELETE' });

/** The widget a website chat bot owns; `widget` is null until Customize has been saved once. */
export function useFlowWidget(flowId: string | null) {
  return useQuery({
    queryKey: KEYS.flow(flowId ?? ''),
    enabled: flowId !== null,
    queryFn: ({ signal }): Promise<FlowWidgetResponse> =>
      apiFetch(`/flows/${flowId}/widget`, { schema: flowWidgetResponseSchema, signal }),
  });
}

export const saveFlowWidget = (flowId: string, body: FlowWidgetSaveInput): Promise<Widget> =>
  apiFetch(`/flows/${flowId}/widget`, { method: 'PUT', body, schema: widgetSchema });

/** The workspace's website chat bots with their widgets (Settings > Channels > Web). */
export function useWebBots() {
  return useQuery({
    queryKey: KEYS.webBots,
    queryFn: ({ signal }): Promise<WebBotsResponse> =>
      apiFetch('/widgets/flow-bots', { schema: webBotsResponseSchema, signal }),
  });
}
