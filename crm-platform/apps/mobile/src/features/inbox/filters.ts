import type { ConversationStatus, InboxTab } from '@crm/contracts';

/**
 * The statuses the Filters window offers, as on the web: Resolved stands for resolved and closed (the API lists both for it), and
 * Spam is offered so a conversation that was marked can be found. Nothing chosen shows the open conversations.
 */
export const STATUS_CHOICES = [
  'open',
  'snoozed',
  'resolved',
  'spam',
] as const satisfies readonly ConversationStatus[];
export type StatusChoice = (typeof STATUS_CHOICES)[number];

/** Who has the conversation (the web's "Conversation" choice); `''` is "Any". `unattended`: it has messages nobody has read yet. */
export const ASSIGNMENTS = ['assigned', 'unassigned', 'unattended'] as const;
export type AssignmentFilter = '' | (typeof ASSIGNMENTS)[number];

/** The order of the list: `recent` is the web's default (pinned first, then the newest activity); `old` is the oldest activity first. */
export const SORTS = ['recent', 'old'] as const;
export type SortFilter = (typeof SORTS)[number];

/** The most ids one request may name for agents, channels or labels (the API refuses a longer list). */
export const FILTER_IDS_MAX = 20;

export const TABS: readonly InboxTab[] = ['all', 'mine', 'unassigned', 'unread'];

export interface InboxFilters {
  tab: InboxTab;
  /** Only conversations in any of these statuses; empty: the open ones. */
  statuses: readonly StatusChoice[];
  assignment: AssignmentFilter;
  /** The words typed in the search box, already debounced. */
  q: string;
  /** Only the conversations on any of these channels (their ids); empty: every channel. */
  channelIds: readonly string[];
  /** Only the conversations that carry any of these labels (their ids). */
  labels: readonly string[];
  /** The archive view: every archived conversation, whatever the tab or status. */
  archived: boolean;
  /** Only the conversations assigned to any of these agents (their user ids). */
  agentIds: readonly string[];
  sort: SortFilter;
  /** The day of the last activity the list starts from and ends on (`YYYY-MM-DD`); `''`: no limit. */
  from: string;
  to: string;
}

export const DEFAULT_FILTERS: InboxFilters = {
  tab: 'all',
  statuses: [],
  assignment: '',
  q: '',
  channelIds: [],
  labels: [],
  archived: false,
  agentIds: [],
  sort: 'recent',
  from: '',
  to: '',
};

/** Whether anything narrows the list besides the tab (the tab is a view, not a filter). */
export const hasActiveFilter = (filters: InboxFilters): boolean =>
  filters.statuses.length > 0 ||
  filters.assignment !== '' ||
  filters.q.trim() !== '' ||
  filters.channelIds.length > 0 ||
  filters.labels.length > 0 ||
  filters.archived ||
  filters.agentIds.length > 0 ||
  filters.sort !== 'recent' ||
  filters.from !== '' ||
  filters.to !== '';
