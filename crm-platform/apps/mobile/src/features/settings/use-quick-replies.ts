import type { SavedReply } from '@crm/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createQuickReply,
  deleteQuickReply,
  duplicateQuickReply,
  fetchQuickReplies,
  fetchQuickReply,
  updateQuickReply,
  type ScopeFilter,
} from './quick-replies-api';

export const quickRepliesKey = ['settings', 'quick-replies'] as const;
const quickReplyKey = (id: string) => [...quickRepliesKey, 'one', id] as const;

/** The inbox's reply picker keeps its own copy of the library; a change here must reach it too (the key is the inbox's, as plain data). */
const PICKER_KEY = ['inbox', 'saved-replies'] as const;

/** The library a page at a time. No request at all while `enabled` is false (the person may not manage replies). */
export const useQuickReplyList = (scope: ScopeFilter, q: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: [...quickRepliesKey, 'list', scope, q.trim()],
    queryFn: ({ pageParam, signal }) => fetchQuickReplies({ scope, q }, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined,
    enabled,
  });

/** One reply, for the edit form. */
export const useQuickReply = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: quickReplyKey(id),
    queryFn: ({ signal }) => fetchQuickReply(id, signal),
    enabled: enabled && id !== '',
  });

function useRefreshLibrary() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: quickRepliesKey }),
      queryClient.invalidateQueries({ queryKey: PICKER_KEY }),
    ]);
}

export function useCreateQuickReply() {
  const refresh = useRefreshLibrary();
  return useMutation({
    mutationFn: (input: Parameters<typeof createQuickReply>[0]) => createQuickReply(input),
    onSuccess: refresh,
  });
}

export function useUpdateQuickReply(id: string) {
  const refresh = useRefreshLibrary();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateQuickReply>[1]) => updateQuickReply(id, input),
    // A conflict leaves the form holding an old version: read again either way.
    onSettled: refresh,
  });
}

export function useDeleteQuickReply() {
  const refresh = useRefreshLibrary();
  return useMutation({
    mutationFn: (reply: SavedReply) => deleteQuickReply(reply.id),
    onSettled: refresh,
  });
}

export function useDuplicateQuickReply() {
  const refresh = useRefreshLibrary();
  return useMutation({
    mutationFn: (reply: SavedReply) => duplicateQuickReply(reply.id),
    onSuccess: refresh,
  });
}
