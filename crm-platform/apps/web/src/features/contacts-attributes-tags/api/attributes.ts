'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { SYSTEM_ATTRIBUTES, type CreateAttributeInput } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toAttribute, type Attribute, type PickerEntry } from '../lib/attribute-model';
import type { StatusFilter } from '../lib/attribute-model';
import { KEYS } from './contacts';
import { fetchAllPages } from './http';
import {
  attributeListResponseSchema,
  attributePickerFeedSchema,
  attributeResponseSchema,
  statusOptionResponseSchema,
} from './schemas';

/**
 * The attributes screen: search and the status filter run on the server, and the tile and sidebar counts come back
 * with every page (they are workspace-wide and ignore the search).
 */
export function useAttributeList(status: StatusFilter, q: string) {
  const query = { status, q: q.trim() || undefined, limit: 12 };
  const result = useInfiniteQuery({
    queryKey: [...KEYS.attributes, 'list', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/attributes', {
        query: { ...query, cursor: pageParam },
        schema: attributeListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const pages = result.data?.pages ?? [];
  return {
    ...result,
    items: pages.flatMap((p) => p.data).map(toAttribute),
    counts: pages[0]?.counts,
  };
}

/** Every attribute, for the contact form's inputs and the list's chip labels. */
export function useAttributes() {
  return useQuery({
    queryKey: [...KEYS.attributes, 'all'],
    queryFn: async ({ signal }): Promise<Attribute[]> =>
      (await fetchAllPages('/attributes', attributeResponseSchema, {}, { signal })).map(
        toAttribute,
      ),
    staleTime: 60_000,
  });
}

/** The slash picker's feed: built-in tokens plus the active custom attributes (TW-CON-046). */
export function usePickerFeed() {
  return useQuery({
    queryKey: KEYS.attributePicker,
    queryFn: ({ signal }) =>
      apiFetch('/attributes/picker', { schema: attributePickerFeedSchema, signal }),
    staleTime: 60_000,
  });
}

export function pickerEntries(
  feed:
    | {
        system: Array<{ key: string; name: string; description: string }>;
        custom: Array<{ key: string; name: string; description: string | null }>;
      }
    | undefined,
  systemName: (key: string) => string,
): PickerEntry[] {
  // Until the feed arrives (or if it fails) the ten built-in tokens are still offered.
  const system =
    feed?.system ??
    SYSTEM_ATTRIBUTES.map((a) => ({ key: a.key, name: a.name, description: a.description }));
  return [
    ...system.map((s) => ({
      kind: 'system' as const,
      key: s.key,
      name: systemName(s.key) || s.name,
      description: s.description,
    })),
    ...(feed?.custom ?? []).map((c) => ({
      kind: 'custom' as const,
      key: c.key,
      name: c.name,
      description: c.description ?? '',
    })),
  ];
}

export interface AttributeInput {
  name: string;
  key: string;
  defaultValue: string;
  description: string;
  active: boolean;
}

export const createAttribute = (input: AttributeInput) => {
  const body: CreateAttributeInput = {
    name: input.name.trim(),
    key: input.key.trim(),
    type: 'text',
    defaultValue: input.defaultValue.trim() || null,
    description: input.description.trim() || null,
    isActive: input.active,
  };
  return apiFetch('/attributes', { method: 'POST', body, schema: attributeResponseSchema });
};

/** The key never changes; everything else does. Sends the rowVersion that was read, and an explicit active flag. */
export const updateAttribute = (current: Attribute, input: Omit<AttributeInput, 'key'>) =>
  apiFetch(`/attributes/${current.id}`, {
    method: 'PATCH',
    body: {
      name: input.name.trim(),
      defaultValue: input.defaultValue.trim() || null,
      description: input.description.trim() || null,
      isActive: input.active,
      rowVersion: current.rowVersion,
    },
    schema: attributeResponseSchema,
  });

/**
 * Deleting an attribute some contacts hold a value for is refused (`CON_ATTRIBUTE_IN_USE`) until the caller confirms
 * with `force`; the stored values stay either way.
 */
export const deleteAttribute = (id: string, force = false): Promise<void> =>
  apiFetch(`/attributes/${id}`, { method: 'DELETE', query: force ? { force: true } : {} });

/** Status options of the contacts module, for the stage and status pickers. */
export function useStatusOptions() {
  return useQuery({
    queryKey: KEYS.statusOptions,
    queryFn: ({ signal }) =>
      fetchAllPages(
        '/status-options',
        statusOptionResponseSchema,
        { moduleKey: 'contacts' },
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
}
