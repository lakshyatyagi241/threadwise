'use client';

import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { TchatMessageResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { EMPTY_THREAD, newestId, threadReducer, type Pending } from '../lib/thread';
import { chatApi, sendMessage } from './service';

export const KEYS = {
  all: ['team-chat'] as const,
  channels: ['team-chat', 'channels'] as const,
  roster: ['team-chat', 'roster'] as const,
  invitations: ['team-chat', 'invitations'] as const,
  activity: (channelId: string) => ['team-chat', 'activity', channelId] as const,
  members: (channelId: string) => ['team-chat', 'members', channelId] as const,
  pinned: (channelId: string) => ['team-chat', 'pinned', channelId] as const,
};

/** How often each thing refreshes (Reference: messages 3 s, channels 15 s). Paused while the tab is hidden. */
export const POLL = {
  messages: 3_000,
  window: 15_000,
  channels: 15_000,
  activity: 4_000,
  presence: 30_000,
};

export function useChannels() {
  return useQuery({
    queryKey: KEYS.channels,
    queryFn: ({ signal }) => chatApi.channels(signal),
    refetchInterval: POLL.channels,
    retry: false,
  });
}

export function useRoster() {
  return useQuery({
    queryKey: KEYS.roster,
    queryFn: ({ signal }) => chatApi.roster(signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function useInvitations() {
  return useQuery({
    queryKey: KEYS.invitations,
    queryFn: ({ signal }) => chatApi.invitations(signal),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useActivity(channelId: string | null) {
  return useQuery({
    queryKey: KEYS.activity(channelId ?? ''),
    queryFn: ({ signal }) => chatApi.activity(channelId!, signal),
    enabled: channelId !== null,
    refetchInterval: POLL.activity,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useChannelMembers(channelId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.members(channelId ?? ''),
    queryFn: ({ signal }) => chatApi.channelMembers(channelId!, signal),
    enabled: enabled && channelId !== null,
    retry: false,
  });
}

export const refreshChannels = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: KEYS.channels });
export const refreshInvitations = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: KEYS.invitations });

/** Pings "I am online" now and every 30 seconds while the tab is visible. */
export function usePresencePing(): void {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === 'visible') void chatApi.presence().catch(() => undefined);
    };
    ping();
    const id = window.setInterval(ping, POLL.presence);
    return () => window.clearInterval(id);
  }, []);
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** A code the screen turns into a sentence: the API's problem code, or `network`. */
export const errorCode = (e: unknown): string =>
  e instanceof ApiError ? (e.status === 413 ? 'PAYLOAD_TOO_LARGE' : e.code) : 'network';

export interface SendDraft {
  body: string;
  replyToId: string | null;
  file: File | null;
}

/**
 * One channel's messages: the newest page, a poll for newer ones, a slower refresh of the whole window (so other people's
 * edits, deletions and reactions show up, which Reference only did on a full reload), older history on request, and the sends in
 * flight. The read pointer moves forward whenever a newer message is on screen of a visible tab.
 */
export function useThread(channelId: string | null, onChanged: () => void) {
  const [state, dispatch] = useReducer(threadReducer, EMPTY_THREAD);
  const [olderLoading, setOlderLoading] = useState(false);
  const files = useRef(new Map<string, File>());
  const latest = useRef(state);
  const readUpTo = useRef<string | null>(null);
  const changed = useRef(onChanged);
  const channelRef = useRef(channelId);
  // The callbacks below run in timers and handlers, so they read the newest props and state through refs set after each render.
  useEffect(() => {
    latest.current = state;
    changed.current = onChanged;
    channelRef.current = channelId;
  });

  const markRead = useCallback((id: string | null) => {
    const channel = channelRef.current;
    if (!channel || !id || readUpTo.current === id || !isVisible()) return;
    readUpTo.current = id;
    chatApi
      .markRead(channel, id)
      .then(() => changed.current())
      .catch(() => {
        readUpTo.current = null;
      });
  }, []);

  // Full load on every channel switch.
  useEffect(() => {
    dispatch({ type: 'reset' });
    readUpTo.current = null;
    files.current.clear();
    if (!channelId) return;
    const ctl = new AbortController();
    chatApi
      .messages(channelId, {}, ctl.signal)
      .then((page) => {
        dispatch({ type: 'loaded', messages: page.data, olderCursor: page.page.nextCursor });
        markRead(newestId(page.data));
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) dispatch({ type: 'loadFailed', error: errorCode(e) });
      });
    return () => ctl.abort();
  }, [channelId, markRead]);

  // The poll for newer messages; a burst bigger than a page is read in order by asking again at once.
  useEffect(() => {
    if (!channelId) return;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy || !isVisible() || !latest.current.loaded) return;
      busy = true;
      try {
        let more = true;
        while (more && !stopped) {
          const after = newestId(latest.current.messages);
          if (!after) {
            const page = await chatApi.messages(channelId, {});
            dispatch({ type: 'loaded', messages: page.data, olderCursor: page.page.nextCursor });
            break;
          }
          const page = await chatApi.messages(channelId, { after });
          if (stopped || channelRef.current !== channelId) return;
          if (page.data.length) {
            dispatch({ type: 'append', messages: page.data });
            latest.current = {
              ...latest.current,
              messages: [...latest.current.messages, ...page.data],
            };
            markRead(newestId(page.data));
          }
          more = page.page.hasMore;
        }
      } catch (e) {
        // The message we poll from was deleted: start over from the newest page. Anything else retries next tick.
        if (e instanceof ApiError && e.status === 404) {
          const page = await chatApi.messages(channelId, {}).catch(() => null);
          if (page && !stopped) {
            dispatch({ type: 'loaded', messages: page.data, olderCursor: page.page.nextCursor });
          }
        }
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), POLL.messages);
    const onVisible = () => void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [channelId, markRead]);

  // The slower refresh of the newest window: edits, deletions, reactions and pins by other people.
  useEffect(() => {
    if (!channelId) return;
    const id = window.setInterval(() => {
      if (!isVisible() || !latest.current.loaded) return;
      chatApi
        .messages(channelId, {})
        .then((page) => {
          if (channelRef.current === channelId) {
            dispatch({ type: 'refresh', messages: page.data, olderCursor: page.page.nextCursor });
          }
        })
        .catch(() => undefined);
    }, POLL.window);
    return () => window.clearInterval(id);
  }, [channelId]);

  const loadOlder = useCallback(async () => {
    const cursor = latest.current.olderCursor;
    const channel = channelRef.current;
    if (!cursor || !channel || olderLoading) return;
    setOlderLoading(true);
    try {
      const page = await chatApi.messages(channel, { before: cursor });
      if (channelRef.current === channel) {
        dispatch({ type: 'older', messages: page.data, olderCursor: page.page.nextCursor });
      }
    } catch {
      // The button stays; pressing it again retries.
    } finally {
      setOlderLoading(false);
    }
  }, [olderLoading]);

  const run = useCallback(async (key: string, channel: string, draft: SendDraft) => {
    try {
      const message = await sendMessage({ channelId: channel, ...draft, key }, (progress) =>
        dispatch({ type: 'progress', key, progress }),
      );
      files.current.delete(key);
      if (channelRef.current === channel) dispatch({ type: 'sent', key, message });
      readUpTo.current = message.id;
      changed.current();
    } catch (e) {
      if (channelRef.current === channel) dispatch({ type: 'failed', key, error: errorCode(e) });
    }
  }, []);

  /** Shows the message at once and sends it; the draft is the caller's to clear. */
  const send = useCallback(
    (draft: SendDraft) => {
      const channel = channelRef.current;
      if (!channel) return;
      const key = crypto.randomUUID();
      if (draft.file) files.current.set(key, draft.file);
      const pending: Pending = {
        key,
        body: draft.body,
        replyToId: draft.replyToId,
        file: draft.file ? { name: draft.file.name, size: draft.file.size } : null,
        status: 'sending',
        progress: 0,
        error: null,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'send', pending });
      void run(key, channel, draft);
    },
    [run],
  );

  /** Sends a failed message again with the same key, so it cannot be posted twice. */
  const retry = useCallback(
    (key: string) => {
      const channel = channelRef.current;
      const p = latest.current.pending.find((x) => x.key === key);
      if (!channel || !p) return;
      dispatch({ type: 'retry', key });
      void run(key, channel, {
        body: p.body,
        replyToId: p.replyToId,
        file: files.current.get(key) ?? null,
      });
    },
    [run],
  );

  const dismiss = useCallback((key: string) => {
    files.current.delete(key);
    dispatch({ type: 'dismiss', key });
  }, []);

  const patch = useCallback(
    (message: TchatMessageResponse) => dispatch({ type: 'patch', message }),
    [],
  );
  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), []);

  return {
    messages: state.messages,
    pending: state.pending,
    loaded: state.loaded,
    error: state.error,
    hasOlder: state.olderCursor !== null,
    olderLoading,
    loadOlder,
    send,
    retry,
    dismiss,
    patch,
    remove,
  };
}
