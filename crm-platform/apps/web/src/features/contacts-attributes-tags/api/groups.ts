'use client';

import { useQuery } from '@tanstack/react-query';
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

/** Every group, newest first, with its workspace-wide member count. */
export function useGroups() {
  return useQuery({
    queryKey: KEYS.groups,
    queryFn: ({ signal }) =>
      fetchAllPages('/contact-groups', contactGroupResponseSchema, {}, { signal }),
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

/** Absent keeps, null clears (WaDesk wiped the note whenever it was not sent). */
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
