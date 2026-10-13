import {
  canAdvanceMessageStatus,
  type ConversationNote,
  type EmailReplyExtras,
  type MessageResponse,
  type MessageStatus,
  type WaGroupMention,
} from '@crm/contracts';
import { dayKey } from './time';

/**
 * One thread as a pure reducer. Messages are ordered by `seq` (gap-free, assigned by the server under the conversation lock),
 * a send in flight is a `PendingSend` that is swapped for the stored message the moment one with its `clientMessageId` appears
 * (from the 202 answer, a socket event or a refetch, whichever comes first), and a status only moves forward.
 */

export interface PendingSend {
  /** Also the Idempotency-Key: the same send repeated can never post twice. */
  clientMessageId: string;
  kind: 'text' | 'media';
  body: string;
  /** The message this send answers (its `id`), or null. */
  replyToMessageId?: string | null;
  /** Email conversations: cc, bcc and subject of the reply, kept so a retry sends them again. */
  email?: EmailReplyExtras;
  /** Personal-number group text: the members @mentioned in `body` (kept so a retry sends them again). */
  mentions?: WaGroupMention[];
  /** For a media send: what the bubble shows while it goes. */
  media: { mediaId: string; name: string; mime: string; sizeBytes: number | null } | null;
  /** `sending` until the server answered; `failed` when the request itself was refused or never arrived. */
  status: 'sending' | 'failed';
  /** An error code the screen turns into a sentence. */
  error: string | null;
  /** Seconds to wait before trying again, when the refusal said so (an email rate limit). */
  retryAfterS?: number;
  createdAt: string;
}

export interface ThreadState {
  conversationId: string | null;
  /** Ascending by seq, unique by id. */
  messages: MessageResponse[];
  pending: PendingSend[];
  /** There are older messages than the first one held. */
  hasMoreBefore: boolean;
  loaded: boolean;
  error: string | null;
}

export const EMPTY_THREAD: ThreadState = {
  conversationId: null,
  messages: [],
  pending: [],
  hasMoreBefore: false,
  loaded: false,
  error: null,
};

export type ThreadAction =
  | { type: 'reset'; conversationId: string | null }
  | { type: 'loadFailed'; error: string }
  | { type: 'loaded'; messages: MessageResponse[]; hasMoreBefore: boolean }
  | { type: 'older'; messages: MessageResponse[]; hasMoreBefore: boolean }
  /** Newer messages: a socket event, a gap fill, the answer to a send. Merged by id; statuses never step back. */
  | { type: 'merge'; messages: MessageResponse[] }
  | {
      type: 'status';
      messageId: string;
      clientMessageId: string | null;
      status: MessageStatus;
      at: string;
    }
  | { type: 'send'; pending: PendingSend }
  | { type: 'sendFailed'; clientMessageId: string; error: string; retryAfterS?: number }
  | { type: 'sendRetry'; clientMessageId: string }
  | { type: 'dismiss'; clientMessageId: string };

const STATUS_FIELD: Partial<Record<MessageStatus, 'sentAt' | 'deliveredAt' | 'readAt'>> = {
  sent: 'sentAt',
  delivered: 'deliveredAt',
  read: 'readAt',
};

/**
 * Which copy of one message wins. A fresher read of a message that is further along (a refetch that raced a receipt) must not
 * move its ticks back, and a retry (`failed` then `queued` again) is the only way out of `failed`.
 */
export function pickMessage(old: MessageResponse, incoming: MessageResponse): MessageResponse {
  if (old.status === incoming.status) return incoming;
  if (old.status === 'failed' && incoming.status === 'queued') return incoming;
  if (canAdvanceMessageStatus(old.status, incoming.status)) return incoming;
  // The incoming copy is behind: keep what is further along, take the rest (an edit, a translation).
  return {
    ...incoming,
    status: old.status,
    failure: old.failure,
    sentAt: old.sentAt,
    deliveredAt: old.deliveredAt,
    readAt: old.readAt,
  };
}

