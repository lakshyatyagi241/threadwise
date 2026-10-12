/* eslint-disable @typescript-eslint/no-explicit-any -- a WhatsApp message is read structurally: its shape varies by kind and the library's own types are unions of dozens of optional fields */
import type { InboundMessage } from './inbound.port';

/** The part of a Baileys `WAMessage` the normalizer reads. Structural, so tests need no library. */
export interface RawMessage {
  key: {
    id?: string | null;
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    fromMe?: boolean | null;
    participant?: string | null;
    senderPn?: string | null;
    participantPn?: string | null;
    senderLid?: string | null;
    participantLid?: string | null;
  };
  message?: Record<string, any> | null;
  messageTimestamp?: number | string | { toNumber(): number } | null;
  pushName?: string | null;
}

/** A message older than this is a replay after a reconnect, never a live event (TW-NODE-016 rule 2). */
export const STALE_AFTER_MS = 600_000;

export type Upsert = 'notify' | 'append' | string;

export type Normalized =
  /** A customer message: goes on to the inbox. */
  | { kind: 'inbound'; message: InboundMessage }
  /** The business's own message (typed on the phone, or sent by this runtime): stored for the thread, never acted on. */
  | { kind: 'echo'; message: InboundMessage }
  /** A group message: stored only, no flow, keyword or AI. */
  | { kind: 'group'; message: InboundMessage };

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');
const jidUser = (jid: string) => jid.split('@')[0]!.split(':')[0]!;

const SKIP_JIDS = ['status@broadcast'];
const SKIP_SUFFIXES = ['@newsletter', '@broadcast'];

function seconds(ts: RawMessage['messageTimestamp']): number | null {
  if (ts === null || ts === undefined) return null;
  const n = typeof ts === 'object' ? ts.toNumber() : Number(ts);
  return Number.isFinite(n) ? n : null;
}

/** The first `TEL` of a vCard, digits and `+` only. */
function vcardPhone(vcard: string): string | null {
  const m = /^TEL[^:\r\n]*:([^\r\n]+)/im.exec(vcard);
  const v = m?.[1]?.replace(/[^\d+]/g, '');
  return v || null;
}
/** Every value of a vCard property (`TEL`, `EMAIL`), phones keep digits and `+` only. */
function vcardValues(vcard: string, prop: 'TEL' | 'EMAIL'): string[] {
  const out: string[] = [];
  for (const m of vcard.matchAll(new RegExp(`^${prop}[^:\\r\\n]*:([^\\r\\n]+)`, 'gim'))) {
    const v = prop === 'TEL' ? m[1]!.replace(/[^\d+]/g, '') : m[1]!.trim();
    if (v) out.push(v);
  }
  return out.slice(0, 5);
}
const vcardName = (vcard: string): string | null =>
  /^FN:([^\r\n]+)/im.exec(vcard)?.[1]?.trim() ?? null;

/** The visible text of a message, in Reference's priority (TW-NODE-016 rule 5). */
export function visibleText(m: Record<string, any>): string | null {
  const t =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.buttonsResponseMessage?.selectedButtonId ??
    m.listResponseMessage?.title ??
    m.listResponseMessage?.singleSelectReply?.selectedRowId ??
    m.templateButtonReplyMessage?.selectedDisplayText ??
    m.templateButtonReplyMessage?.selectedId ??
    nativeFlowText(m.interactiveResponseMessage);
  return typeof t === 'string' && t !== '' ? t : null;
}

function nativeFlowText(r: Record<string, any> | undefined): string | null {
  const raw = r?.nativeFlowResponseMessage?.paramsJson;
  if (typeof raw !== 'string') return null;
  try {
    const p = JSON.parse(raw) as { display_text?: string; id?: string };
    return p.display_text || p.id || null;
  } catch {
    return null;
  }
}

/** Wrappers WhatsApp puts around the real content (disappearing chats, view-once, a captioned document, an edit). */
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const;

export function unwrap(
  content: Record<string, any> | null | undefined,
): Record<string, any> | null {
  let cur = content ?? null;
  for (let i = 0; cur && i < 4; i++) {
    const key = WRAPPERS.find((w) => cur![w]?.message);
    if (!key) break;
    cur = cur[key].message;
  }
  return cur;
}

