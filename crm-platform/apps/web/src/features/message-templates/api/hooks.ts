'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  templateSummarySchema,
  type CreateTemplateInput,
  type LintTemplateInput,
  type ListTemplatesQuery,
  type SyncTemplatesInput,
  type TemplateDetail,
  type UpdateTemplateInput,
} from '@crm/contracts';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { DETAIL_POLL_MS, isAwaitingReview } from '../lib/status-model';
import { connectionsApi, templatesApi } from './service';

export const KEYS = {
  all: ['tpl'] as const,
  list: ['tpl', 'list'] as const,
  detail: (id: string) => ['tpl', 'detail', id] as const,
  connections: ['tpl', 'connections'] as const,
  lint: ['tpl', 'lint'] as const,
};

export const PAGE_SIZE = 30;

export type LibraryFilters = Pick<ListTemplatesQuery, 'status' | 'category' | 'connectionId' | 'q'>;

/** The library: server-side filters, cursor "load more", no totals. */
export function useTemplateList(filters: LibraryFilters) {
  return useCursorList(KEYS.list, '/templates', templateSummarySchema, {
    limit: PAGE_SIZE,
    status: filters.status,
    category: filters.category,
    connectionId: filters.connectionId,
    q: filters.q || undefined,
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

/** The detail follows a template waiting for Meta's review every 15 s, and stops once it has an answer. */
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
export const useSubmitTemplate = () => useAction((id: string) => templatesApi.submit(id));
export const useRefreshTemplate = () => useAction((id: string) => templatesApi.refresh(id));
export const useSyncTemplates = () =>
  useAction((input: SyncTemplatesInput) => templatesApi.sync(input));
