import { randomBytes } from 'node:crypto';
import { buildWhatsappLink, phpUrlencode } from '@crm/contracts';

/**
 * The pure rules of the chatbot widget: tokens, slugs, the WhatsApp link, the origin allow-list, the transcript shape.
 * Nothing here touches the database or the request, so each rule has a unit test of its own.
 */

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Reference's `Str::random(48)`: 48 characters of `[A-Za-z0-9]`, from a CSPRNG, without modulo bias. */
export function freshToken(length = 48): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // 248 = 62 * 4: bytes above it would favour the first characters.
      if (byte >= 248) continue;
      out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

/** The token shape every public route insists on (`[A-Za-z0-9]{16,80}`); anything else is a plain 404. */
export const TOKEN_SHAPE = /^[A-Za-z0-9]{16,80}$/;
export const isTokenShape = (token: string): boolean => TOKEN_SHAPE.test(token);

/**
 * `Str::slug` for the names people type: lower case, accents folded, anything that is not a letter, digit, space or dash
 * dropped, runs of separators collapsed to one dash. A name with no Latin letters or digits slugs to ''.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/@/g, ' at ')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `widget-<6 random>` when the name gives no slug (a non-Latin name). */
export function slugBase(name: string, random: () => string = () => freshToken(6).toLowerCase()) {
  return slugify(name) || `widget-${random()}`;
}

/** First free `base`, `base-2`, `base-3`, ... (Reference's loop starts the counter at 2). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

/** The slug a duplicate gets: the source slug, `-copy-` and four random characters. */
export const copySlug = (slug: string, random: () => string = () => freshToken(4)) =>
  `${slug}-copy-${random()}`;

export interface WidgetModeFields {
  mode: string;
  assistantId: unknown | null;
  targetWhatsappCc: string | null;
  targetWhatsappNumber: string | null;
  prefilledMessage: string | null;
}

/** Reference `usesAi()`: the mode allows it AND a smart agent is linked. */
export const usesAi = (w: Pick<WidgetModeFields, 'mode' | 'assistantId'>): boolean =>
  (w.mode === 'ai' || w.mode === 'both') && w.assistantId !== null;

/** Reference `usesWhatsApp()`: the mode allows it AND a number is set. */
export const usesWhatsApp = (w: Pick<WidgetModeFields, 'mode' | 'targetWhatsappNumber'>): boolean =>
  (w.mode === 'whatsapp' || w.mode === 'both') && !!w.targetWhatsappNumber;

export { phpUrlencode };

/** The `wa.me` deep link of TW-WGT-013, or null when the mode or the number says there is none. */
export function whatsappUrl(w: WidgetModeFields): string | null {
  if (!usesWhatsApp(w)) return null;
  return buildWhatsappLink(w.targetWhatsappCc, w.targetWhatsappNumber, w.prefilledMessage);
}

/** The host[:port] of an `Origin` header, lower case; null when it does not parse. */
export function originHostPort(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (!u.hostname) return null;
    return u.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Reference `originAllowed()`: no origin is never allowed here (the caller skips the check when there is none); an EMPTY list
 * allows every origin; otherwise the origin's host[:port] must equal an entry exactly (no wildcard subdomains, `www.` is a
 * different host, the port must match).
 */
export function originAllowed(
  origin: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!origin) return false;
  if (allowed.length === 0) return true;
  const hostPort = originHostPort(origin);
  if (!hostPort) return false;
  return allowed.some((entry) => {
    const e = entry
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '');
    return (e.split('/')[0] ?? '').replace(/\/+$/, '') === hostPort;
  });
}

/** Reads `name=value` from a Cookie header. */
export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** The visitor name used for a conversation title (Reference `displayName()`): name, else email, else `Visitor ` + 6 characters. */
export function visitorDisplayName(v: {
  name: string | null;
  email: string | null;
  visitorUuid: string;
}): string {
  if (v.name) return v.name;
  if (v.email) return v.email;
  return `Visitor ${v.visitorUuid.slice(0, 6)}`;
}

/** Truncation by characters, not UTF-16 units, so a cut never splits an emoji. */
export const truncate = (text: string, max: number): string =>
  Array.from(text).slice(0, max).join('');

export const PREVIEW_LENGTH = 191;

/** The digits of a phone, as Reference reduced it before matching a contact. */
export const phoneDigits = (phone: string | null | undefined): string =>
  (phone ?? '').replace(/\D+/g, '');

type InboxCards = NonNullable<import('./_shims/tokens').InboxLine['cards']>;

export interface TranscriptSource {
  id: number;
  direction: string;
  body: string | null;
  agentId: number | null;
  /** Reply buttons a flow bot offered with this line. */
  buttons?: Array<{ id: string; title: string; icon?: string }> | null;
  /** A file a flow bot sent with this line. */
  media?: { kind: string; name: string } | null;
  /** What a question line waits for. */
  input?: { type: string; format?: string; accept?: string[] } | null;
  /** Link, call and email buttons on this line. */
  links?: Array<{ label: string; url: string; icon?: string }> | null;
  /** The cards of a carousel the bot sent with this line. */
  cards?: InboxCards | null;
}

/** A file as the chat window draws it: its address is relative to the widget's own, read through the visitor's thread. */
export const widgetMediaOf = (m: { id: number; media?: { kind: string; name: string } | null }) =>
  m.media
    ? {
        kind: m.media.kind as 'image' | 'video' | 'audio' | 'document',
        name: m.media.name,
        url: `api/media/${m.id}`,
      }
    : undefined;

/**
 * One stored message as the widget draws it (TW-WGT-012 rule 1): the direction is flipped to the widget's point of view
 * (the visitor's own message is the widget's 'out'), and `from` says who wrote it.
 */
export function toTranscriptEntry(m: TranscriptSource) {
  return {
    id: m.id,
    dir: m.direction === 'in' ? ('out' as const) : ('in' as const),
    body: m.body,
    from:
      m.direction === 'in'
        ? ('visitor' as const)
        : m.agentId
          ? ('agent' as const)
          : ('assistant' as const),
    ...(m.buttons && m.buttons.length ? { buttons: m.buttons } : {}),
    ...(m.media ? { media: widgetMediaOf(m) } : {}),
    ...(m.input ? { input: m.input } : {}),
    ...(m.links && m.links.length ? { links: m.links } : {}),
    ...(m.cards && m.cards.length ? { cards: m.cards } : {}),
  };
}

/** The label the history poll gives a reply. */
export const historyFrom = (agentId: number | null): 'agent' | 'assistant' =>
  agentId ? 'agent' : 'assistant';

/** `source` marker on every message the widget's own assistant writes; anything else outbound is a person. */
export const AI_SOURCE = 'ai_chat_assistant';

/**
 * The origin the embed script and the chat page point back at. Never the request's own `Host`: behind the website's proxy that is the
 * API container's name (`desk-api-green:3000`), which a visitor's browser cannot resolve. The configured widget address wins, then
 * `APP_URL` (the same two the snippet shown to the owner is built from); only without either is the request's host used.
 */
export function widgetBaseUrl(
  env: { widgetPublicBase?: string | null; appUrl?: string | null },
  req: { protocol: string; get(name: string): string | undefined },
): string {
  const configured = env.widgetPublicBase?.trim() || env.appUrl?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
