import type {
  HistoryBatch,
  HistoryChat,
  HistoryContact,
  InboundMessage,
} from '../node-bridge-runtime';
import type { NormalisedInbound } from '../../infra/providers/chat-conversations';

/**
 * The pure rules of the history import (TW-WAHIST, docs/specs/personal-whatsapp-connect.md section 14): which messages of a batch may be
 * stored given the caps, how a message becomes an inbox message, and when a run is finished. Nothing here touches a database, Redis or
 * the library, so each rule is read and tested on its own.
 */

export interface RunCaps {
  maxMessages: number;
  maxMessagesPerChat: number;
  maxChats: number;
}

/** What the run has stored so far, from its row and its Redis tallies. */
export interface RunUsage {
  messages: number;
  /** Messages stored per thread key in this run. */
  perChat: ReadonlyMap<string, number>;
  /** Thread keys this run has already touched (a chat is counted once, against `maxChats`). */
  chats: ReadonlySet<string>;
}

/** One thread of a batch: its key, what to call it, and the messages to store oldest first. */
export interface ChatPlan {
  peerKey: string;
  isGroup: boolean;
  /** The person's number, when WhatsApp gave one: the only chats that get a contact. */
  phone: string | null;
  name: string | null;
  groupTitle: string | null;
  messages: InboundMessage[];
  /** True when this chat was seen for the first time in the run (counts against `maxChats`). */
  firstSeen: boolean;
}

export interface BatchPlan {
  chats: ChatPlan[];
  /** Messages left out by a cap (per chat, per number, or chats over the limit). */
  skippedByCap: number;
  /** Why the run should stop after this batch, when it should. */
  stop: null | 'message_cap_reached' | 'chat_cap_reached';
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');
const user = (jid: string) => jid.split('@')[0]!.split(':')[0]!;

/** The thread key of a message: the group id, the person's number, or (a person known only by an anonymous id) that id's digits. */
export function peerKeyOf(m: InboundMessage): string | null {
  if (m.chat.isGroup) {
    const id = user(m.chat.jid);
    return id || null;
  }
  return digits(m.chat.phone) || digits(m.chat.lid) || null;
}

/** The name to give a person's contact: the one saved on the phone, else the chat's name, else the one the person chose, else a push name. */
export function nameForChat(
  m: InboundMessage,
  chats: readonly HistoryChat[],
  contacts: readonly HistoryContact[],
): string | null {
  const jids = new Set([m.chat.jid, m.chat.phone ? `${m.chat.phone}@s.whatsapp.net` : '']);
  if (m.chat.lid) jids.add(`${m.chat.lid}@lid`);
  const contact = contacts.find(
    (c) => jids.has(c.jid) || (c.phoneJid !== null && jids.has(c.phoneJid)),
  );
  const chat = chats.find((c) => jids.has(c.jid));
  const named = contact?.name || chat?.name || contact?.notify || null;
  return named && named.trim() ? named.trim().slice(0, 191) : null;
}

/**
 * Splits a batch into threads and applies the caps. Per chat the NEWEST messages win the room that is left (a chat's quota is spent from
 * the newest back), then each chat's messages are returned oldest first so the thread's sequence is chronological. A chat over the chat
 * cap, and the messages over the number's cap, are counted in `skippedByCap` and stop the run: the person is told, nothing is cut silently.
 */
export function planBatch(
  batch: Pick<HistoryBatch, 'messages' | 'chats' | 'contacts'>,
  caps: RunCaps,
  usage: RunUsage,
): BatchPlan {
  const byChat = new Map<string, { first: InboundMessage; messages: InboundMessage[] }>();
  for (const n of batch.messages) {
    if (n.kind === 'echo' && n.message.chat.isGroup) continue; // never produced (groups are 'group'), kept for safety
    const key = peerKeyOf(n.message);
    if (!key) continue;
    const slot = byChat.get(key) ?? { first: n.message, messages: [] };
    slot.messages.push(n.message);
    byChat.set(key, slot);
  }

  let remaining = Math.max(0, caps.maxMessages - usage.messages);
  let newChats = 0;
  let skippedByCap = 0;
  let stop: BatchPlan['stop'] = null;
  const chats: ChatPlan[] = [];

  for (const [peerKey, slot] of byChat) {
    const firstSeen = !usage.chats.has(peerKey);
    if (firstSeen && usage.chats.size + newChats >= caps.maxChats) {
      skippedByCap += slot.messages.length;
      stop = stop ?? 'chat_cap_reached';
      continue;
    }
    const room = Math.min(
      remaining,
      Math.max(0, caps.maxMessagesPerChat - (usage.perChat.get(peerKey) ?? 0)),
    );
    const newestFirst = [...slot.messages].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
    const take = newestFirst.slice(0, room);
    skippedByCap += newestFirst.length - take.length;
    if (take.length === 0) continue;
    remaining -= take.length;
    if (firstSeen) newChats++;
    const m = slot.first;
    chats.push({
      peerKey,
      isGroup: m.chat.isGroup,
      phone: m.chat.isGroup ? null : digits(m.chat.phone) || null,
      name: m.chat.isGroup ? null : nameForChat(m, batch.chats, batch.contacts),
      groupTitle: m.chat.isGroup
        ? (batch.chats.find((c) => c.jid === m.chat.jid)?.name ?? null)
        : null,
      messages: take.reverse(),
      firstSeen,
    });
    if (remaining <= 0) stop = stop ?? 'message_cap_reached';
  }
  return { chats, skippedByCap, stop };
}

/** What a person sees in a thread for a file that was not brought in. */
const KIND_LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  document: 'Document',
  sticker: 'Sticker',
};

