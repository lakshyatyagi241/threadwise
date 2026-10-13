'use client';

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InboxConversationDetail } from '@crm/contracts';
import { useRealtimeEvent, useResync } from '@/lib/realtime';
import { inboxApi } from './service';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';

export const KEYS = {
  all: ['inbox'] as const,
  conversation: (id: string) => ['inbox', 'conversation', id] as const,
  notes: (id: string) => ['inbox', 'notes', id] as const,
  events: (id: string) => ['inbox', 'events', id] as const,
  assignees: ['inbox', 'assignees'] as const,
  tags: ['inbox', 'tags'] as const,
  channels: ['inbox', 'channels'] as const,
  templates: (id: string, q: string) => ['inbox', 'templates', id, q] as const,
};

export function useChannels() {
  return useQuery({
    queryKey: KEYS.channels,
    queryFn: ({ signal }) => inboxApi.channels(signal),
    staleTime: 30_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export const refreshChannels = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: KEYS.channels });

/** The templates the open conversation's number can send. Fetched only while the picker is open; a search narrows it on the server. */
export function useConversationTemplates(conversationId: string, enabled: boolean, q: string) {
  return useQuery({
    queryKey: KEYS.templates(conversationId, q),
    queryFn: ({ signal }) => inboxApi.templates(conversationId, q, signal),
    enabled,
    staleTime: 60_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

/** The workspace tag library (the picker, the list filter, the bulk bar, the settings screen). */
export function useTags(enabled = true) {
  return useQuery({
    queryKey: KEYS.tags,
    queryFn: ({ signal }) => inboxApi.tags(signal),
    enabled,
    staleTime: 60_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useAssignees(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.assignees,
    queryFn: ({ signal }) => inboxApi.assignees(signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useNotes(conversationId: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEYS.notes(conversationId ?? ''),
    queryFn: ({ signal }) => inboxApi.notes(conversationId!, signal),
    enabled: conversationId !== null,
    staleTime: 15_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
  // A note someone else adds is a change to the conversation row: its upsert signal refreshes the notes of an open thread.
  useRealtimeEvent('inbox.conversation.upsert', (e) => {
    if (e.payload.conversationId === conversationId) {
      void qc.invalidateQueries({ queryKey: KEYS.notes(e.payload.conversationId) });
      void qc.invalidateQueries({ queryKey: KEYS.events(e.payload.conversationId) });
    }
  });
  useResync(() => {
    if (conversationId) void qc.invalidateQueries({ queryKey: KEYS.notes(conversationId) });
  }, ['user']);
  return q;
}

export function useTimeline(conversationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.events(conversationId ?? ''),
    queryFn: ({ signal }) => inboxApi.events(conversationId!, signal),
    enabled: enabled && conversationId !== null,
    staleTime: 15_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export interface OpenConversation {
  detail: InboxConversationDetail | undefined;
  /** When the detail was read, for the window's "ran out since" rule. */
  fetchedAt: number;
  isPending: boolean;
  isError: boolean;
  notFound: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * The open conversation's detail (header, contact, assignee, window). It is refetched when its row changes over a socket and
 * after a reconnect; `onFresh` hands every fresh copy to the list so the row there matches the header.
 */
export function useOpenConversation(
  id: string | null,
  onFresh: (detail: InboxConversationDetail) => void,
): OpenConversation {
  const fresh = useRef(onFresh);
  useEffect(() => {
    fresh.current = onFresh;
  });
  const q = useQuery({
    queryKey: KEYS.conversation(id ?? ''),
    queryFn: async ({ signal }) => {
      const detail = await inboxApi.conversation(id!, signal);
      fresh.current(detail);
      return detail;
    },
    enabled: id !== null,
    staleTime: 10_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
  const refetch = q.refetch;

  useRealtimeEvent('inbox.conversation.upsert', (e) => {
    if (e.payload.conversationId !== id) return;
    const held = q.data;
    if (held && held.rowVersion >= e.payload.rowVersion) return;
    void refetch();
  });
  useRealtimeEvent('inbox.assignment', (e) => {
    if (e.payload.conversationId === id) void refetch();
  });
  useResync(() => {
    // A disabled query is fetched by `refetch()` all the same: nothing is open, nothing to reload.
    if (id) void refetch();
  }, ['user']);

  const status = (q.error as { status?: number } | null)?.status;
  return {
    detail: q.data,
    fetchedAt: q.dataUpdatedAt,
    isPending: q.isPending && id !== null,
    isError: q.isError,
    notFound: status === 404 || status === 403,
    refetch,
  };
}

/** The current time, refreshed every `everyMs` (a window countdown needs a minute, a "time ago" label a few seconds less). */
export function useNowMs(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** A stable callback that always runs the latest function: for handlers passed down to memoised children. */
export function useLatestCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
