'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  attributeCatalogSchema,
  contactGroupResponseSchema,
  contactResponseSchema,
  pageResponseSchema,
  segmentResponseSchema,
  tagResponseSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { KEYS } from './broadcasts';

/** Reference's picker listed the 500 newest contacts; a group or a tag reaches everyone else. */
export const AUDIENCE_LIMIT = 500;

/** The newest contacts, for the audience table. Needs the contacts permission; without it the table says so and groups and tags still work. */
export function useAudienceContacts(enabled: boolean, filter: AudienceFilter = {}) {
  return useQuery({
    queryKey: [...KEYS.all, 'audience-contacts', filter],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetch('/contacts', {
        query: {
          limit: AUDIENCE_LIMIT,
          order: 'desc',
          tagId: filter.tagId,
          groupId: filter.groupId,
          unsubscribed:
            filter.consent === 'optedOut'
              ? true
              : filter.consent === 'subscribed'
                ? false
                : undefined,
        },
        schema: pageResponseSchema(contactResponseSchema),
        signal,
      }),
  });
}

/** Server-side filters of the audience table; the search box narrows what these return. */
export interface AudienceFilter {
  tagId?: string;
  groupId?: string;
  consent?: 'subscribed' | 'optedOut';
}

/** Saved segments, shared ones and the caller's own. Needs the segments permission. */
export function useAudienceSegments(enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.all, 'audience-segments'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/segments', {
        query: { limit: 200 },
        schema: pageResponseSchema(segmentResponseSchema),
        signal,
      }),
  });
}

export function useAudienceGroups(enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.all, 'audience-groups'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/contact-groups', {
        query: { limit: 200 },
        schema: pageResponseSchema(contactGroupResponseSchema),
        signal,
      }),
  });
}

export function useAudienceTags(enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.all, 'audience-tags'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/tags', {
        query: { limit: 200, includeCounts: true },
        schema: pageResponseSchema(tagResponseSchema),
        signal,
      }),
  });
}

/** The click-to-insert attributes: contact fields, custom fields, workspace values and system tokens, each with a sample. */
export function useAttributeCatalog() {
  return useQuery({
    queryKey: [...KEYS.all, 'attribute-catalog'],
    queryFn: ({ signal }) =>
      apiFetch('/attributes/catalog', { schema: attributeCatalogSchema, signal }),
    staleTime: 60_000,
    retry: false,
  });
}
