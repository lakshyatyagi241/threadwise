import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type {
  MarkSpamConversationInput,
  MessageListResponse,
  SetConversationPriorityInput,
  SetConversationStatusInput,
  SnoozeConversationInput,
} from '@crm/contracts';
import * as Crypto from 'expo-crypto';
import {
  assignConversation,
  fetchAssignees,
  fetchChannels,
  fetchConversation,
  fetchConversations,
  fetchInboxTemplates,
  fetchMessages,
  markConversationRead,
  markConversationSpam,
  retryMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
  setConversationPriority,
  setConversationStatus,
  snoozeConversation,
  uploadInboxMedia,
} from './api';
import type { AssignInput } from './api';
import type { PickedAttachment } from './attachment';
import type { InboxFilters } from './filters';
import { withMessage } from './thread-model';

/** How often an open thread asks for news while it is on screen and the live connection is not up (with it, events say when to read again). */
export const THREAD_POLL_MS = 15_000;

/** How often the conversation list asks for news while the Inbox tab is on screen (a new message, a taken or resolved thread, the tab counts), while the live connection is not up. */
export const INBOX_POLL_MS = 15_000;

export const listKey = ['inbox', 'conversations'] as const;
export const detailKey = (id: string) => ['inbox', 'conversation', id] as const;
export const messagesRoot = ['inbox', 'messages'] as const;
export const messagesKey = (id: string) => [...messagesRoot, id] as const;

/**
 * The conversation list, a page at a time. No request at all while `enabled` is false (the person may not read the inbox). While
 * `polling` (the tab is in front) every loaded page is read again every 15 seconds, so a customer's new message shows up by itself.
 */
export const useConversations = (filters: InboxFilters, enabled: boolean, polling = false) =>
  useInfiniteQuery({
    queryKey: [
      ...listKey,
      filters.tab,
      filters.status,
      filters.q,
      filters.channelId,
      filters.labels.join(','),
      filters.archived,
      // The same agents in another order are the same list.
      [...filters.agentIds].sort().join(','),
      filters.sort,
    ],
    queryFn: ({ pageParam, signal }) => fetchConversations(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined,
    refetchInterval: polling ? INBOX_POLL_MS : false,
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

/** Marks the conversation as spam; it leaves the live lists. The lists and the thread read again either way. */
export function useMarkSpam(id: string) {
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (input: MarkSpamConversationInput) =>
      markConversationSpam(id, input, Crypto.randomUUID()),
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

/** Low, normal, high or urgent. The lists and the open thread read again either way, so the next press carries the current row version. */
export function useSetPriority(id: string) {
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (input: SetConversationPriorityInput) => setConversationPriority(id, input),
    onSettled: refresh,
  });
}

/** Parks the conversation until a time; it reopens by itself. */
export function useSnooze(id: string) {
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (input: SnoozeConversationInput) => snoozeConversation(id, input),
    onSettled: refresh,
  });
}

/**
 * The staff and teams a conversation can be given to. Only asked for by a person who may hand a conversation to anyone, and only
 * while the picker is open; the list is kept five minutes (the counts beside the names are as old as that).
 */
export const useAssignees = (enabled: boolean) =>
  useQuery({
    queryKey: ['inbox', 'assignees'],
    queryFn: ({ signal }) => fetchAssignees(signal),
    staleTime: 5 * 60_000,
    enabled,
  });

/** The workspace's channels, for the filter sheet. Only asked for while the sheet is open; they change rarely. */
export const useChannels = (enabled: boolean) =>
  useQuery({
    queryKey: ['inbox', 'channels'],
    queryFn: ({ signal }) => fetchChannels(signal),
    staleTime: 5 * 60_000,
    enabled,
  });

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

/** The templates the conversation's number can send. Only asked for while the picker is open; the list changes rarely, so it is kept a minute. */
export const useInboxTemplates = (id: string, q: string, enabled: boolean) =>
  useQuery({
    queryKey: ['inbox', 'templates', id, q.trim()],
    queryFn: ({ signal }) => fetchInboxTemplates(id, q, signal),
    staleTime: 60_000,
    enabled,
    // Typing in the search box keeps the rows on screen until the new ones arrive, instead of flashing a spinner at each word.
    placeholderData: keepPreviousData,
  });

/** Sends a template. Like a text, the stored message goes straight into the thread and the detail is read again either way. */
export function useSendTemplate(id: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (draft: {
      clientMessageId: string;
      templateId: string;
      variables: Record<string, string>;
    }) => sendTemplateMessage(id, draft.clientMessageId, draft.templateId, draft.variables),
    onSuccess: (stored) => {
      queryClient.setQueryData<InfiniteData<MessageListResponse>>(messagesKey(id), (data) =>
        withMessage(data, stored),
      );
    },
    onSettled: refresh,
  });
}

/** Uploads the file that is about to be sent (the first half of sending an attachment). */
export const useUploadMedia = () =>
  useMutation({
    mutationFn: (draft: { file: PickedAttachment; idempotencyKey: string; signal?: AbortSignal }) =>
      uploadInboxMedia(draft.file, draft.idempotencyKey, draft.signal),
  });

/** Sends an uploaded file as a message. Like a text, the stored message goes straight into the thread and the detail is read again either way. */
export function useSendMedia(id: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshInbox(id);
  return useMutation({
    mutationFn: (draft: { clientMessageId: string; mediaId: string; caption: string }) =>
      sendMediaMessage(id, draft.clientMessageId, draft.mediaId, draft.caption),
    onSuccess: (stored) => {
      queryClient.setQueryData<InfiniteData<MessageListResponse>>(messagesKey(id), (data) =>
        withMessage(data, stored),
      );
    },
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
