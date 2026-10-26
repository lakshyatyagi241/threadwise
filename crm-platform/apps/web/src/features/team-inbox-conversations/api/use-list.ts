'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { REALTIME_EVENT } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { useRealtimeEvent, useResync } from '@/lib/realtime';
import { errorCode } from '../lib/errors';
import {
  EMPTY_LIST,
  filtersKey,
  listReducer,
  narrowsCounts,
  type ListFilters,
  type ListState,
} from '../lib/list';
import { usePublishCounts } from './counts';
import { inboxApi } from './service';
import type { ConversationSummary } from '@crm/contracts';

/** Counts are refetched this long after the last signal, so a burst of events costs one request. */
const COUNTS_DEBOUNCE_MS = 400;
/** Rows named by signals are fetched together after this pause. */
const ROW_DEBOUNCE_MS = 150;
/** The safety poll that keeps the tab badges honest if the socket is down (plan section 3.6). */
const COUNTS_POLL_MS = 60_000;

export interface ConversationList {
  state: ListState;
  loadMore: () => void;
  /** Reload the first page without clearing what is shown. */
  refresh: () => void;
  /** A row fetched elsewhere (the open thread's detail): place it. */
  placeRow: (row: ConversationSummary) => void;
  setUnread: (id: string, unread: number) => void;
  /** Recount the tab badges soon (after a change this screen made itself). */
  refreshCounts: () => void;
}

/**
 * The conversation list: the first page for the filters, "load more" by cursor, and live updates. Realtime events are signals
 * (an id and what changed, never the row): the row is fetched over REST, where the caller's scope applies, then placed in order
 * or dropped if it no longer belongs to this tab. A reconnect, a missed event or a returning tab reloads the first page.
 */
export function useConversationList(filters: ListFilters, meId: string | null): ConversationList {
  const [state, dispatch] = useReducer(listReducer, EMPTY_LIST);
  // The menu's Inbox badge is the whole inbox's unread count, so only unfiltered badges may take its place.
  usePublishCounts(narrowsCounts(filters) ? null : state.counts);
  const key = filtersKey(filters);
  const latest = useRef({ state, filters, meId });
  const generation = useRef(0);
  useEffect(() => {
    latest.current = { state, filters, meId };
  });

  const loadFirst = useCallback(async (silent: boolean) => {
    const gen = ++generation.current;
    if (!silent) dispatch({ type: 'reset' });
    try {
      const page = await inboxApi.conversations(latest.current.filters, null);
      if (gen !== generation.current) return;
      dispatch({
        type: 'loaded',
        rows: page.data,
        cursor: page.page.nextCursor,
        hasMore: page.page.hasMore,
        counts: page.meta.counts,
      });
    } catch (e) {
      if (gen !== generation.current) return;
      if (silent) return;
      dispatch({ type: 'failed', error: errorCode(e) });
    }
    // The filters live in `latest`: the effect below restarts the list when they change.
  }, []);

  useEffect(() => {
    void loadFirst(false);
    // `key` stands for the filters: the object is rebuilt by the caller.
  }, [key, loadFirst]);

  const loadMore = useCallback(() => {
    const { state: s, filters: f } = latest.current;
    if (!s.hasMore || !s.cursor) return;
    const gen = generation.current;
    inboxApi
      .conversations(f, s.cursor)
      .then((page) => {
        if (gen !== generation.current) return;
        dispatch({
          type: 'more',
          rows: page.data,
          cursor: page.page.nextCursor,
          hasMore: page.page.hasMore,
          counts: page.meta.counts,
        });
      })
      .catch(() => {
        if (gen === generation.current) dispatch({ type: 'moreFailed' });
      });
  }, []);

  // --- counts ---
  const countsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshCounts = useCallback(() => {
    if (countsTimer.current) clearTimeout(countsTimer.current);
    countsTimer.current = setTimeout(() => {
      // The badges count the filters on screen. An answer for filters that have since changed is dropped: the reload of those
      // filters brings its own counts.
      const asked = latest.current.filters;
      const askedKey = filtersKey(asked);
      inboxApi
        .counts(asked)
        .then((counts) => {
          if (filtersKey(latest.current.filters) === askedKey) dispatch({ type: 'counts', counts });
        })
        .catch(() => undefined);
    }, COUNTS_DEBOUNCE_MS);
  }, []);

  // --- rows named by signals ---
  const wanted = useRef(new Map<string, number>());
  const rowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRows = useCallback(() => {
    const ids = [...wanted.current.keys()];
    wanted.current.clear();
    for (const id of ids) {
      inboxApi
        .conversation(id)
        .then((row) =>
          dispatch({
            type: 'upsert',
            row,
            filters: latest.current.filters,
            meId: latest.current.meId,
          }),
        )
        .catch((e) => {
          // Gone, or no longer visible to this person: it leaves the list.
          if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
            dispatch({ type: 'remove', id });
          }
        });
    }
    refreshCounts();
  }, [refreshCounts]);

  const signalRow = useCallback(
    (id: string, rowVersion: number | null) => {
      const held = latest.current.state.rows.find((r) => r.id === id);
      // Already holding that version (or a newer one): nothing to learn.
      if (held && rowVersion !== null && held.rowVersion >= rowVersion) {
        refreshCounts();
        return;
      }
      wanted.current.set(id, rowVersion ?? 0);
      if (rowTimer.current) clearTimeout(rowTimer.current);
      rowTimer.current = setTimeout(flushRows, ROW_DEBOUNCE_MS);
    },
    [flushRows, refreshCounts],
  );

  useRealtimeEvent('inbox.conversation.upsert', (e) =>
    signalRow(e.payload.conversationId, e.payload.rowVersion),
  );
  useRealtimeEvent('inbox.message.new', (e) => signalRow(e.payload.conversationId, null));
  useRealtimeEvent('inbox.assignment', (e) => signalRow(e.payload.conversationId, null));
  useRealtimeEvent('inbox.unread', (e) => {
    dispatch({ type: 'unread', id: e.payload.conversationId, unread: e.payload.unread });
    refreshCounts();
  });

  // An import of a number's chats ended (one hint per run): the imported threads now exist, so the list is read again.
  useRealtimeEvent(REALTIME_EVENT.historyImported, () => void loadFirst(true));

  useResync(() => void loadFirst(true), ['user']);

  // The safety poll, only while the tab is visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshCounts();
    }, COUNTS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshCounts]);

  useEffect(
    () => () => {
      if (countsTimer.current) clearTimeout(countsTimer.current);
      if (rowTimer.current) clearTimeout(rowTimer.current);
    },
    [],
  );

  const placeRow = useCallback(
    (row: ConversationSummary) =>
      dispatch({ type: 'upsert', row, filters: latest.current.filters, meId: latest.current.meId }),
    [],
  );
  const setUnread = useCallback(
    (id: string, unread: number) => {
      dispatch({ type: 'unread', id, unread });
      // The tab badges follow: the server recounts after the read.
      refreshCounts();
    },
    [refreshCounts],
  );

  return {
    state,
    loadMore,
    refresh: () => void loadFirst(true),
    placeRow,
    setUnread,
    refreshCounts,
  };
}
