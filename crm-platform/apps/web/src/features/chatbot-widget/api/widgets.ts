'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  FLB_NODE_TYPES,
  flowDetailSchema,
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

/** The real chat window in preview mode, as the Customize tab frames it (the page draws what the tab sends it). */
export function useWebChatPreviewPage(flowId: string) {
  return useQuery({
    queryKey: [...KEYS.flow(flowId), 'preview-page'],
    staleTime: Infinity,
    queryFn: ({ signal }): Promise<{ html: string }> =>
      apiFetch(`/flows/${flowId}/widget/preview-page`, {
        schema: z.object({ html: z.string() }),
        signal,
      }),
  });
}

/** One step of a website bot's flow a button can jump to: its id and a short name made of its kind and what it says. */
export interface BotStep {
  id: string;
  label: string;
}

const STEP_TEXT_KEYS = ['text', 'prompt', 'bodyText', 'caption', 'question', 'valueText'] as const;

/** The steps of the bot's saved flow that a tap can start from (every step but the trigger and the end), for the Customize tab. */
export function useBotSteps(flowId: string) {
  return useQuery({
    queryKey: [...KEYS.flow(flowId), 'steps'],
    queryFn: async ({ signal }): Promise<BotStep[]> => {
      const flow = await apiFetch(`/flows/${flowId}`, { schema: flowDetailSchema, signal });
      return flow.graph.flowNodes
        .filter((n) => n.type !== 'trigger' && n.type !== 'end')
        .map((n) => {
          const data = (n.data ?? {}) as Record<string, unknown>;
          const key = STEP_TEXT_KEYS.find((k) => typeof data[k] === 'string' && data[k] !== '');
          const text = key ? String(data[key]).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
          const kind = FLB_NODE_TYPES[n.type]?.label ?? n.type;
          return { id: n.id, label: text ? `${kind}: ${text}` : kind };
        });
    },
  });
}

/** The closed launcher as a visitor's site draws it (callout, animation, badge), for the Customize tab's closed-launcher view. */
export const previewFlowEmbed = (
  flowId: string,
  body: Record<string, unknown>,
): Promise<{ html: string }> =>
  apiFetch(`/flows/${flowId}/widget/preview-embed`, {
    method: 'POST',
    body,
    schema: z.object({ html: z.string() }),
  });

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

/**
 * Uploads a picture for a WhatsApp bot's button (`logo` or `popup`) and returns the public address to keep in its settings.
 * Plain `fetch` with a form body, like the flow media upload: the shared client always sends JSON.
 */
export async function uploadFlowWidgetImage(
  flowId: string,
  slot: string,
  file: File,
): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/v2/flows/${flowId}/widget/assets/${slot}`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  });
  const json = (await res.json().catch(() => ({}))) as {
    url?: string;
    detail?: string;
    title?: string;
  };
  if (!res.ok || !json.url) throw new Error(json.detail ?? json.title ?? `HTTP ${res.status}`);
  return json.url;
}
