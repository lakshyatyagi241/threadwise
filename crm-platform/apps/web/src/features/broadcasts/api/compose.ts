'use client';

import { useQuery } from '@tanstack/react-query';
import {
  broadcastComposeSchema,
  contactGroupResponseSchema,
  contactResponseSchema,
  createBroadcastResponseSchema,
  pageResponseSchema,
  tagResponseSchema,
  type CreateBroadcastInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { KEYS } from './broadcasts';

/** Reference's picker listed the 500 newest contacts; a group or a tag reaches everyone else. */
export const AUDIENCE_LIMIT = 500;

export function useCompose() {
  return useQuery({
    queryKey: [...KEYS.all, 'compose'],
    queryFn: ({ signal }) =>
      apiFetch('/broadcasts/compose', { schema: broadcastComposeSchema, signal }),
    retry: false,
  });
}

/** The newest contacts, for the audience table. Needs the contacts permission; without it the table says so and groups and tags still work. */
export function useAudienceContacts(enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.all, 'audience-contacts'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/contacts', {
        query: { limit: AUDIENCE_LIMIT, order: 'desc' },
        schema: pageResponseSchema(contactResponseSchema),
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

export const createBroadcast = (body: CreateBroadcastInput) =>
  apiFetch('/broadcasts', { method: 'POST', body, schema: createBroadcastResponseSchema });
