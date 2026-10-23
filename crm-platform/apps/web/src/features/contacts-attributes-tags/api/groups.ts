'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CreateContactGroupInput, UpdateContactGroupInput } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { KEYS } from './contacts';
import { fetchAllPages } from './http';
import {
  contactGroupResponseSchema,
  contactGroupsSchema,
  createContactGroupResponseSchema,
  type ContactGroup,
  type CreateContactGroupResponse,
} from './schemas';

/**
 * Every group, newest first, with its workspace-wide member count. `q` narrows it by name on the server; a search has its own cache
 * entry, so the pickers that read the whole list keep theirs. Invalidating `KEYS.groups` covers both.
 */
export function useGroups(q?: string) {
  const search = q?.trim() ? q.trim() : undefined;
  return useQuery({
    queryKey: search ? ([...KEYS.groups, 'search', search] as const) : KEYS.groups,
    queryFn: ({ signal }) =>
      fetchAllPages('/contact-groups', contactGroupResponseSchema, search ? { q: search } : {}, {
        signal,
      }),
    // Typing a search keeps the rows on screen until the narrower list arrives.
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Creating a name that already exists answers 200 with that group and `existing: true` (a double-click stays harmless). */
export const createGroup = (input: CreateContactGroupInput): Promise<CreateContactGroupResponse> =>
  apiFetch('/contact-groups', {
    method: 'POST',
    body: input,
    schema: createContactGroupResponseSchema,
  });

/** Absent keeps, null clears (Reference wiped the note whenever it was not sent). */
export const updateGroup = (
  group: ContactGroup,
  input: Omit<UpdateContactGroupInput, 'rowVersion'>,
): Promise<ContactGroup> =>
  apiFetch(`/contact-groups/${group.id}`, {
    method: 'PATCH',
    body: { ...input, rowVersion: group.rowVersion },
    schema: contactGroupResponseSchema,
  });

export const deleteGroup = (id: string): Promise<void> =>
  apiFetch(`/contact-groups/${id}`, { method: 'DELETE' });

/** Replaces one contact's groups with exactly this list; an empty list removes the last group too. */
export const setContactGroups = (contactId: string, groupIds: readonly string[]) =>
  apiFetch(`/contacts/${contactId}/groups`, {
    method: 'PUT',
    body: { groupIds },
    schema: contactGroupsSchema,
  });

export const GROUP_DOT_FALLBACK = '#3214db';
