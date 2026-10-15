'use client';

import { keepPreviousData, useInfiniteQuery, type QueryClient } from '@tanstack/react-query';
import {
  emailTemplateListResponseSchema,
  emailTemplateRenderResponseSchema,
  emailTemplateSchema,
  type CreateEmailTemplateInput,
  type EmailTemplate,
  type EmailTemplateRenderResponse,
  type PreviewEmailTemplateInput,
  type UpdateEmailTemplateInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { listQuery, type TemplateFilters } from '../lib/filters';

export const KEYS = {
  all: ['email-templates'] as const,
  list: ['email-templates', 'list'] as const,
  picker: ['email-templates', 'picker'] as const,
};

/** Every email-template call, one function each. Reads are parsed with the shared contracts. */
export const templatesApi = {
  create: (body: CreateEmailTemplateInput) =>
    apiFetch('/email/templates', { method: 'POST', body, schema: emailTemplateSchema }),
  /** Needs the `rowVersion` that was read; a 409 means someone else changed the template. */
  update: (id: string, body: UpdateEmailTemplateInput) =>
    apiFetch(`/email/templates/${id}`, { method: 'PATCH', body, schema: emailTemplateSchema }),
  remove: (id: string): Promise<void> => apiFetch(`/email/templates/${id}`, { method: 'DELETE' }),
  preview: (body: PreviewEmailTemplateInput, signal?: AbortSignal) =>
    apiFetch('/email/templates/preview', {
      method: 'POST',
      body,
      schema: emailTemplateRenderResponseSchema,
      signal,
    }),
  /** The template filled in for the conversation the composer is open on. Sends nothing, counts nothing. */
  render: (id: string, conversationId: string): Promise<EmailTemplateRenderResponse> =>
    apiFetch(`/inbox/email-templates/${id}/render`, {
      method: 'POST',
      body: { conversationId },
      schema: emailTemplateRenderResponseSchema,
    }),
};

const PAGE_SIZE = 50;

/** The library: every template that passes the filters, "load more" by cursor. */
export function useTemplatesList(filters: TemplateFilters) {
  const query = listQuery(filters);
  const q = useInfiniteQuery({
    queryKey: [...KEYS.list, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/email/templates', {
        query: { limit: PAGE_SIZE, ...query, cursor: pageParam },
        schema: emailTemplateListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return {
    ...q,
    items: q.data?.pages.flatMap((p) => p.data) ?? ([] as EmailTemplate[]),
    categories: q.data?.pages[0]?.categories ?? [],
  };
}

/** The composer's picker: active templates, narrowed by a search. Off until the picker is opened. */
export function useTemplatePicker(q: string, enabled: boolean) {
  const query = listQuery({ q, scope: 'all', purpose: '', status: 'active', category: '' });
  const result = useInfiniteQuery({
    queryKey: [...KEYS.picker, query],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/email/templates', {
        query: { limit: 30, ...query, cursor: pageParam },
        schema: emailTemplateListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
  return { ...result, items: result.data?.pages.flatMap((p) => p.data) ?? [] };
}

export const invalidateTemplates = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: KEYS.all });
