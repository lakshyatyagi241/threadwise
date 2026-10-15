/**
 * What the socket tells the runtime about a number's first-link history (TW-WAHIST): normalized, no library types. Kept apart from
 * `inbound.port.ts` because a batch carries `Normalized` messages, and the normalizer itself reads `inbound.port.ts`.
 */
import type { Normalized } from './inbound-normalizer';

/** One chat of a history sync: its id and the name WhatsApp keeps for it (a group's subject, the saved name of a person). */
export interface HistoryChat {
  jid: string;
  name: string | null;
}

/** A name WhatsApp knows for an id: `name` is the one saved on the phone, `notify` the one the person chose. */
export interface HistoryContact {
  jid: string;
  /** The phone-number id (`...@s.whatsapp.net`) when `jid` is an anonymous id and WhatsApp said which number it is. */
  phoneJid: string | null;
  name: string | null;
  notify: string | null;
}

/**
 * A bounded slice of the history WhatsApp sends right after a first link (`messaging-history.set`). The socket adapter has already read
 * the messages, dropped what must never be imported (status, newsletters, broadcast lists, the number's own chat, replays outside the
 * window, reactions) and cut the event into slices of at most `batchSize` messages, delivered one after another (the next slice is not
 * read until this one was taken). `last` marks the final slice of one WhatsApp event.
 */
export interface HistoryBatch {
  /** WhatsApp's sync type, by name. */
  syncType: 'initial_bootstrap' | 'recent' | 'full' | 'push_name' | 'on_demand' | 'other';
  /** WhatsApp's own progress figure for the whole sync, 0 to 100. */
  progress: number | null;
  chats: HistoryChat[];
  contacts: HistoryContact[];
  messages: Normalized[];
  /** Messages in the event the adapter left out (outside the window, not importable). */
  skipped: number;
  last: boolean;
  /** Set instead of messages when the adapter cannot do its job (no limits provider): the importer fails the run with a code. */
  error?: 'limits_unavailable';
}
