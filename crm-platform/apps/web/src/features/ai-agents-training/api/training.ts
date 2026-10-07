'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  aiModelsResponseSchema,
  aiagAssistantSchema,
  aiagResponderSchema,
  aiagSourceSchema,
  listAiagAssistantsResponseSchema,
  listAiagSourcesResponseSchema,
  type AddAiagSourceInput,
  type AiagAssistant,
  type AiagResponder,
  type AiagSource,
  type CreateAiagAssistantInput,
  type ListAiagAssistantsResponse,
  type SaveAiagResponderInput,
  type UpdateAiagAssistantInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

const BASE = '/ai-training';

export const KEYS = {
  all: ['aiag'] as const,
  list: ['aiag', 'list'] as const,
  one: (id: string) => ['aiag', 'one', id] as const,
  sources: (id: string) => ['aiag', 'sources', id] as const,
  responder: ['aiag', 'responder'] as const,
  models: ['aiag', 'models'] as const,
};

const PAGE = 20;

/** The assistants, newest first, a cursor page at a time; the stat numbers come with every page and are workspace-wide. */
export function useAssistants() {
  return useInfiniteQuery({
    queryKey: [...KEYS.list, 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<ListAiagAssistantsResponse> =>
      apiFetch(`${BASE}/assistants`, {
        query: { limit: PAGE, cursor: pageParam },
        schema: listAiagAssistantsResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
}

export function useAssistant(id: string | null) {
  return useQuery({
    queryKey: KEYS.one(id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/assistants/${id}`, { schema: aiagAssistantSchema, signal }),
    // The builder owns its copy once it has loaded: a background refetch must not replace what the person is typing.
    staleTime: Infinity,
    gcTime: 0,
  });
}

/** The entries of one assistant. While one is still being read (a URL) the list asks again every few seconds. */
export function useSources(assistantId: string | null) {
  return useQuery({
    queryKey: KEYS.sources(assistantId ?? ''),
    enabled: assistantId !== null,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/assistants/${assistantId}/sources`, {
        schema: listAiagSourcesResponseSchema,
        signal,
      }),
    select: (r) => r.data,
    refetchInterval: (q) =>
      q.state.data?.data.some((s) => s.status === 'processing') ? POLL_MS : false,
  });
}
export const POLL_MS = 3000;

export function useResponder() {
  return useQuery({
    queryKey: KEYS.responder,
    queryFn: ({ signal }) => apiFetch(`${BASE}/responder`, { schema: aiagResponderSchema, signal }),
  });
}

/** The text models this workspace may use: the platform's enabled ones and any provider it added its own key for. */
export function useEnabledModels() {
  return useQuery({
    queryKey: KEYS.models,
    queryFn: ({ signal }) => apiFetch('/ai/models', { schema: aiModelsResponseSchema, signal }),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}

export const createAssistant = (body: CreateAiagAssistantInput): Promise<AiagAssistant> =>
  apiFetch(`${BASE}/assistants`, { method: 'POST', body, schema: aiagAssistantSchema });

export const updateAssistant = (
  id: string,
  body: UpdateAiagAssistantInput,
): Promise<AiagAssistant> =>
  apiFetch(`${BASE}/assistants/${id}`, { method: 'PATCH', body, schema: aiagAssistantSchema });

export const duplicateAssistant = (id: string): Promise<AiagAssistant> =>
  apiFetch(`${BASE}/assistants/${id}/duplicate`, { method: 'POST', schema: aiagAssistantSchema });

export const deleteAssistant = (id: string): Promise<void> =>
  apiFetch(`${BASE}/assistants/${id}`, { method: 'DELETE' });

export const addSource = (assistantId: string, body: AddAiagSourceInput): Promise<AiagSource> =>
  apiFetch(`${BASE}/assistants/${assistantId}/sources`, {
    method: 'POST',
    body,
    schema: aiagSourceSchema,
  });

export const deleteSource = (id: string): Promise<void> =>
  apiFetch(`${BASE}/sources/${id}`, { method: 'DELETE' });

export const saveResponder = (body: SaveAiagResponderInput): Promise<AiagResponder> =>
  apiFetch(`${BASE}/responder`, { method: 'PUT', body, schema: aiagResponderSchema });

/**
 * Uploads a knowledge file (`POST .../sources/file`, multipart). `apiFetch` only speaks JSON and `fetch` reports no upload
 * progress, so this is the same request through the same-origin proxy with an XMLHttpRequest: the browser sets the multipart
 * boundary, the proxy adds the token, and `onProgress` gets 0..1 as the bytes go out.
 */
export function uploadSource(
  assistantId: string,
  file: File,
  label: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AiagSource> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('label', label);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v2${BASE}/assistants/${assistantId}/sources/file`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Request-Id', crypto.randomUUID());
    xhr.setRequestHeader('Idempotency-Key', crypto.randomUUID());
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    xhr.onload = () => {
      let json: unknown;
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        json = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = aiagSourceSchema.safeParse(json);
        return parsed.success ? resolve(parsed.data) : reject(new Error('bad response'));
      }
      reject(toApiError(xhr.status, json, xhr.getResponseHeader('x-request-id')));
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
