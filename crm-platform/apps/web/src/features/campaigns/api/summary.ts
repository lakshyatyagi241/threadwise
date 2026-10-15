'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  campaignSummaryPeopleSchema,
  campaignSummarySchema,
  summaryFormsResponseSchema,
  type SummaryPerson,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { formKey, type PeopleKind, type SummaryKind } from '../lib/summary-model';

/**
 * The director summary's reads. A campaign and a legacy broadcast answer the same shapes at `/campaigns/:id/summary` and
 * `/broadcasts/:id/summary`. The numbers are worked out live from the inbox, so they are read again when the window regains focus
 * and after 30 seconds, never on a timer.
 */
export const SUMMARY_STALE_MS = 30_000;
const PAGE = 25;
const EXPORT_PAGE = 100;
/** The names file stops here per list, so a very large campaign cannot freeze the browser. */
export const EXPORT_MAX_ROWS = 20_000;

export const SUMMARY_KEYS = {
  all: ['camp', 'summary'] as const,
  one: (kind: SummaryKind, id: string, days: number, forms: string) =>
    ['camp', 'summary', kind, id, days, forms] as const,
  people: (kind: SummaryKind, id: string, who: PeopleKind, days: number, forms: string) =>
    ['camp', 'summary', kind, id, 'people', who, days, forms] as const,
  forms: ['camp', 'summary', 'forms'] as const,
};

const root = (kind: SummaryKind) => (kind === 'campaign' ? '/campaigns' : '/broadcasts');

export function useDirectorSummary(opts: {
  kind: SummaryKind;
  id: string;
  days: number;
  formIds: readonly string[];
  enabled?: boolean;
}) {
  const forms = formKey(opts.formIds);
  return useQuery({
    queryKey: SUMMARY_KEYS.one(opts.kind, opts.id, opts.days, forms),
    queryFn: ({ signal }) =>
      apiFetch(`${root(opts.kind)}/${opts.id}/summary`, {
        query: { cameBackDays: opts.days, formIds: forms || undefined },
        schema: campaignSummarySchema,
        signal,
      }),
    enabled: opts.enabled ?? true,
    staleTime: SUMMARY_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

/** The web and WhatsApp forms the picker offers. */
export function useSummaryForms(enabled: boolean) {
  return useQuery({
    queryKey: SUMMARY_KEYS.forms,
    queryFn: ({ signal }) =>
      apiFetch('/campaigns/summary/forms', { schema: summaryFormsResponseSchema, signal }),
    select: (r) => r.data,
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** One list of people (wrote back, filled a form, not reached), a page at a time. Only fetched once the list is opened. */
export function useSummaryPeople(opts: {
  kind: SummaryKind;
  id: string;
  who: PeopleKind;
  days: number;
  formIds: readonly string[];
  enabled: boolean;
}) {
  const forms = formKey(opts.formIds);
  return useInfiniteQuery({
    queryKey: SUMMARY_KEYS.people(opts.kind, opts.id, opts.who, opts.days, forms),
    queryFn: ({ pageParam, signal }) =>
      apiFetch(`${root(opts.kind)}/${opts.id}/summary/people`, {
        query: {
          kind: opts.who,
          cameBackDays: opts.days,
          formIds: forms || undefined,
          cursor: pageParam,
          limit: PAGE,
        },
        schema: campaignSummaryPeopleSchema,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: opts.enabled,
    staleTime: SUMMARY_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

/** Every person of one list for the names file, page by page; stops at `EXPORT_MAX_ROWS` and says so. */
export async function fetchAllPeople(opts: {
  kind: SummaryKind;
  id: string;
  who: PeopleKind;
  days: number;
  formIds: readonly string[];
}): Promise<{ rows: SummaryPerson[]; truncated: boolean }> {
  const forms = formKey(opts.formIds);
  const rows: SummaryPerson[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await apiFetch(`${root(opts.kind)}/${opts.id}/summary/people`, {
      query: {
        kind: opts.who,
        cameBackDays: opts.days,
        formIds: forms || undefined,
        cursor,
        limit: EXPORT_PAGE,
      },
      schema: campaignSummaryPeopleSchema,
    });
    rows.push(...page.data);
    if (!page.nextCursor || page.data.length === 0) return { rows, truncated: false };
    if (rows.length >= EXPORT_MAX_ROWS)
      return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: true };
    cursor = page.nextCursor;
  }
}