/** A realtime copy of a template message carries no preview (only a thread read does): keep the one already held. */
function withKnownPreview(old: MessageResponse, next: MessageResponse): MessageResponse {
  const preview = old.template?.preview;
  if (!preview || !next.template || next.template.preview) return next;
  return { ...next, template: { ...next.template, preview } };
}

/** Adds messages that are not held yet, replaces those that are, and orders by seq. */
export function mergeMessages(
  existing: MessageResponse[],
  incoming: MessageResponse[],
): MessageResponse[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    const old = byId.get(m.id);
    byId.set(m.id, old ? withKnownPreview(old, pickMessage(old, m)) : m);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Sends that now exist as stored messages are no longer pending. */
export function reconcilePending(
  pending: PendingSend[],
  messages: MessageResponse[],
): PendingSend[] {
  if (pending.length === 0) return pending;
  const stored = new Set(
    messages.map((m) => m.clientMessageId).filter((id): id is string => id !== null),
  );
  const next = pending.filter((p) => !stored.has(p.clientMessageId));
  return next.length === pending.length ? pending : next;
}

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case 'reset':
      return { ...EMPTY_THREAD, conversationId: action.conversationId };
    case 'loadFailed':
      return { ...state, error: action.error, loaded: true };
    case 'loaded': {
      const messages = mergeMessages([], action.messages);
      return {
        ...state,
        messages,
        hasMoreBefore: action.hasMoreBefore,
        loaded: true,
        error: null,
        pending: reconcilePending(state.pending, messages),
      };
    }
    case 'older':
      return {
        ...state,
        messages: mergeMessages(state.messages, action.messages),
        hasMoreBefore: action.hasMoreBefore,
      };
    case 'merge': {
      const messages = mergeMessages(state.messages, action.messages);
      return { ...state, messages, pending: reconcilePending(state.pending, messages) };
    }
    case 'status': {
      const at = state.messages.findIndex(
        (m) =>
          m.id === action.messageId ||
          (action.clientMessageId !== null && m.clientMessageId === action.clientMessageId),
      );
      if (at < 0) return state;
      const m = state.messages[at]!;
      // `queued` is also what a retry sets again: allowed out of `failed` only.
      const ok =
        canAdvanceMessageStatus(m.status, action.status) ||
        (m.status === 'failed' && action.status === 'queued');
      if (!ok) return state;
      const field = STATUS_FIELD[action.status];
      const next: MessageResponse = {
        ...m,
        status: action.status,
        ...(field && !m[field] ? { [field]: action.at } : {}),
        ...(action.status === 'failed' ? {} : { failure: null }),
      };
      const messages = state.messages.slice();
      messages[at] = next;
      return { ...state, messages };
    }
    case 'send': {
      // The same send again (its upload finished, a retry) replaces its entry where it stands.
      const at = state.pending.findIndex(
        (p) => p.clientMessageId === action.pending.clientMessageId,
      );
      if (at < 0) return { ...state, pending: [...state.pending, action.pending] };
      const pending = state.pending.slice();
      pending[at] = action.pending;
      return { ...state, pending };
    }
    case 'sendFailed':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.clientMessageId === action.clientMessageId
            ? {
                ...p,
                status: 'failed',
                error: action.error,
                ...(action.retryAfterS !== undefined ? { retryAfterS: action.retryAfterS } : {}),
              }
            : p,
        ),
      };
    case 'sendRetry':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.clientMessageId === action.clientMessageId
            ? { ...p, status: 'sending', error: null }
            : p,
        ),
      };
    case 'dismiss':
      return {
        ...state,
        pending: state.pending.filter((p) => p.clientMessageId !== action.clientMessageId),
      };
  }
}

/** The highest seq held, 0 for an empty thread. */
export function lastSeq(messages: MessageResponse[]): number {
  return messages.length ? messages[messages.length - 1]!.seq : 0;
}

/** The lowest seq held, or null. */
export function firstSeq(messages: MessageResponse[]): number | null {
  return messages.length ? messages[0]!.seq : null;
}

