import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteContactFile, listContactFiles } from './files-api';

/** Files asked for at a time; the tab shows a "Load more" button for the next page. */
export const FILES_PAGE_SIZE = 20;

/** A finished mutation is not looked at again, so the cache forgets it at once instead of holding it for five minutes. */
const NO_KEEP = 0;

export const contactFilesKey = (contactId: string) => ['contacts', 'files', contactId] as const;

/** The contact's file records, a page at a time, newest first. No request while `enabled` is false. */
export function useContactFiles(contactId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: contactFilesKey(contactId),
    queryFn: ({ pageParam, signal }) =>
      listContactFiles(contactId, { limit: FILES_PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: enabled && contactId !== '',
  });
}

export function useDeleteFile(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (fileId: string) => deleteContactFile(contactId, fileId),
    // A file that is already gone (404) is reloaded away just the same.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: contactFilesKey(contactId) });
    },
  });
}
