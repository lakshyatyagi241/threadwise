import type { InboxTab } from '@crm/contracts';

/** `default` is the list the web shows first: the open threads (no status sent to the API). */
export const STATUS_FILTERS = ['default', 'snoozed', 'resolved', 'closed', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** The order of the list: `recent` is the web's default (pinned first, then the newest activity); `old` is the oldest activity first. */
export const SORTS = ['recent', 'old'] as const;
export type SortFilter = (typeof SORTS)[number];

/** The most ids one request may name for agents, channels or labels (the API refuses a longer list). */
export const FILTER_IDS_MAX = 20;

export const TABS: readonly InboxTab[] = ['all', 'mine', 'unassigned', 'unread'];

export interface InboxFilters {
  tab: InboxTab;
  status: StatusFilter;
  /** The words typed in the search box, already debounced. */
  q: string;
  /** Only the conversations on this channel (its id); empty: every channel. */
  channelId: string;
  /** Only the conversations that carry any of these labels (their ids). */
  labels: readonly string[];
  /** The archive view: every archived conversation, whatever the tab or status. */
  archived: boolean;
  /** Only the conversations assigned to any of these agents (their user ids). */
  agentIds: readonly string[];
  sort: SortFilter;
}

export const DEFAULT_FILTERS: InboxFilters = {
  tab: 'all',
  status: 'default',
  q: '',
  channelId: '',
  labels: [],
  archived: false,
  agentIds: [],
  sort: 'recent',
};

/** Whether anything narrows the list besides the tab (the tab is a view, not a filter). */
export const hasActiveFilter = (filters: InboxFilters): boolean =>
  filters.status !== 'default' ||
  filters.q.trim() !== '' ||
  filters.channelId !== '' ||
  filters.labels.length > 0 ||
  filters.archived ||
  filters.agentIds.length > 0 ||
  filters.sort !== 'recent';
