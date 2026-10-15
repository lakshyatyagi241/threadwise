import { normalizeMessage, type Normalized, type RawMessage } from './inbound-normalizer';
import type { HistoryBatch, HistoryChat, HistoryContact } from './history.port';

/**
 * The opt-in history import, socket side (TW-WAHIST). Pure functions: what to ask WhatsApp for when the socket is built, and how one
 * `messaging-history.set` event becomes bounded, filtered batches. No library import, so it is tested without Baileys.
 *
 * Verified in the installed library (baileys 6.7.24, Utils/validate-connection.js, Socket/chats.js, Utils/history.js):
 *  - the companion's registration payload carries `requireFullSync: config.syncFullHistory` and, when it is set with a Mac OS or Windows
 *    browser, a desktop web sub-platform. It is sent ONCE, while the QR is being scanned; WhatsApp then pushes history right after the link;
 *  - `shouldSyncHistoryMessage(notification)` decides on every connection whether a history notification is downloaded and emitted;
 *  - the event is `messaging-history.set { chats, contacts, messages, isLatest, progress, syncType }`.
 */

/** WhatsApp's `HistorySyncType` numbers (WAProto), named here so this file needs no library import. */
export const SYNC_TYPE = {
  INITIAL_BOOTSTRAP: 0,
  FULL: 2,
  RECENT: 3,
  PUSH_NAME: 4,
  ON_DEMAND: 6,
} as const;

export type HistoryImportChoice = 'none' | 'recent' | 'full';

export interface HistorySocketConfig {
  /** Asks WhatsApp for the full history when the companion registers (only meaningful at the first link). */
  syncFullHistory: boolean;
  /** Which history notifications are downloaded. Everything for a number that did not opt in stays off. */
  shouldSyncHistoryMessage: (notification: { syncType?: number | null }) => boolean;
}

/**
 * The socket settings for a device's choice. `none` is exactly what the engine always did (no sync, nothing downloaded). `recent` takes
 * the first-link chats (initial bootstrap, the recent chunks and the names); `full` also takes the older chunks, and asks for them.
 * `ON_DEMAND` is never taken: nothing here requests more history later.
 */
export function historySocketConfig(choice: HistoryImportChoice): HistorySocketConfig {
  if (choice === 'none') {
    return { syncFullHistory: false, shouldSyncHistoryMessage: () => false };
  }
  const wanted = new Set<number>([
    SYNC_TYPE.INITIAL_BOOTSTRAP,
    SYNC_TYPE.RECENT,
    SYNC_TYPE.PUSH_NAME,
    ...(choice === 'full' ? [SYNC_TYPE.FULL] : []),
  ]);
  return {
    syncFullHistory: choice === 'full',
    shouldSyncHistoryMessage: (n) => typeof n.syncType === 'number' && wanted.has(n.syncType),
  };
}

const SYNC_NAME: Record<number, HistoryBatch['syncType']> = {
  [SYNC_TYPE.INITIAL_BOOTSTRAP]: 'initial_bootstrap',
  [SYNC_TYPE.RECENT]: 'recent',
  [SYNC_TYPE.FULL]: 'full',
  [SYNC_TYPE.PUSH_NAME]: 'push_name',
  [SYNC_TYPE.ON_DEMAND]: 'on_demand',
};

/** The shape of `messaging-history.set` this file reads. */
export interface RawHistoryEvent {
  chats?: Array<{
    id?: string | null;
    name?: string | null;
    pnJid?: string | null;
    lidJid?: string | null;
  }>;
  contacts?: Array<{
    id?: string | null;
    jid?: string | null;
    lid?: string | null;
    name?: string | null;
    notify?: string | null;
  }>;
  messages?: RawMessage[];
  progress?: number | null;
  syncType?: number | null;
}

export interface HistoryReadOptions {
  now: Date;
  /** Messages older than this many days are left out. */
  windowDays: number;
  /** Most messages in one batch. */
  batchSize: number;
  /** The number's own digits: its own "message yourself" chat is not imported. */
  selfDigits: string;
}

const DAY_MS = 86_400_000;
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');
const user = (jid: string) => jid.split('@')[0]!.split(':')[0]!;
/** A person, a group or an anonymous id. Bots, lists, channels and status are not chats we import. */
const IMPORTABLE_JID = /@(s\.whatsapp\.net|lid|g\.us)$/;

