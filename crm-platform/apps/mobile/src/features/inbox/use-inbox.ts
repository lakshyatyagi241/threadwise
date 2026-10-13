import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { MessageListResponse, SetConversationStatusInput } from '@crm/contracts';
import * as Crypto from 'expo-crypto';
import {
  assignConversation,
  fetchConversation,
  fetchConversations,
  fetchMessages,
  markConversationRead,
  retryMessage,
  sendTextMessage,
  setConversationStatus,
} from './api';
import type { AssignInput } from './api';
import type { InboxFilters } from './filters';
import { withMessage } from './thread-model';

/** How often an open thread asks for news while it is on screen; realtime sockets replace this later. */
export const THREAD_POLL_MS = 15_000;

const listKey = ['inbox', 'conversations'] as const;
const detailKey = (id: string) => ['inbox', 'conversation', id] as const;
const messagesKey = (id: string) => ['inbox', 'messages', id] as const;

/** The conversation list, a page at a time. No request at all while `enabled` is false (the person may not read the inbox). */
export const useConversations = (filters: InboxFilters, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: [...listKey, filters.tab, filters.status, filters.q],
    queryFn: ({ pageParam, signal }) => fetchConversations(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined,
    enabled,
  });

export const useConversationDetail = (id: string, polling: boolean, enabled: boolean) =>
  useQuery({
    queryKey: detailKey(id),
    queryFn: ({ signal }) => fetchConversation(id, signal),
    refetchInterval: polling ? THREAD_POLL_MS : false,
    enabled,
  });

/** The thread, newest page first; the next page is the one before the oldest message loaded. */
export const useThreadMessages = (id: string, polling: boolean, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: messagesKey(id),
    queryFn: ({ pageParam, signal }) => fetchMessages(id, pageParam, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => (page.page.hasMoreBefore ? page.data[0]?.seq : undefined),
    refetchInterval: polling ? THREAD_POLL_MS : false,
    enabled,
  });

/** After any change the list rows and the open thread read from the API again. */
function useRefreshInbox(id: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: listKey }),
      queryClient.invalidateQueries({ queryKey: detailKey(id) }),
    ]);
}

export function useMarkRead(id: string) {
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (upToSeq: number) => markConversationRead(id, upToSeq),
    onSuccess: refresh,
  });
}

export function useSetStatus(id: string) {
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (input: SetConversationStatusInput) => setConversationStatus(id, input),
    // Success and conflict both leave the screen holding a stale row version; reading again is right either way.
    onSettled: refresh,
  });
}

export function useAssign(id: string) {
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (input: AssignInput) => assignConversation(id, input, Crypto.randomUUID()),
    // Success and conflict both leave the screen holding a stale row version; reading again is right either way.
    onSettled: refresh,
  });
}

export function useSendMessage(id: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (draft: { clientMessageId: string; body: string }) =>
      sendTextMessage(id, draft.clientMessageId, draft.body),
    onSuccess: (stored) => {
      queryClient.setQueryData<InfiniteData<MessageListResponse>>(messagesKey(id), (data) =>
        withMessage(data, stored),
      );
    },
    // A refused send (window closed, channel down) changes what the detail says, so it is read again either way.
    onSettled: refresh,
  });
}

export function useRetryMessage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => retryMessage(messageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey(id) }),
  });
}