/**
 * One imported message as the inbox's ingest takes it. Media is never downloaded: the message keeps a placeholder (`[Photo]` plus its
 * caption) and says so in `meta.mediaOmitted`. `history.contact` is set only for a person's chat with a known number: a group never
 * gets a contact, and a person known only by an anonymous id has no number to make one from.
 */
export function toIngest(m: InboundMessage, plan: ChatPlan): NormalisedInbound {
  const base: NormalisedInbound = {
    providerMessageId: m.providerMessageId,
    peerKey: plan.peerKey,
    kind: 'text',
    providerTimestamp: m.timestamp,
    ...(plan.isGroup
      ? {}
      : plan.name
        ? { peerName: plan.name }
        : m.pushName && !m.fromMe
          ? { peerName: m.pushName }
          : {}),
    ...(m.replyToProviderMessageId ? { replyToProviderMessageId: m.replyToProviderMessageId } : {}),
    history: {
      direction: m.fromMe ? 'out' : 'in',
      ...(!plan.isGroup && plan.phone ? { contact: true } : {}),
    },
  };
  const meta: Record<string, unknown> = {};
  if (m.forwarded) meta.forwarded = true;
  if (plan.isGroup) {
    const who = m.participant;
    base.group = {
      ...(plan.groupTitle ? { title: plan.groupTitle } : {}),
      participant: m.fromMe ? '' : (who?.phone ?? ''),
      ...(!m.fromMe && (m.pushName || who?.name)
        ? { participantName: (m.pushName ?? who?.name)! }
        : {}),
      ...(!m.fromMe && who?.lid ? { participantLid: who.lid } : {}),
    };
  }
  const withMeta = (b: NormalisedInbound): NormalisedInbound =>
    Object.keys(meta).length > 0 ? { ...b, meta: { ...b.meta, ...meta } } : b;

  if (m.media) {
    meta.mediaOmitted = m.media.kind;
    return withMeta({
      ...base,
      body: [`[${KIND_LABEL[m.media.kind] ?? 'File'}]`, m.text].filter(Boolean).join(' '),
    });
  }
  if (m.location) {
    return withMeta({
      ...base,
      kind: 'location',
      location: {
        latitude: m.location.latitude,
        longitude: m.location.longitude,
        ...(m.location.name ? { name: m.location.name } : {}),
        ...(m.location.address ? { address: m.location.address } : {}),
      },
    });
  }
  if (m.contact) {
    return withMeta({
      ...base,
      kind: 'contact',
      body: m.contacts?.length
        ? (m.contacts.find((c) => c.name)?.name ?? m.contact.name)
        : [m.contact.name, m.contact.phone].filter(Boolean).join(' · '),
      ...(m.contacts?.length ? { meta: { contacts: m.contacts } } : {}),
    });
  }
  if (m.unsupported) {
    meta.rawType = m.unsupported.rawType;
    return withMeta({ ...base, kind: 'unsupported', body: `[${m.unsupported.label} message]` });
  }
  return withMeta({ ...base, body: m.text ?? '' });
}

/** WhatsApp's last sync type of a choice: when its progress reaches 100 the run can finish at once instead of waiting for silence. */
export function finalSyncType(mode: 'recent' | 'full'): HistoryBatch['syncType'] {
  return mode === 'full' ? 'full' : 'recent';
}

export function isFinalBatch(
  mode: 'recent' | 'full',
  b: Pick<HistoryBatch, 'syncType' | 'progress' | 'last'>,
): boolean {
  return b.last && b.progress !== null && b.progress >= 100 && b.syncType === finalSyncType(mode);
}

/** Whether the idle window has passed since the last batch (a running import with nothing more to come). */
export function isIdle(lastBatchAt: Date | null, now: Date, idleSeconds: number): boolean {
  return lastBatchAt !== null && now.getTime() - lastBatchAt.getTime() >= idleSeconds * 1000;
}

/** Whether an import that was asked for has waited too long for history that never came. */
export function isStale(createdAt: Date, now: Date, awaitMinutes: number): boolean {
  return now.getTime() - createdAt.getTime() >= awaitMinutes * 60_000;
}
