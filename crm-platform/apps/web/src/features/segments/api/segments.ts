'use client';

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { toApiError } from '@/lib/api/errors';
import { call, fetchAll, mockEnabled } from './http';
import {
  segmentActionResponseSchema,
  segmentCountResponseSchema,
  segmentMembersPageSchema,
  segmentPreviewResponseSchema,
  segmentResponseSchema,
  type CreateSegmentInput,
  type Segment,
  type SegmentActionResponse,
  type SegmentCountResponse,
  type SegmentPreviewResponse,
  type SegmentRules,
  type UpdateSegmentInput,
} from './schemas';
import type { segmentFromFiltersSchema } from '@crm/contracts';

export const KEYS = {
  all: ['segments'] as const,
  list: ['segments', 'list'] as const,
  one: (id: string) => ['segments', 'one', id] as const,
  members: (id: string) => ['segments', 'members', id] as const,
};

/** Every segment the person can see (their own and the shared ones). */
export function useSegments(enabled = true) {
  return useQuery({
    queryKey: KEYS.list,
    queryFn: ({ signal }) => fetchAll('/segments', segmentResponseSchema, {}, { signal }),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useSegment(id: string) {
  return useQuery({
    queryKey: KEYS.one(id),
    queryFn: ({ signal }) => call(`/segments/${id}`, { schema: segmentResponseSchema, signal }),
    retry: false,
  });
}

export const createSegment = (input: CreateSegmentInput): Promise<Segment> =>
  call('/segments', { method: 'POST', body: input, schema: segmentResponseSchema });

/** Sends the `rowVersion` that was read: a 409 means someone changed the segment meanwhile (never retried blindly). */
export const updateSegment = (id: string, input: UpdateSegmentInput): Promise<Segment> =>
  call(`/segments/${id}`, { method: 'PATCH', body: input, schema: segmentResponseSchema });

export const deleteSegment = (id: string): Promise<void> => call(`/segments/${id}`, { method: 'DELETE' });

/** Counts the members again now, bypassing the cached count. */
export const refreshCount = (id: string): Promise<SegmentCountResponse> =>
  call(`/segments/${id}/refresh-count`, { method: 'POST', schema: segmentCountResponseSchema });

/** The live preview: how many contacts the rules match, and ten of them. */
export const previewRules = (
  rules: SegmentRules,
  signal?: AbortSignal,
): Promise<SegmentPreviewResponse> =>
  call('/segments/preview', {
    method: 'POST',
    body: { rules },
    schema: segmentPreviewResponseSchema,
    signal,
  });

/** Creates a segment from the contacts list's active filters (the API translates them into rules). */
export const segmentFromFilters = (
  input: z.input<typeof segmentFromFiltersSchema>,
): Promise<Segment> =>
  call('/segments/from-filters', { method: 'POST', body: input, schema: segmentResponseSchema });

/** Tags every current member (a snapshot: contacts that join later are not tagged), by tag id or by new name. */
export const tagMembers = (
  id: string,
  tag: { tagId?: string; name?: string },
): Promise<SegmentActionResponse> =>
  call(`/segments/${id}/tag`, { method: 'POST', body: tag, schema: segmentActionResponseSchema });

/** Copies every current member into a group (a snapshot). Past 1000 members a background job does it in chunks. */
export const addMembersToGroup = (id: string, groupId: string): Promise<SegmentActionResponse> =>
  call(`/segments/${id}/add-to-group`, {
    method: 'POST',
    body: { groupId },
    schema: segmentActionResponseSchema,
  });

/** Exports the members as CSV. The API streams the file, so it is read as a blob, not through the JSON client. */
export async function exportMembers(id: string): Promise<{ blob: Blob; filename: string }> {
  if (mockEnabled()) {
    const { mockExport } = await import('./mock-server');
    return mockExport(id);
  }
  const res = await fetch(`/api/v2/segments/${id}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/csv, application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ bom: true }),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    throw toApiError(res.status, json, res.headers.get('x-request-id'));
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'segment-export.csv';
  return { blob: await res.blob(), filename };
}

export function invalidateSegments(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: KEYS.all });
}

// --- members -----------------------------------------------------------------------------------------------------

/**
 * One page of a segment's members at a time, by cursor: Next follows the page's `nextCursor`, Previous goes back to the
 * cursor it came from (kept in a stack), so paging never asks the API for an offset.
 */
export function useSegmentMembers(id: string, limit: number) {
  const key = `${id}:${limit}`;
  const [stack, setStack] = useState<{ key: string; cursors: Array<string | undefined> }>({
    key,
    cursors: [undefined],
  });
  // A different segment or page size starts again from the first page.
  const cursors = stack.key === key ? stack.cursors : [undefined];
  const cursor = cursors[cursors.length - 1];
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...KEYS.members(id), limit, cursor ?? ''],
    queryFn: ({ signal }) =>
      call(`/segments/${id}/contacts`, {
        query: { limit, cursor, expand: 'groups,tags', includeTotal: true },
        schema: segmentMembersPageSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const next = q.data?.page.hasMore ? (q.data.page.nextCursor ?? undefined) : undefined;
  return {
    ...q,
    items: q.data?.data ?? [],
    total: q.data?.meta?.total,
    pageNumber: cursors.length,
    hasNext: next !== undefined,
    hasPrevious: cursors.length > 1,
    goNext: () => {
      if (next !== undefined) setStack({ key, cursors: [...cursors, next] });
    },
    goPrevious: () => {
      if (cursors.length > 1) setStack({ key, cursors: cursors.slice(0, -1) });
    },
    refetchFromStart: () => {
      setStack({ key, cursors: [undefined] });
      void qc.invalidateQueries({ queryKey: KEYS.members(id) });
    },
  };
}