/** Lowest sensible value of a progress figure. */
const clampProgress = (p: number | null | undefined): number | null =>
  typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null;

/**
 * One WhatsApp event as bounded batches. Messages that cannot be imported are counted in `skipped`;
 * only the slice that needs them (names, not rows to import). An event with nothing to import still gives one batch, for its progress.
 */
export function readHistoryEvent(ev: RawHistoryEvent, opts: HistoryReadOptions): HistoryBatch[] {
  const syncType = SYNC_NAME[ev.syncType ?? -1] ?? 'other';
  const progress = clampProgress(ev.progress);

  // An anonymous id that WhatsApp says belongs to a phone number: used to give a LID chat its number.
  const phoneOfLid = new Map<string, string>();
  const contacts: HistoryContact[] = [];
  for (const c of ev.contacts ?? []) {
    if (!c.id) continue;
    const phoneJid = c.jid && c.jid.endsWith('@s.whatsapp.net') ? c.jid : null;
    const lid = c.lid ?? (c.id.endsWith('@lid') ? c.id : null);
    if (phoneJid && lid) phoneOfLid.set(user(lid), digits(user(phoneJid)));
    contacts.push({
      jid: c.id,
      phoneJid,
      name: c.name?.trim() || null,
      notify: c.notify?.trim() || null,
    });
  }
  const chats: HistoryChat[] = [];
  for (const c of ev.chats ?? []) {
    if (!c.id || !IMPORTABLE_JID.test(c.id)) continue;
    if (c.pnJid && c.id.endsWith('@lid')) phoneOfLid.set(user(c.id), digits(user(c.pnJid)));
    chats.push({ jid: c.id, name: c.name?.trim() || null });
  }

  const maxAgeMs = opts.windowDays * DAY_MS;
  const kept: Array<{ n: Normalized; remote: string }> = [];
  let skipped = 0;
  for (const raw of ev.messages ?? []) {
    const remote = raw.key?.remoteJid ?? '';
    if (!IMPORTABLE_JID.test(remote)) {
      skipped++;
      continue;
    }
    const n = normalizeMessage(raw, 'history', opts.now, { maxAgeMs });
    // A reaction needs the message it answers to be stored first; history arrives in no useful order, so it is left out.
    if (!n || n.message.reaction) {
      skipped++;
      continue;
    }
    const chat = n.message.chat;
    if (!chat.isGroup && !chat.phone && chat.lid) {
      const phone = phoneOfLid.get(chat.lid);
      if (phone) {
        n.message.chat = { ...chat, phone, jid: `${phone}@s.whatsapp.net` };
      }
    }
    // The number's own chat is not a conversation with anybody.
    if (!n.message.chat.isGroup && opts.selfDigits && n.message.chat.phone === opts.selfDigits) {
      skipped++;
      continue;
    }
    // Newer than now (a skewed clock) is not history.
    if (n.message.timestamp.getTime() > opts.now.getTime() + DAY_MS) {
      skipped++;
      continue;
    }
    kept.push({ n, remote });
  }

  const size = Math.max(1, opts.batchSize);
  if (kept.length === 0) {
    // Names without messages import nothing; the batch still carries the progress figure.
    return [{ syncType, progress, chats: [], contacts: [], messages: [], skipped, last: true }];
  }
  const out: HistoryBatch[] = [];
  for (let i = 0; i < kept.length; i += size) {
    const slice = kept.slice(i, i + size);
    const remotes = new Set(slice.map((k) => k.remote));
    const lids = new Set([...remotes].filter((r) => r.endsWith('@lid')).map(user));
    out.push({
      syncType,
      progress,
      // Only the names this slice needs: a batch stays small however many chats the event carried.
      chats: chats.filter((c) => remotes.has(c.jid)),
      contacts: contacts.filter(
        (c) =>
          remotes.has(c.jid) ||
          (c.phoneJid !== null && remotes.has(c.phoneJid)) ||
          lids.has(user(c.jid)),
      ),
      messages: slice.map((k) => k.n),
      skipped: i === 0 ? skipped : 0,
      last: i + size >= kept.length,
    });
  }
  return out;
}
