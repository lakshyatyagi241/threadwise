'use client';

import { useMemo } from 'react';
import { contactActivityResponseSchema } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useContactConsent } from '@/features/contact-consent';
import { useTasksList } from '@/features/tasks';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { useContactConversations } from '../../../api/conversations';
import { useFieldHistory } from '../../../api/field-history';
import { useContactMeetings } from '../../../api/meetings';
import { useContactNotes } from '../../../api/notes';
import type { ContactRow } from '../../../api/schemas';
import { useContactCalls } from '../../../api/stats';
import {
  fromActivity,
  fromConsentEvent,
  fromConversation,
  fromFieldHistory,
  fromMeeting,
  fromNote,
  fromTask,
  fromWhatsappCall,
  mergeFeed,
  sourcesFor,
  visibleEntries,
  type FeedSource,
  type TimelineEntry,
  type TimelineFilter,
  type TimelineSource,
} from '../../../lib/timeline';

export interface TimelineFeed {
  /** Open tasks and meetings still to come (already through the pill and the search). */
  upNext: TimelineEntry[];
  /** The dated entries, newest first. */
  dated: TimelineEntry[];
  /** The first read of the sources the pill needs is not finished. */
  loading: boolean;
  /** Every source the pill needs failed. */
  failed: boolean;
  /** The first error, for the error line. */
  error: unknown;
  /** Some (not all) of the sources failed: the rest is shown with a note. */
  partial: boolean;
  /** Nothing at all exists for the contact in the sources the pill needs (before the search is applied). */
  empty: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

interface SourceState {
  enabled: boolean;
  pending: boolean;
  error: boolean;
  fetchingMore: boolean;
  more?: () => void;
  retry: () => void;
}

/**
 * The contact's timeline: every source the pill needs, read in parallel, each with its own cursor, merged into one list by
 * `mergeFeed`. A pill reads only its own sources, so "Notes" is one request and a source the person has no permission for is left out.
 * The queries are the ones the notes, tasks, meetings, conversations, calls and field-history sections use, so opening one of them
 * costs nothing extra and a change made in one shows here.
 */
export function useTimelineFeed(
  contact: ContactRow,
  filter: TimelineFilter,
  query: string,
): TimelineFeed {
  const id = contact.id;
  const canRead = useCan('record.contacts.read');
  const canTasks = useCan('record.tasks.read');
  const canConversations = useCan('inbox.conversation.read');
  const canCalls = useCan('call.logs.read');
  const canConsent = useCan('contacts.consent.read');
  const want = sourcesFor(filter);
  const on = (s: TimelineSource, allowed = true) => want.has(s) && allowed;

  const activities = useCursorList(
    ['cat', 'activities', id],
    `/contacts/${id}/activities`,
    contactActivityResponseSchema,
    {},
    { enabled: on('activities', canRead) },
  );
  const notes = useContactNotes(id, on('notes', canRead));
  const tasksOpen = useTasksList(
    { kind: 'contact', id },
    { status: 'open' },
    { limit: 50, enabled: on('tasksOpen', canTasks) },
  );
  const tasksDone = useTasksList(
    { kind: 'contact', id },
    { status: 'done', sort: 'completed' },
    { limit: 25, enabled: on('tasksDone', canTasks) },
  );
  const meetings = useContactMeetings(id, on('meetings', canRead));
  const conversations = useContactConversations(contact, on('conversations', canConversations));
  const calls = useContactCalls(contact, on('whatsappCalls', canCalls));
  const history = useFieldHistory(id, on('fieldHistory', canRead));
  const consent = useContactConsent(id, on('consent', canConsent));

  const now = useMemo(() => new Date(), []);

  const sources = useMemo<FeedSource[]>(
    () => [
      {
        id: 'activities',
        entries: activities.items.map(fromActivity),
        hasMore: activities.hasNextPage,
      },
      { id: 'notes', entries: notes.items.map(fromNote), hasMore: notes.hasNextPage },
      {
        id: 'tasksOpen',
        entries: tasksOpen.items.map(fromTask),
        hasMore: tasksOpen.hasNextPage,
      },
      {
        id: 'tasksDone',
        entries: tasksDone.items.map(fromTask),
        hasMore: tasksDone.hasNextPage,
      },
      {
        id: 'meetings',
        entries: meetings.items.map((m) => fromMeeting(m, now)),
        hasMore: meetings.hasNextPage,
      },
      {
        id: 'conversations',
        entries: conversations.items.map(fromConversation),
        hasMore: false,
      },
      { id: 'whatsappCalls', entries: calls.rows.map(fromWhatsappCall), hasMore: false },
      {
        id: 'fieldHistory',
        entries: fromFieldHistory(history.items),
        hasMore: history.hasNextPage,
      },
      {
        id: 'consent',
        entries: (consent.data?.events ?? []).map(fromConsentEvent),
        hasMore: false,
      },
    ],
    [
      activities.items,
      activities.hasNextPage,
      notes.items,
      notes.hasNextPage,
      tasksOpen.items,
      tasksOpen.hasNextPage,
      tasksDone.items,
      tasksDone.hasNextPage,
      meetings.items,
      meetings.hasNextPage,
      conversations.items,
      calls.rows,
      history.items,
      history.hasNextPage,
      consent.data,
      now,
    ],
  );

  // What each enabled source is doing, so loading, failing and "load more" can be told as one.
  const state: Record<TimelineSource, SourceState> = {
    activities: {
      enabled: on('activities', canRead),
      pending: activities.isPending && on('activities', canRead),
      error: activities.isError,
      fetchingMore: activities.isFetchingNextPage,
      more: () => void activities.fetchNextPage(),
      retry: () => void activities.refetch(),
    },
    notes: {
      enabled: on('notes', canRead),
      pending: notes.isPending && on('notes', canRead),
      error: notes.isError,
      fetchingMore: notes.isFetchingNextPage,
      more: () => void notes.fetchNextPage(),
      retry: () => void notes.refetch(),
    },
    tasksOpen: {
      enabled: on('tasksOpen', canTasks),
      pending: tasksOpen.isPending && on('tasksOpen', canTasks),
      // A plan without tasks answers 422: the source is simply absent, not an error to show.
      error: false,
      fetchingMore: tasksOpen.isFetchingNextPage,
      more: () => void tasksOpen.fetchNextPage(),
      retry: () => void tasksOpen.refetch(),
    },
    tasksDone: {
      enabled: on('tasksDone', canTasks),
      pending: tasksDone.isPending && on('tasksDone', canTasks),
      error: false,
      fetchingMore: tasksDone.isFetchingNextPage,
      more: () => void tasksDone.fetchNextPage(),
      retry: () => void tasksDone.refetch(),
    },
    meetings: {
      enabled: on('meetings', canRead),
      pending: meetings.isPending && on('meetings', canRead),
      error: meetings.isError,
      fetchingMore: meetings.isFetchingNextPage,
      more: () => void meetings.fetchNextPage(),
      retry: () => void meetings.refetch(),
    },
    conversations: {
      enabled: on('conversations', canConversations),
      pending: conversations.isPending,
      error: false,
      fetchingMore: false,
      retry: () => void conversations.refetch(),
    },
    whatsappCalls: {
      enabled: on('whatsappCalls', canCalls),
      pending: calls.isPending,
      // A plan without calling answers 402/422: the source is absent, not an error to show.
      error: false,
      fetchingMore: false,
      retry: () => undefined,
    },
    fieldHistory: {
      enabled: on('fieldHistory', canRead),
      pending: history.isPending && on('fieldHistory', canRead),
      error: history.isError,
      fetchingMore: history.isFetchingNextPage,
      more: () => void history.fetchNextPage(),
      retry: () => void history.refetch(),
    },
    consent: {
      enabled: on('consent', canConsent),
      pending: consent.isPending && on('consent', canConsent),
      error: false,
      fetchingMore: false,
      retry: () => void consent.refetch(),
    },
  };

  const enabled = (Object.keys(state) as TimelineSource[]).filter((s) => state[s].enabled);
  const feed = useMemo(
    () => mergeFeed(sources.filter((s) => sourcesFor(filter).has(s.id))),
    [sources, filter],
  );
  const failedSources = enabled.filter((s) => state[s].error);
  const loading = enabled.some((s) => state[s].pending);
  const failed = enabled.length > 0 && failedSources.length === enabled.length;

  const anything = useMemo(
    () =>
      sources
        .filter((s) => sourcesFor(filter).has(s.id))
        .some((s) => s.entries.length > 0 || s.hasMore),
    [sources, filter],
  );

  return {
    upNext: visibleEntries(feed.upNext, filter, query),
    dated: visibleEntries(feed.dated, filter, query),
    loading,
    failed,
    error: activities.error ?? notes.error ?? meetings.error ?? history.error ?? null,
    partial: failedSources.length > 0 && !failed,
    empty: !loading && !anything,
    canLoadMore: feed.canLoadMore,
    loadingMore: enabled.some((s) => state[s].fetchingMore),
    loadMore: () => {
      for (const s of feed.next) state[s].more?.();
    },
    retry: () => {
      for (const s of failedSources) state[s].retry();
    },
  };
}
