import { createHash } from 'node:crypto';
import { truthy } from '../../common/truthy';

/** Pure rules of reading one Instagram message into the inbox (WD-IG-008, 009): no database, no engine, so each can be tested alone. */

export type Json = Record<string, unknown>;

const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});

/** A string or a number as text, anything else as empty (the engine sends ids as either). */
export const text = (x: unknown): string =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '';

export const PLACEHOLDER_TITLE = 'Instagram';
/** The name a contact gets when the engine gave none. */
export const CONTACT_LABEL = 'Instagram user';
export const CONTACT_SOURCE = 'Source: Instagram DM';
export const PREVIEW_MAX = 140;
/** An Instagram trigger that fires on any message of its kind, with no keyword to match. */
export const NO_KEYWORD_TRIGGERS: readonly string[] = ['story_mention', 'mention'];
export const DEFAULT_TRIGGER = 'dm_keyword';
/** A pulled message older than this is history: it is stored but never answered by an automation. */
export const AUTOMATION_WINDOW_MS = 10 * 60_000;

const stripAt = (s: string): string => s.replace(/^@+/, '');
const isDigits = (s: string): boolean => /^\d+$/.test(s);

/** A title that is only a placeholder: "Instagram", or the bare numeric sender id Meta sends before it resolves a name. */
export const isPlaceholderTitle = (title: string): boolean =>
  title === PLACEHOLDER_TITLE || isDigits(stripAt(title));

/** The thread title: the name, else the @handle, else "Instagram". */
export const threadTitle = (name: string, handle: string): string =>
  name !== '' ? name : handle !== '' ? `@${stripAt(handle)}` : PLACEHOLDER_TITLE;

/** The thread key. A payload with no conversation id gets a stable key from its content, so a redelivery lands on the same thread. */
export const threadKey = (convId: string, payload: unknown): string =>
  `ig:${
    convId !== ''
      ? convId
      : `unknown-${createHash('sha256')
          .update(JSON.stringify(payload) ?? '')
          .digest('hex')
          .slice(0, 32)}`
  }`;

/** The sender's id: whatever follows the last colon of the conversation id (all of it when there is none). */
export const senderOf = (convId: string): string => convId.slice(convId.lastIndexOf(':') + 1);

export interface ButtonView {
  text: string;
  url?: string;
}

/**
 * The engine ships interactive buttons as `{title, url?}`; the inbox draws `{text, url}`. Empty ones are dropped, and no list at all
 * gives null so no empty button bar is stored.
 */
export function normalizeButtons(raw: unknown): ButtonView[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ButtonView[] = [];
  for (const b of raw) {
    const o = obj(b);
    const label = text(o.title) || text(o.text);
    if (label === '') continue;
    const btn: ButtonView = { text: label };
    if (typeof o.url === 'string' && o.url !== '') btn.url = o.url;
    out.push(btn);
  }
  return out.length > 0 ? out : null;
}

/** The text cut to 140 characters (by character, so no pair is split), or `[Photo]`-style when a media message has no text. */
export function previewOf(body: string, type: string): string {
  const s =
    body !== '' ? body : type !== 'text' ? `[${type.charAt(0).toUpperCase()}${type.slice(1)}]` : '';
  return Array.from(s).slice(0, PREVIEW_MAX).join('');
}

/** The message's own send time when it parses, else `now`, so ordering never breaks. */
export function sentAtOf(raw: string, now: Date): Date {
  if (raw === '') return now;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? now : new Date(t);
}

export interface Normalized {
  rawJid: string;
  convId: string;
  /** The sender's id, for the contact. */
  igsid: string;
  title: string;
  /** The engine gave a real name or a non-numeric handle: a placeholder title may be replaced. */
  resolvedHuman: boolean;
  handle: string;
  name: string;
  avatar: string;
  accountId: string;
  accountUsername: string;
  direction: 'in' | 'out';
  type: string;
  text: string;
  mediaUrl: string;
  /** The engine's message id; empty when it sent none. */
  providerMid: string;
  isTest: boolean;
  isBackfill: boolean;
  traceId: string;
  buttons: ButtonView[] | null;
  sentAt: Date;
  preview: string;
  /** What kind of Instagram event the auto-reply rules should match. */
  trigger: string;
}

/** One pushed or pulled message into what the inbox stores. */
export function normalize(
  data: { account?: unknown; conversation?: unknown; message?: unknown },
  now: Date,
  extraBackfill = false,
): Normalized {
  const account = obj(data.account);
  const conv = obj(data.conversation);
  const m = obj(data.message);
  const convId = text(conv.id);
  const handle = text(conv.handle).trim();
  const name = text(conv.name).trim();
  const type = text(m.type) || 'text';
  const body = text(m.text);
  return {
    rawJid: threadKey(convId, data),
    convId,
    igsid: convId !== '' ? senderOf(convId) : '',
    title: threadTitle(name, handle),
    resolvedHuman: name !== '' || (handle !== '' && !isDigits(stripAt(handle))),
    handle,
    name,
    avatar: text(conv.avatar),
    accountId: text(account.id),
    accountUsername: text(account.username),
    direction: truthy(m.from_me) ? 'out' : 'in',
    type,
    text: body,
    mediaUrl: text(m.media_url).trim(),
    providerMid: text(m.id).trim(),
    isTest: truthy(m.is_test),
    isBackfill: truthy(m.is_backfill) || extraBackfill,
    traceId: text(m.trace_id).trim(),
    buttons: normalizeButtons(m.buttons),
    sentAt: sentAtOf(text(m.at), now),
    preview: previewOf(body, type),
    trigger: text(m.ig_trigger) || DEFAULT_TRIGGER,
  };
}

/** A genuine inbound message: not our own send, not a test ping, not history. Only these make a contact or run an automation. */
export const isGenuineInbound = (n: Normalized): boolean =>
  n.direction === 'in' && !n.isTest && !n.isBackfill;

/** The name a new contact gets: the thread's, unless that is only a placeholder (then the contact gets the generic label). */
export const contactNameOf = (n: Normalized): string | null =>
  isPlaceholderTitle(n.title) ? null : n.title;

/** An automation runs for a genuine inbound with text, or of a trigger kind that needs no text. */
export const shouldAutomate = (n: Normalized): boolean =>
  isGenuineInbound(n) && (n.text.trim() !== '' || NO_KEYWORD_TRIGGERS.includes(n.trigger));

/**
 * A pulled thread is skipped when we already hold it and the engine reports nothing newer, unless the pull is forced.
 * A thread the engine gives no time for is never skipped.
 */
export function skipThread(
  known: Date | null | undefined,
  engineLastAt: string | null,
  force: boolean,
): boolean {
  if (force || !known) return false;
  const engine = engineLastAt ? Date.parse(engineLastAt) : NaN;
  if (Number.isNaN(engine)) return false;
  return engine <= known.getTime();
}

/** A pulled message is history, not a live one, once it is older than the automation window. */
export const isHistory = (sentAt: Date, now: Date): boolean =>
  now.getTime() - sentAt.getTime() > AUTOMATION_WINDOW_MS;
