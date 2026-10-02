import type { ConversationStatus, ConversationSummary, InboxCounts, InboxTab } from '@crm/contracts';

/**
 * The conversation list as a pure reducer: what is loaded, how a row that changed over a socket is placed, and which tab a row
 * belongs to. The server is the authority (scope, row-level security); this only keeps the rows already on screen in the order
 * and the tab the server would have given them.
 */

export interface ListFilters {
  tab: InboxTab;
  /** `open` is the server's default view (open and pending). */
  status: 'open' | ConversationStatus | 'all';
  channelId: string | null;
  /** The trimmed search text. */
  q: string;
  archived: boolean;
}

export const DEFAULT_FILTERS: ListFilters = {
  tab: 'all',
  status: 'open',
  channelId: null,
  q: '',
  archived: false,
};

export const EMPTY_COUNTS: InboxCounts = { all: 0, mine: 0, unassigned: 0, unread: 0, archived: 0 };

/** The query string of `GET /inbox/conversations` for a set of filters. */
export function listQuery(f: ListFilters): Record<string, string | boolean | undefined> {
  return {
    tab: f.tab,
    // The server's own default (open and pending) when the status is the default one.
    status: f.status === 'open' ? undefined : f.status,
    channelId: f.channelId ?? undefined,
    q: f.q || undefined,
    archived: f.archived || undefined,
  };
}

/** A stable identity for the filters, to restart the list when they change. */
export const filtersKey = (f: ListFilters) =>
  [f.tab, f.status, f.channelId ?? '', f.q, f.archived ? 1 : 0].join('|');

/** Whether any filter other than the tab is on (the empty state then says "nothing matches", not "nothing here yet"). */
export function isFiltered(f: ListFilters): boolean {
  return f.status !== 'open' || f.channelId !== null || f.q !== '' || f.archived;
}

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase();

/**
 * Whether a row belongs in the list for these filters, for deciding what to do with a row a socket event changed.
 * Search is approximate (the server also looks inside the preview); a row that was loaded for a search is kept unless it
 * clearly stopped matching.
 */
export function matchesFilters(
  row: ConversationSummary,
  f: ListFilters,
  meId: string | null,
): boolean {
  if (row.archived !== f.archived) return false;
  if (f.status === 'open') {
    if (row.status !== 'open' && row.status !== 'pending') return false;
  } else if (f.status !== 'all' && row.status !== f.status) return false;
  if (f.channelId && row.channel.id !== f.channelId) return false;
  switch (f.tab) {
    case 'mine':
      if (!meId || row.assignment.user?.id !== meId) return false;
      break;
    case 'unassigned':
      if (row.assignment.user) return false;
      break;
    case 'unread':
      if (row.unreadCount <= 0) return false;
      break;
    case 'all':
      break;
  }
  if (f.q) {
    const q = norm(f.q);
    const hay = [row.title, row.peerName, row.peerKey, row.preview, row.contact?.name].map(norm);
    if (!hay.some((h) => h.includes(q))) return false;
  }
  return true;
}

/** The server's order: pinned first, then the latest message, then the id (a stable tie-break). */
export function compareRows(a: ConversationSummary, b: ConversationSummary): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
  const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export interface ListState {
  rows: ConversationSummary[];
  cursor: string | null;
  hasMore: boolean;
  /** The first page has arrived (even if empty). */
  loaded: boolean;
  /** An error code of the first page; later pages report through the `moreError` flag. */
  error: string | null;
  moreError: boolean;
  counts: InboxCounts | null;
}

export const EMPTY_LIST: ListState = {
  rows: [],
  cursor: null,
  hasMore: false,
  loaded: false,
  error: null,
  moreError: false,
  counts: null,
};

export type ListAction =
  | { type: 'reset' }
  | { type: 'failed'; error: string }
  | {
      type: 'loaded';
      rows: ConversationSummary[];
      cursor: string | null;
      hasMore: boolean;
      counts: InboxCounts;
    }
  | {
      type: 'more';
      rows: ConversationSummary[];
      cursor: string | null;
      hasMore: boolean;
      counts: InboxCounts;
    }
  | { type: 'moreFailed' }
  /** A row the server just told us about (a socket signal, then a fetch of that one row). */
  | { type: 'upsert'; row: ConversationSummary; filters: ListFilters; meId: string | null }
  | { type: 'remove'; id: string }
  | { type: 'unread'; id: string; unread: number }
  | { type: 'counts'; counts: InboxCounts };

/** Adds or replaces `row`, keeping the order. A row older than every loaded one is left for "load more" while more exist. */
export function placeRow(state: ListState, row: ConversationSummary): ConversationSummary[] {
  const at = state.rows.findIndex((r) => r.id === row.id);
  if (at >= 0) {
    const current = state.rows[at]!;
    // An answer older than what is on screen (a slow fetch overtaken by a newer event) must not win.
    if (row.rowVersion < current.rowVersion) return state.rows;
    const next = state.rows.slice();
    next[at] = row;
    return next.sort(compareRows);
  }
  const last = state.rows[state.rows.length - 1];
  if (state.hasMore && last && compareRows(row, last) > 0) return state.rows;
  return [...state.rows, row].sort(compareRows);
}

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case 'reset':
      return EMPTY_LIST;
    case 'failed':
      return { ...state, error: action.error, loaded: true };
    case 'loaded':
      return {
        rows: action.rows,
        cursor: action.cursor,
        hasMore: action.hasMore,
        loaded: true,
        error: null,
        moreError: false,
        counts: action.counts,
      };
    case 'more': {
      const have = new Set(state.rows.map((r) => r.id));
      return {
        ...state,
        rows: [...state.rows, ...action.rows.filter((r) => !have.has(r.id))],
        cursor: action.cursor,
        hasMore: action.hasMore,
        moreError: false,
        counts: action.counts,
      };
    }
    case 'moreFailed':
      return { ...state, moreError: true };
    case 'upsert': {
      if (!matchesFilters(action.row, action.filters, action.meId)) {
        return state.rows.some((r) => r.id === action.row.id)
          ? { ...state, rows: state.rows.filter((r) => r.id !== action.row.id) }
          : state;
      }
      const rows = placeRow(state, action.row);
      return rows === state.rows ? state : { ...state, rows };
    }
    case 'remove':
      return { ...state, rows: state.rows.filter((r) => r.id !== action.id) };
    case 'unread':
      return {
        ...state,
        rows: state.rows.map((r) => (r.id === action.id ? { ...r, unreadCount: action.unread } : r)),
      };
    case 'counts':
      return { ...state, counts: action.counts };
  }
}

/** A tab's badge number: the server's count, never below zero; null before the first answer. */
export function tabCount(counts: InboxCounts | null, tab: InboxTab): number | null {
  return counts ? Math.max(0, counts[tab]) : null;
}

/** `99+` for the unread badge of a row. */
export function badgeText(n: number): string {
  return n > 99 ? '99+' : String(n);
}
