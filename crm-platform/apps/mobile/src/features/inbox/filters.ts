import type { InboxTab } from '@crm/contracts';

/** `default` is the list the web shows first: open and pending threads together (no status sent to the API). */
export const STATUS_FILTERS = [
  'default',
  'open',
  'pending',
  'snoozed',
  'resolved',
  'closed',
  'all',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const TABS: readonly InboxTab[] = ['all', 'mine', 'unassigned', 'unread'];

export interface InboxFilters {
  tab: InboxTab;
  status: StatusFilter;
  /** The words typed in the search box, already debounced. */
  q: string;
}

export const DEFAULT_FILTERS: InboxFilters = { tab: 'all', status: 'default', q: '' };

/** Whether the status or the search narrows the list (the tab is a view, not a filter). */
export const hasActiveFilter = (filters: InboxFilters): boolean =>
  filters.status !== 'default' || filters.q.trim() !== '';
