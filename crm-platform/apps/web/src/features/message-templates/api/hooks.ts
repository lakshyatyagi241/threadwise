'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  templateSummarySchema,
  type CreateTemplateInput,
  type LintTemplateInput,
  type ListTemplatesQuery,
  type SubmitTemplateInput,
  type SyncTemplatesInput,
  type TemplateDetail,
  type TemplateGalleryQuery,
  type UpdateTemplateInput,
} from '@crm/contracts';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { DETAIL_POLL_MS, isAwaitingReview } from '../lib/status-model';
import { aiApi, apiKeysApi, connectionsApi, templatesApi } from './service';

export const KEYS = {
  all: ['tpl'] as const,
  list: ['tpl', 'list'] as const,
  detail: (id: string) => ['tpl', 'detail', id] as const,
  connections: ['tpl', 'connections'] as const,
  lint: ['tpl', 'lint'] as const,
  apiKeys: ['tpl', 'api-keys'] as const,
  aiModels: ['tpl', 'ai-models'] as const,
};

export const PAGE_SIZE_LIBRARY = 8;

/** The default templates (the Saved templates tab). The same for every workspace, so kept for a while and refetched when the filters change. */
export function useTemplateGallery(
  query: TemplateGalleryQuery = {},
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    enabled: opts.enabled ?? true,
    queryKey: ['tpl', 'gallery', query.category ?? 'all', query.q ?? ''] as const,
    queryFn: ({ signal }) => templatesApi.gallery(query, signal),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export type LibraryFilters = Pick<
  ListTemplatesQuery,
  'statusGroup' | 'category' | 'connectionId' | 'q' | 'sort'
>;

/** The library: server-side filters, cursor "load more", no totals. */
export function useTemplateList(filters: LibraryFilters) {
  return useCursorList(KEYS.list, '/templates', templateSummarySchema, {
    limit: PAGE_SIZE_LIBRARY,
    statusGroup: filters.statusGroup,
    sort: filters.sort,
    category: filters.category,
    connectionId: filters.connectionId,
    q: filters.q || undefined,
  });
}

/** The tab counts and "Showing N of M": Reference's sidebar, recounted whenever the library changes. */
export function useTemplateCounts(filters: LibraryFilters) {
  return useQuery({
    queryKey: [
      ...KEYS.all,
      'counts',
      filters.statusGroup,
      filters.category,
      filters.connectionId,
      filters.q,
    ],
    queryFn: ({ signal }) =>
      templatesApi.counts(
        {
          statusGroup: filters.statusGroup,
          category: filters.category,
          connectionId: filters.connectionId,
          q: filters.q,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useConnections() {
  return useQuery({
    queryKey: KEYS.connections,
    queryFn: ({ signal }) => connectionsApi.list(signal),
    select: (r) => r.items,
    staleTime: 60_000,
    retry: false,
  });
}

/** The detail follows a template waiting for Meta's review every 30 s, and stops once it has an answer. */
export function useTemplate(id: string, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: KEYS.detail(id),
    queryFn: ({ signal }) => templatesApi.get(id, signal),
    retry: false,
    refetchInterval: opts.poll
      ? (q) => {
          const d = q.state.data as TemplateDetail | undefined;
          return d && isAwaitingReview(d.status) ? DETAIL_POLL_MS : false;
        }
      : false,
  });
}

/** Debounces a value so the linter is not called on every keystroke. */
export function useDebounced<T>(value: T, ms = 500): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Live lint of the form (`POST /templates/lint`). `null` input = nothing to check yet. */
export function useLint(input: LintTemplateInput | null) {
  return useQuery({
    queryKey: [...KEYS.lint, input],
    queryFn: ({ signal }) => templatesApi.lint(input as LintTemplateInput, signal),
    enabled: input !== null,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
}

function useAction<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: KEYS.all, predicate: (q) => q.queryKey[1] !== 'lint' }),
  });
}

export const useCreateTemplate = () =>
  useAction((input: CreateTemplateInput) => templatesApi.create(input));
export const useUpdateTemplate = (id: string) =>
  useAction((input: UpdateTemplateInput) => templatesApi.update(id, input));
export const useDeleteTemplate = () => useAction((id: string) => templatesApi.remove(id));
export const useSubmitTemplate = () =>
  useAction((v: { id: string } & SubmitTemplateInput) =>
    templatesApi.submit(v.id, v.connectionId ? { connectionId: v.connectionId } : {}),
  );
export const useRefreshTemplate = () => useAction((id: string) => templatesApi.refresh(id));
export const useSyncTemplates = () =>
  useAction((input: SyncTemplatesInput) => templatesApi.sync(input));

/** True/false once known, undefined while loading or when the keys cannot be read. A live key is active and not revoked. */
export function useHasApiKey(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.apiKeys,
    queryFn: ({ signal }) => apiKeysApi.list(signal),
    select: (r) => r.data.some((k) => k.status === 'active' && k.revokedAt === null),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** The text models this workspace may use for "Build with AI" (the platform's enabled ones and any provider it added its own key for). */
export function useAiModels(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.aiModels,
    queryFn: ({ signal }) => aiApi.models(signal),
    select: (r) => r.data,
    enabled,
    staleTime: 60_000,
  });
}
