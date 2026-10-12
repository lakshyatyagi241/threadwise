import type { CreateContactNoteInput, UpdateContactNoteInput } from '@crm/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
  createContactNote,
  deleteContactNote,
  listContactNotes,
  updateContactNote,
} from './notes-api';
import { useActionKey } from './record-support';
import { contactActivitiesKey } from './use-activity';
import { contactKey } from './use-contacts';

/** Notes asked for at a time; the list asks for the next page when the person scrolls to the end. */
export const NOTES_PAGE_SIZE = 20;

/** A finished mutation is not looked at again, so the cache forgets it at once instead of holding it for five minutes. */
const NO_KEEP = 0;

export const contactNotesKey = (contactId: string) => ['contacts', 'notes', contactId] as const;

/** The contact's notes, a page at a time, newest first. No request while `enabled` is false. */
export function useContactNotes(contactId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: contactNotesKey(contactId),
    queryFn: ({ pageParam, signal }) =>
      listContactNotes(contactId, { limit: NOTES_PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: enabled && contactId !== '',
  });
}

/**
 * One note, for the edit form. The API has no route for a single note, so it is looked up in the list (which the screen before
 * has usually loaded already) and, when it is not on the pages loaded so far, the next pages are fetched until it turns up or
 * the list ends. `searching` is true until then; a note that is neither found nor still being looked for no longer exists.
 */
export function useContactNote(contactId: string, noteId: string, enabled = true) {
  const list = useContactNotes(contactId, enabled);
  const note = useMemo(
    () => list.data?.pages.flatMap((page) => page.data).find((n) => n.id === noteId),
    [list.data, noteId],
  );
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = list;
  const wantsMore = enabled && !note && hasNextPage && !isFetchingNextPage && !isError;
  useEffect(() => {
    if (wantsMore) void fetchNextPage();
  }, [wantsMore, fetchNextPage]);
  return {
    note,
    searching:
      enabled && !note && !isError && (list.isPending || hasNextPage || isFetchingNextPage),
    error: list.error,
    refetch: list.refetch,
  };
}

/** The notes and the timeline both show a note, so both are reloaded after any change to one. */
function reload(queryClient: QueryClient, contactId: string) {
  void queryClient.invalidateQueries({ queryKey: contactNotesKey(contactId) });
  void queryClient.invalidateQueries({ queryKey: contactActivitiesKey(contactId) });
}

export function useCreateNote(contactId: string) {
  const queryClient = useQueryClient();
  const key = useActionKey();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: CreateContactNoteInput) => createContactNote(contactId, body, key.current()),
    onError: key.failed,
    onSuccess: () => {
      key.renew();
      reload(queryClient, contactId);
      // A new note moves the contact's "last activity".
      void queryClient.invalidateQueries({ queryKey: contactKey(contactId) });
    },
  });
}

export function useUpdateNote(contactId: string, noteId: string) {
  const queryClient = useQueryClient();
  const key = useActionKey();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: UpdateContactNoteInput) =>
      updateContactNote(contactId, noteId, body, key.current()),
    onError: key.failed,
    onSuccess: () => {
      key.renew();
      reload(queryClient, contactId);
    },
  });
}

export function useDeleteNote(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (noteId: string) => deleteContactNote(contactId, noteId),
    // A note that is already gone (404) is reloaded away just the same.
    onSettled: () => reload(queryClient, contactId),
  });
}
