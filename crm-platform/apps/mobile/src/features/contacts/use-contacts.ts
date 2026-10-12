import type { ContactResponse, UpdateContactInput } from '@crm/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '@/lib/api';
import {
  attachContactTag,
  createContact,
  deleteContact,
  detachContactTag,
  getContact,
  getContactTags,
  listContacts,
  updateContact,
  type ContactFilters,
  type NewContact,
} from './api';
import { listContactViews } from './views-api';

/** Rows asked for at a time; the list asks for the next page when the person scrolls to the end. */
export const PAGE_SIZE = 50;

/** A finished mutation is not looked at again, so the cache forgets it at once instead of holding it for five minutes. */
const NO_KEEP = 0;

export const contactsKey = ['contacts'] as const;
export const contactListKey = (filters: ContactFilters) => ['contacts', 'list', filters] as const;
export const contactKey = (id: string) => ['contacts', 'detail', id] as const;
export const contactTagsKey = (id: string) => ['contacts', 'tags', id] as const;

/** A value that follows `value` after it has stopped changing for `delayMs` (the search box waits for the person to pause). */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/** The list, a page at a time. No request at all when `enabled` is false (the person may not read contacts). */
export function useContactList(filters: ContactFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: contactListKey(filters),
    queryFn: ({ pageParam, signal }) =>
      listContacts({ ...filters, limit: PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled,
    // Typing in the search box keeps the rows on screen until the narrowed ones arrive, instead of blanking the list.
    placeholderData: keepPreviousData,
  });
}

export const useContact = (id: string, enabled = true) =>
  useQuery({
    queryKey: contactKey(id),
    queryFn: ({ signal }) => getContact(id, signal),
    enabled: enabled && id !== '',
  });

export const useContactTags = (id: string, enabled = true) =>
  useQuery({
    queryKey: contactTagsKey(id),
    queryFn: ({ signal }) => getContactTags(id, signal),
    enabled: enabled && id !== '',
  });

/** Puts a contact the API just returned into the cache and refreshes every list that may show it. */
function remember(queryClient: QueryClient, contact: ContactResponse) {
  queryClient.setQueryData(contactKey(contact.id), contact);
  void queryClient.invalidateQueries({ queryKey: [...contactsKey, 'list'] });
}

/**
 * One idempotency key per user action. Only a lost connection keeps the key (the tap on "Save" is repeated as the same request);
 * any answer from the server ends the action, so a corrected form is a new one.
 */
function useActionKey() {
  const key = useRef(Crypto.randomUUID());
  const renew = () => void (key.current = Crypto.randomUUID());
  return {
    current: () => key.current,
    renew,
    failed: (error: unknown) => {
      if (!(isApiError(error) && error.isConnectivity)) renew();
    },
  };
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  const key = useActionKey();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: NewContact) => createContact(body, key.current()),
    onError: key.failed,
    onSuccess: (contact) => {
      key.renew();
      remember(queryClient, contact);
    },
  });
}

export function useUpdateContact(id: string) {
  const queryClient = useQueryClient();
  const key = useActionKey();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: UpdateContactInput) => updateContact(id, body, key.current()),
    onError: key.failed,
    onSuccess: (contact) => {
      key.renew();
      remember(queryClient, contact);
    },
  });
}

export function useAttachTag(id: string) {
  const queryClient = useQueryClient();
  const key = useActionKey();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (name: string) => attachContactTag(id, name, key.current()),
    onError: key.failed,
    onSuccess: () => {
      key.renew();
      void queryClient.invalidateQueries({ queryKey: contactTagsKey(id) });
      void queryClient.invalidateQueries({ queryKey: [...contactsKey, 'list'] });
    },
  });
}

export function useDetachTag(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (tagId: string) => detachContactTag(id, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactTagsKey(id) });
      void queryClient.invalidateQueries({ queryKey: [...contactsKey, 'list'] });
    },
  });
}

export function useDeleteContact(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: () => deleteContact(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: contactKey(id) });
      void queryClient.invalidateQueries({ queryKey: [...contactsKey, 'list'] });
    },
  });
}

export const contactViewsKey = [...contactsKey, 'views'] as const;

/** The saved views of the workspace, for the picker. Slow to change, so a minute is fresh enough. */
export const useContactViews = (enabled: boolean) =>
  useQuery({
    queryKey: contactViewsKey,
    queryFn: ({ signal }) => listContactViews(signal),
    enabled,
    staleTime: 60_000,
  });
