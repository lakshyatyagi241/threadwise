import type { TchatMessageResponse } from '@crm/contracts';

/** A message the person sent that the server has not confirmed yet (or refused). */
export interface Pending {
  /** Also the Idempotency-Key: a retry of the same send can never post twice. */
  key: string;
  body: string;
  replyToId: string | null;
  file: { name: string; size: number } | null;
  status: 'sending' | 'failed';
  /** Upload progress, 0..100. */
  progress: number;
  /** A code the screen turns into a sentence (`TCHAT_REPLY_OTHER_CHANNEL`, `network`, ...). */
  error: string | null;
  createdAt: string;
}

export interface ThreadState {
  /** Confirmed messages, oldest first. */
  messages: TchatMessageResponse[];
  pending: Pending[];
  /** The cursor for older history, or null when the start has been reached. */
  olderCursor: string | null;
  loaded: boolean;
  /** Why the first load failed (an error code), or null. */
  error: string | null;
}

export const EMPTY_THREAD: ThreadState = {
  messages: [],
  pending: [],
  olderCursor: null,
  loaded: false,
  error: null,
};

export type ThreadAction =
  | { type: 'reset' }
  | { type: 'loadFailed'; error: string }
  | { type: 'loaded'; messages: TchatMessageResponse[]; olderCursor: string | null }
  /** The newest page again: refreshes edits, deletions and reactions inside it and keeps older history that is loaded. */
  | { type: 'refresh'; messages: TchatMessageResponse[]; olderCursor: string | null }
  | { type: 'append'; messages: TchatMessageResponse[] }
  | { type: 'older'; messages: TchatMessageResponse[]; olderCursor: string | null }
  | { type: 'patch'; message: TchatMessageResponse }
  | { type: 'remove'; id: string }
  | { type: 'send'; pending: Pending }
  | { type: 'progress'; key: string; progress: number }
  | { type: 'sent'; key: string; message: TchatMessageResponse }
  | { type: 'failed'; key: string; error: string }
  | { type: 'retry'; key: string }
  | { type: 'dismiss'; key: string };

/** Adds messages that are not there yet, keeping order; one with a known id replaces the old copy. */
export function mergeById(
  existing: TchatMessageResponse[],
  incoming: TchatMessageResponse[],
): TchatMessageResponse[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(incoming.map((m) => [m.id, m]));
  const out = existing.map((m) => byId.get(m.id) ?? m);
  const have = new Set(existing.map((m) => m.id));
  for (const m of incoming) if (!have.has(m.id)) out.push(m);
  return out;
}

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case 'reset':
      return EMPTY_THREAD;
    case 'loadFailed':
      return { ...state, error: action.error };
    case 'loaded':
      return { ...state, messages: action.messages, olderCursor: action.olderCursor, loaded: true };
    case 'refresh': {
      const first = action.messages[0];
      const at = first ? state.messages.findIndex((m) => m.id === first.id) : -1;
      // The window starts where the page starts; what the reader scrolled back to stays. A burst bigger than the page
      // (the first message is unknown) restarts from the page, with the page's own cursor.
      if (first && at >= 0) {
        return {
          ...state,
          messages: [...state.messages.slice(0, at), ...action.messages],
          loaded: true,
        };
      }
      return {
        ...state,
        messages: action.messages,
        olderCursor: action.olderCursor,
        loaded: true,
      };
    }
    case 'append':
      return { ...state, messages: mergeById(state.messages, action.messages) };
    case 'older':
      return {
        ...state,
        messages: [
          ...action.messages.filter((m) => !state.messages.some((x) => x.id === m.id)),
          ...state.messages,
        ],
        olderCursor: action.olderCursor,
      };
    case 'patch':
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.message.id ? action.message : m)),
      };
    case 'remove':
      return { ...state, messages: state.messages.filter((m) => m.id !== action.id) };
    case 'send':
      return { ...state, pending: [...state.pending, action.pending] };
    case 'progress':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.key === action.key ? { ...p, progress: action.progress } : p,
        ),
      };
    case 'sent':
      // The server copy may already be here (a poll can answer before the POST does): it is added once either way.
      return {
        ...state,
        messages: mergeById(state.messages, [action.message]),
        pending: state.pending.filter((p) => p.key !== action.key),
      };
    case 'failed':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.key === action.key ? { ...p, status: 'failed', error: action.error } : p,
        ),
      };
    case 'retry':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.key === action.key ? { ...p, status: 'sending', error: null, progress: 0 } : p,
        ),
      };
    case 'dismiss':
      return { ...state, pending: state.pending.filter((p) => p.key !== action.key) };
  }
}

/** The id the diff poll asks "after": the newest confirmed message. */
export function newestId(messages: TchatMessageResponse[]): string | null {
  return messages.length ? messages[messages.length - 1]!.id : null;
}

export interface DayGroup {
  key: string;
  at: string;
  messages: TchatMessageResponse[];
}

/** Messages grouped by local calendar day, for the separators. */
export function groupByDay(
  messages: TchatMessageResponse[],
  dayOf: (iso: string) => string,
): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const m of messages) {
    const key = dayOf(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.messages.push(m);
    else groups.push({ key, at: m.createdAt, messages: [m] });
  }
  return groups;
}
