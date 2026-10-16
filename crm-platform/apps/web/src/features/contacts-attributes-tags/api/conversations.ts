'use client';

import { useQuery } from '@tanstack/react-query';
import { conversationListResponseSchema, type ConversationSummary } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { contactSearchTerm, conversationsOfContact } from '../lib/contact-data';

export const CONVERSATIONS_KEY = (contactId: string) =>
  ['cat', 'contact-conversations', contactId] as const;

/** How many inbox rows one look at a contact reads (the list's own cap per page is 200). */
const SEARCH_LIMIT = 100;

interface ContactForSearch {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
}

/** The cache key of one contact's conversation search (the search term is part of it). */
export const contactConversationsKey = (contact: ContactForSearch) =>
  [...CONVERSATIONS_KEY(contact.id), contactSearchTerm(contact)] as const;

/**
 * Runs the search and keeps only this contact's rows (exported so a test can run the real filter against a stubbed `fetch`).
 *
 * LIMIT OF THE API: there is no "conversations of this contact" route. `GET /inbox/conversations` searches by text (`q`: name,
 * number or a word of the preview), so this asks for every status with `q` = the contact's phone digits (else e-mail, else
 * name) and then keeps only the rows whose `contact.id` is this contact, so a fuzzy match never shows someone else's thread.
 * Consequences: archived threads are not included; at most the first `SEARCH_LIMIT` matches of the search are looked at; a
 * thread that is not linked to the contact record (no `contact` on the row) is not found. A contact with neither phone, e-mail
 * nor name is not searched.
 */
export async function fetchContactConversations(
  contact: ContactForSearch,
  signal?: AbortSignal,
): Promise<ConversationSummary[]> {
  const res = await apiFetch('/inbox/conversations', {
    query: { q: contactSearchTerm(contact) ?? undefined, status: 'all', limit: SEARCH_LIMIT },
    schema: conversationListResponseSchema,
    signal,
  });
  return conversationsOfContact(res.data, contact.id);
}

/** The conversations found for a contact (see `fetchContactConversations` for how and what it can miss). */
export function useContactConversations(contact: ContactForSearch, enabled: boolean) {
  const searchable = contactSearchTerm(contact) !== null;
  const q = useQuery({
    queryKey: contactConversationsKey(contact),
    enabled: enabled && searchable,
    retry: false,
    queryFn: ({ signal }) => fetchContactConversations(contact, signal),
  });
  const items: ConversationSummary[] = q.data ?? [];
  return {
    items,
    /** False for a contact there is nothing to search by (the section then says "none found"). */
    searchable,
    isPending: enabled && searchable && q.isPending,
    isError: q.isError,
    error: q.error,
    isSuccess: q.isSuccess,
    refetch: q.refetch,
  };
}