/** A message with this seq would leave a hole after what is held: fetch what is between first. */
export function hasGap(held: MessageResponse[], incomingSeq: number): boolean {
  return held.length > 0 && incomingSeq > lastSeq(held) + 1;
}

// --- reactions the team sent --------------------------------------------------------------------------------------------

/** What an agent put on a message: the emoji, and how far its send got (a refused one is shown as such, never hidden). */
export interface AgentReaction {
  emoji: string;
  /** The reaction message's own id: Retry works on it like on any failed send. */
  messageId: string;
  status: MessageStatus;
}

/** A reaction we sent is stored as an outbound message of kind `reaction` (customers' reactions never are). */
export function isAgentReaction(m: MessageResponse): boolean {
  return m.kind === 'reaction' && m.direction === 'out';
}

/**
 * The reaction on each message, by the message's id: the latest one sent for it wins, and an empty one (taken back) clears it.
 * Messages are in `seq` order, so the last write is the newest.
 */
export function agentReactions(messages: MessageResponse[]): Map<string, AgentReaction> {
  const out = new Map<string, AgentReaction>();
  for (const m of messages) {
    if (!isAgentReaction(m) || !m.replyToMessageId) continue;
    const emoji = m.body?.trim() ?? '';
    // A refused "take it back" leaves the reaction where it was.
    if (emoji === '' && m.status === 'failed') continue;
    if (emoji === '') out.delete(m.replyToMessageId);
    else out.set(m.replyToMessageId, { emoji, messageId: m.id, status: m.status });
  }
  return out;
}

// --- what the thread draws ------------------------------------------------------------------------------------------------

export type ThreadItem =
  | { kind: 'day'; key: string; at: string }
  | { kind: 'message'; key: string; message: MessageResponse }
  | { kind: 'note'; key: string; note: ConversationNote }
  | { kind: 'pending'; key: string; pending: PendingSend };

/**
 * The thread in reading order: stored messages by seq with internal notes slotted in by time, then the sends in flight, with a
 * day separator before the first item of each calendar day. Notes older than the oldest message held are left out while older
 * history remains to be loaded (they appear in place once it is), so the top of the thread never shows a note stranded from its
 * conversation. `timeZone` is the zone the person reads times in (day separators follow it).
 */
export function buildItems(
  messages: MessageResponse[],
  notes: ConversationNote[],
  pending: PendingSend[],
  hasMoreBefore: boolean,
  timeZone?: string,
): ThreadItem[] {
  const oldest = messages[0]?.createdAt ?? null;
  const visibleNotes = notes
    .filter((n) => !(hasMoreBefore && oldest && n.createdAt < oldest))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  const body: Array<{ at: string; item: ThreadItem }> = [];
  let n = 0;
  for (const message of messages) {
    // An agent's reaction is drawn on the message it reacts to, not as a bubble of its own.
    if (isAgentReaction(message)) continue;
    while (n < visibleNotes.length && visibleNotes[n]!.createdAt < message.createdAt) {
      const note = visibleNotes[n++]!;
      body.push({ at: note.createdAt, item: { kind: 'note', key: `n:${note.id}`, note } });
    }
    body.push({
      at: message.createdAt,
      item: { kind: 'message', key: `m:${message.id}`, message },
    });
  }
  while (n < visibleNotes.length) {
    const note = visibleNotes[n++]!;
    body.push({ at: note.createdAt, item: { kind: 'note', key: `n:${note.id}`, note } });
  }

  const out: ThreadItem[] = [];
  let day = '';
  const push = (at: string, item: ThreadItem) => {
    const k = dayKey(at, timeZone);
    if (k !== day) {
      day = k;
      out.push({ kind: 'day', key: `d:${k}`, at });
    }
    out.push(item);
  };
  for (const b of body) push(b.at, b.item);
  for (const p of pending) {
    push(p.createdAt, { kind: 'pending', key: `p:${p.clientMessageId}`, pending: p });
  }
  return out;
}