/** Message types the inbox has no bubble for: kept as a labelled placeholder with the raw type. */
const UNSUPPORTED_KEYS: Record<string, string> = {
  pollCreationMessage: 'Poll',
  pollCreationMessageV2: 'Poll',
  pollCreationMessageV3: 'Poll',
  pollUpdateMessage: 'Poll vote',
  productMessage: 'Product',
  orderMessage: 'Order',
  listMessage: 'List',
  buttonsMessage: 'Buttons',
  templateMessage: 'Template',
  interactiveMessage: 'Interactive message',
  groupInviteMessage: 'Group invite',
  eventMessage: 'Event',
  paymentInviteMessage: 'Payment',
};

const MEDIA_KEYS = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'sticker'],
] as const;

/**
 * Reads one `messages.upsert` entry (TW-NODE-016, 018). Returns null for everything that must be dropped: the wrong upsert
 * type, a replay older than 10 minutes, a status or newsletter or broadcast chat, an event with nothing to show.
 *
 * `notify` is a live message; `append` is history and is kept only for the business's own messages (the echo sync).
 */
export function normalizeMessage(
  msg: RawMessage,
  upsert: Upsert,
  now: Date,
  opts: { maxAgeMs?: number } = {},
): Normalized | null {
  if (upsert !== 'notify' && upsert !== 'append') return null;
  const fromMe = msg.key.fromMe === true;
  if (upsert === 'append' && !fromMe) return null;

  const remote = msg.key.remoteJid ?? '';
  if (!remote || SKIP_JIDS.includes(remote) || SKIP_SUFFIXES.some((s) => remote.endsWith(s)))
    return null;
  const id = msg.key.id;
  if (!id) return null;

  const ts = seconds(msg.messageTimestamp);
  const timestamp = new Date((ts ?? now.getTime() / 1000) * 1000);
  if (now.getTime() - timestamp.getTime() > (opts.maxAgeMs ?? STALE_AFTER_MS)) return null;

  const content = unwrap(msg.message);
  if (!content) return null; // protocol, status and key-exchange events carry no body

  const isGroup = remote.endsWith('@g.us');
  const chat = resolveChat(msg, remote, isGroup);
  const participant = isGroup ? resolveParticipant(msg) : null;

  // A reaction is its own thing: nothing else is read from it.
  const reaction = content.reactionMessage;
  if (reaction?.key?.id) {
    return wrap(
      {
        ...base(msg, id, chat, fromMe, participant, timestamp),
        reaction: { emoji: String(reaction.text ?? ''), targetMessageId: String(reaction.key.id) },
      },
      isGroup,
      fromMe,
    );
  }

  const text = visibleText(content);
  let media: InboundMessage['media'] = null;
  for (const [key, kind] of MEDIA_KEYS) {
    const mm = content[key];
    if (mm) {
      media = {
        kind,
        mimeType: mm.mimetype ?? null,
        fileName: kind === 'document' ? (mm.fileName ?? mm.title ?? null) : null,
        sizeBytes:
          mm.fileLength === undefined || mm.fileLength === null ? null : Number(mm.fileLength),
      };
      break;
    }
  }
  const loc = content.locationMessage ?? content.liveLocationMessage;
  const location: InboundMessage['location'] = loc
    ? {
        latitude: Number(loc.degreesLatitude),
        longitude: Number(loc.degreesLongitude),
        name: loc.name ?? null,
        address: loc.address ?? null,
      }
    : null;
  const card = content.contactMessage ?? content.contactsArrayMessage?.contacts?.[0];
  const vcard = typeof card?.vcard === 'string' ? card.vcard : null;
  const contact: InboundMessage['contact'] = vcard
    ? { name: card.displayName ?? vcardName(vcard) ?? '', phone: vcardPhone(vcard), vcard }
    : null;

  const cards = [
    ...(content.contactMessage ? [content.contactMessage] : []),
    ...(content.contactsArrayMessage?.contacts ?? []),
  ]
    .filter((c) => typeof c?.vcard === 'string')
    .slice(0, 10)
    .map((c) => ({
      name: (c.displayName ?? vcardName(c.vcard) ?? null) as string | null,
      phones: vcardValues(c.vcard, 'TEL'),
      emails: vcardValues(c.vcard, 'EMAIL'),
      org: /^ORG:([^\r\n;]+)/im.exec(c.vcard)?.[1]?.trim() ?? null,
    }));
  const unsupportedKey = Object.keys(UNSUPPORTED_KEYS).find((k) => content[k]);
  const unsupported =
    !text && !media && !location && !contact && unsupportedKey
      ? { rawType: unsupportedKey, label: UNSUPPORTED_KEYS[unsupportedKey]! }
      : null;

  // Nothing to show (no text, no media, no location, no contact, no known rich type): drop, as Reference did.
  const caption = media
    ? (content[MEDIA_KEYS.find(([, k]) => k === media!.kind)![0]].caption ?? null)
    : null;
  const shown = text ?? (typeof caption === 'string' && caption !== '' ? caption : null);
  if (shown === null && !media && !location && !contact && !unsupported) return null;

  const ctx = Object.values(content)
    .map((v) => (v as { contextInfo?: Record<string, any> } | null)?.contextInfo)
    .find((c) => c?.isForwarded);
  const replyTo = Object.values(content)
    .map((v) => (v as { contextInfo?: Record<string, any> } | null)?.contextInfo?.stanzaId)
    .find((v) => typeof v === 'string' && v !== '');
  return wrap(
    {
      ...base(msg, id, chat, fromMe, participant, timestamp),
      text: shown,
      media,
      location,
      contact,
      forwarded: ctx ? { score: Number(ctx.forwardingScore ?? 0) } : null,
      contacts: cards,
      replyToProviderMessageId: replyTo ?? null,
      unsupported,
    },
    isGroup,
    fromMe,
  );
}

