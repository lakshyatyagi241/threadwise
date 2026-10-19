import type { InboxTab } from '@crm/contracts';

/** `default` is the list the web shows first: the open threads (no status sent to the API). */
export const STATUS_FILTERS = ['default', 'snoozed', 'resolved', 'closed', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

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
}

export const DEFAULT_FILTERS: InboxFilters = {
  tab: 'all',
  status: 'default',
  q: '',
  channelId: '',
  labels: [],
  archived: false,
};

/** Whether anything narrows the list besides the tab (the tab is a view, not a filter). */
export const hasActiveFilter = (filters: InboxFilters): boolean =>
  filters.status !== 'default' ||
  filters.q.trim() !== '' ||
  filters.channelId !== '' ||
  filters.labels.length > 0 ||
  filters.archived;
