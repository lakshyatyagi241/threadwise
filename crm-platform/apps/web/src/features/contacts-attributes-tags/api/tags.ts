'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { TAG_NAME_MAX } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { fetchAllPages } from './http';
import { KEYS } from './contacts';
import { contactTagsSchema, tagResponseSchema, type TagResponse } from './schemas';

export { TAG_NAME_MAX };

/** Every tag of the workspace, name order, with how many contacts carry it (the bulk picker shows "Name (count)"). */
export function useTags(enabled = true) {
  return useQuery({
    queryKey: KEYS.tags,
    queryFn: async ({ signal }) => {
      const all = await fetchAllPages(
        '/tags',
        tagResponseSchema,
        { includeCounts: true },
        { signal },
      );
      return all.sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled,
  });
}

export function useContactTags(contactId: string | null) {
  return useQuery({
    queryKey: KEYS.contactTags(contactId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch(`/contacts/${contactId}/tags`, { schema: contactTagsSchema, signal }),
    enabled: contactId !== null,
  });
}

/** Tag names compare without case or surrounding space: "VIP" and " vip" are one tag (TW-CON-041 rule 1). */
export const sameTagName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Attaches a tag to one contact by id, or by name (the API finds the tag or creates it; creating needs
 * `record.tags.create` and counts against the plan's tag limit). Already attached is a no-op.
 */
export const attachTagToContact = (
  contactId: string,
  tag: { id?: string; name?: string },
): Promise<TagResponse> =>
  apiFetch(`/contacts/${contactId}/tags`, {
    method: 'POST',
    body: tag.id ? { tagId: tag.id } : { name: tag.name?.trim() },
    schema: tagResponseSchema,
  });

export const detachTag = (contactId: string, tagId: string): Promise<void> =>
  apiFetch(`/contacts/${contactId}/tags/${tagId}`, { method: 'DELETE' });

export const invalidateTags = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.tags });
