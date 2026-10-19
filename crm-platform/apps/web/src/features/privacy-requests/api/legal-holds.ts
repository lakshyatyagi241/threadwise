'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  legalHoldDetailSchema,
  legalHoldListSchema,
  legalHoldSchema,
  legalHoldStatusResponseSchema,
  releaseLegalHoldResultSchema,
  type ExtendLegalHoldInput,
  type LegalHoldReasonCategory,
  type LegalHoldScope,
  type LegalHoldStatus,
  type PlaceLegalHoldInput,
  type ReleaseLegalHoldInput,
  type ReviewLegalHoldInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const BASE = '/privacy/legal-holds';
const enc = encodeURIComponent;

/** The register's filters (the page size and cursor are the hook's). */
export interface HoldFilters {
  status?: LegalHoldStatus;
  reasonCategory?: LegalHoldReasonCategory;
  scope?: LegalHoldScope;
  reviewDue?: boolean;
  q?: string;
}

export const legalHoldsApi = {
  list: (f: HoldFilters, cursor?: string, signal?: AbortSignal) =>
    apiFetch(BASE, {
      query: {
        status: f.status,
        reasonCategory: f.reasonCategory,
        scope: f.scope,
        reviewDue: f.reviewDue ? true : undefined,
        q: f.q?.trim() || undefined,
        limit: 25,
        cursor,
      },
      schema: legalHoldListSchema,
      signal,
    }),
  detail: (id: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/${enc(id)}`, { schema: legalHoldDetailSchema, signal }),
  status: (kind: 'contact' | 'lead', id: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/status`, {
      query: { kind, id },
      schema: legalHoldStatusResponseSchema,
      signal,
    }),
  place: (input: PlaceLegalHoldInput) =>
    apiFetch(BASE, { method: 'POST', body: input, schema: legalHoldSchema }),
  extend: (id: string, input: ExtendLegalHoldInput) =>
    apiFetch(`${BASE}/${enc(id)}/extend`, {
      method: 'POST',
      body: input,
      schema: legalHoldSchema,
    }),
  review: (id: string, input: ReviewLegalHoldInput) =>
    apiFetch(`${BASE}/${enc(id)}/review`, {
      method: 'POST',
      body: input,
      schema: legalHoldSchema,
    }),
  release: (id: string, input: ReleaseLegalHoldInput) =>
    apiFetch(`${BASE}/${enc(id)}/release`, {
      method: 'POST',
      body: input,
      schema: releaseLegalHoldResultSchema,
    }),
};

/** The register as a same-origin CSV download for auditors (the proxy attaches the session). */
export function legalHoldsExportUrl(f: HoldFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.reasonCategory) p.set('reasonCategory', f.reasonCategory);
  if (f.scope) p.set('scope', f.scope);
  if (f.reviewDue) p.set('reviewDue', 'true');
  if (f.q?.trim()) p.set('q', f.q.trim());
  const s = p.toString();
  return `/api/v2${BASE}/export${s ? `?${s}` : ''}`;
}

export const HOLD_KEYS = {
  all: ['legal-holds'] as const,
  list: (f: HoldFilters) => ['legal-holds', 'list', f] as const,
  detail: (id: string) => ['legal-holds', 'detail', id] as const,
  status: (kind: string, id: string) => ['legal-holds', 'status', kind, id] as const,
};

/** The register, newest first, a page at a time. */
export function useLegalHolds(filters: HoldFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: HOLD_KEYS.list(filters),
    enabled,
    retry: false,
    staleTime: 10_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => legalHoldsApi.list(filters, pageParam, signal),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
}

/** One hold with its history. */
export function useLegalHold(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: HOLD_KEYS.detail(id ?? ''),
    enabled: enabled && id !== null,
    retry: false,
    queryFn: ({ signal }) => legalHoldsApi.detail(id!, signal),
  });
}

/**
 * Is this contact or lead held? Asked only when `enabled` (the caller may read the register): everyone else never calls the API, so
 * nothing about a hold reaches a person without the privacy permission.
 */
export function useSubjectHold(kind: 'contact' | 'lead', id: string, enabled: boolean) {
  return useQuery({
    queryKey: HOLD_KEYS.status(kind, id),
    enabled: enabled && id !== '',
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => legalHoldsApi.status(kind, id, signal),
  });
}