function wrap(message: InboundMessage, isGroup: boolean, fromMe: boolean): Normalized {
  if (isGroup) return { kind: 'group', message };
  return { kind: fromMe ? 'echo' : 'inbound', message };
}

function base(
  msg: RawMessage,
  id: string,
  chat: InboundMessage['chat'],
  fromMe: boolean,
  participant: InboundMessage['participant'],
  timestamp: Date,
): InboundMessage {
  return {
    providerMessageId: id,
    chat,
    fromMe,
    participant,
    pushName: msg.pushName ?? null,
    timestamp,
    text: null,
    media: null,
    location: null,
    contact: null,
    reaction: null,
    forwarded: null,
  };
}

/** The real phone from the fields WhatsApp gives, else the chat id itself when it is one; a LID-only chat has no phone (rule 4). */
function resolveChat(msg: RawMessage, remote: string, isGroup: boolean): InboundMessage['chat'] {
  if (isGroup) return { jid: remote, phone: null, lid: null, isGroup: true };
  const k = msg.key;
  const alt = k.remoteJidAlt && k.remoteJidAlt.endsWith('@s.whatsapp.net') ? k.remoteJidAlt : null;
  const phoneSource =
    k.senderPn ?? k.participantPn ?? alt ?? (remote.endsWith('@s.whatsapp.net') ? remote : null);
  const phone = phoneSource ? digits(jidUser(phoneSource)) || null : null;
  const lid = remote.endsWith('@lid') ? jidUser(remote) : null;
  return { jid: phone ? `${phone}@s.whatsapp.net` : remote, phone, lid, isGroup: false };
}

/** Who spoke in a group. A LID-only speaker keeps the LID instead of being rejected (Reference lost those messages). */
function resolveParticipant(msg: RawMessage): InboundMessage['participant'] {
  const k = msg.key;
  const p = k.participantPn ?? k.participant ?? null;
  const phone = p && !p.endsWith('@lid') ? digits(jidUser(p)) || null : null;
  const lidSource =
    k.participantLid ?? (k.participant && k.participant.endsWith('@lid') ? k.participant : null);
  return { phone, lid: lidSource ? jidUser(lidSource) : null, name: msg.pushName ?? null };
}
