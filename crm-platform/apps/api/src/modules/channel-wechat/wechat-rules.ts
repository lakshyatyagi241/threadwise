import { createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { countryCodeOf } from '@crm/contracts';

/** Pure rules of the WeChat channel (WECH): the webhook's signature, its optional AES encryption, its XML and the 48 hour window. */

// --- connecting ------------------------------------------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A URL-safe random string of `length` characters (the routing token in the webhook address is 48). */
export function randomToken(length = 48): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** The address the person pastes into the WeChat console. WeChat requires a public HTTPS address, so plain http is forced to https. */
export function webhookUrl(appUrl: string, routingToken: string): string {
  const base = appUrl.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  return `${base}/v2/wechat/inbound/${routingToken}`;
}

/** Errors are kept to 255 characters on the row. */
export const clipError = (s: string | null | undefined): string | null =>
  s ? s.slice(0, 255) : null;

/** Seconds to keep a freshly fetched token for: WeChat says 7200, never trust less than a minute (Reference). */
export const tokenLifetimeSeconds = (expiresIn: number | null | undefined): number =>
  Math.max(60, expiresIn && Number.isFinite(expiresIn) ? Math.floor(expiresIn) : 7200);

/** A cached token is used until five minutes before it expires (Reference). */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
export function tokenIsFresh(
  token: string | null,
  expiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  return (
    token !== null &&
    token !== '' &&
    expiresAt !== null &&
    expiresAt.getTime() > now.getTime() + TOKEN_REFRESH_MARGIN_MS
  );
}

// --- the webhook's signature -----------------------------------------------------------------------------------------------

const sha1 = (parts: readonly string[]): string =>
  createHash('sha1')
    .update([...parts].sort().join(''))
    .digest('hex');

/** Constant-time comparison, so a signature cannot be guessed one character at a time. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `signature` = sha1 of the sorted `[token, timestamp, nonce]`, joined. Checked on every GET and POST. */
export function signatureMatches(
  token: string,
  signature: string,
  timestamp: string,
  nonce: string,
): boolean {
  if (token === '' || signature === '') return false;
  return safeEqual(sha1([token, timestamp, nonce]), signature.toLowerCase());
}

/** WeChat's timestamp is its own clock; a signed request older (or newer) than this is a replay, not WeChat. */
export const TIMESTAMP_TOLERANCE_S = 600;
export function timestampFresh(timestamp: string, now: Date = new Date()): boolean {
  const t = Number(timestamp);
  return Number.isInteger(t) && Math.abs(now.getTime() / 1000 - t) <= TIMESTAMP_TOLERANCE_S;
}

/** Message encryption: `msg_signature` = sha1 of the sorted `[token, timestamp, nonce, <Encrypt>]`. */
export function msgSignatureMatches(
  token: string,
  msgSignature: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): boolean {
  if (token === '' || msgSignature === '') return false;
  return safeEqual(sha1([token, timestamp, nonce, encrypt]), msgSignature.toLowerCase());
}

/**
 * Decrypts an `<Encrypt>` payload (AES-256-CBC with the EncodingAESKey). The plaintext is
 * `[16 random bytes][4 byte big-endian length][message][AppID]`, padded to 32 bytes. Returns the message, or null on any doubt
 * (a wrong key, a damaged payload, another account's AppID).
 */
export function decryptSafeMode(
  encodingAesKey: string,
  encrypt: string,
  expectAppId = '',
): string | null {
  try {
    if (encodingAesKey.length !== 43) return null;
    const key = Buffer.from(`${encodingAesKey}=`, 'base64');
    if (key.length !== 32) return null;
    const cipher = Buffer.from(encrypt, 'base64');
    if (cipher.length === 0 || cipher.length % 16 !== 0) return null;
    const d = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
    d.setAutoPadding(false);
    const padded = Buffer.concat([d.update(cipher), d.final()]);
    const pad = padded[padded.length - 1] ?? 0;
    if (pad < 1 || pad > 32 || pad > padded.length) return null;
    const plain = padded.subarray(0, padded.length - pad);
    if (plain.length < 20) return null;
    const len = plain.readUInt32BE(16);
    const message = plain.subarray(20, 20 + len);
    const appId = plain.subarray(20 + len).toString('utf8');
    if (message.length !== len) return null;
    if (expectAppId !== '' && appId !== '' && !safeEqual(expectAppId, appId)) return null;
    return len > 0 ? message.toString('utf8') : null;
  } catch {
    return null;
  }
}

// --- the webhook's XML -----------------------------------------------------------------------------------------------------

/** A WeChat packet is a few kilobytes; the reader is not linear on hostile input, so it is not offered more than this. */
export const XML_MAX_CHARS = 65_536;

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};
const decode = (s: string): string => s.replace(/&(?:lt|gt|quot|apos|amp);/g, (m) => ENTITIES[m]!);

/** A message's fields are flat `<Tag>value</Tag>` or `<Tag><![CDATA[value]]></Tag>` children of `<xml>`. */
const FIELD = /<([A-Za-z_][\w.-]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;

/**
 * Reads a WeChat XML packet into its flat fields. No XML library: WeChat's packets have no attributes or nesting that matter here, a
 * document type declaration is refused outright (no entity expansion, no external lookups), and the first value of a tag wins so a
 * nested element cannot overwrite a top-level one. An unreadable packet is an empty object.
 */
export function parseXml(raw: string): Record<string, string> {
  if (raw.trim() === '' || raw.length > XML_MAX_CHARS || /<!(?:DOCTYPE|ENTITY)/i.test(raw))
    return {};
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(FIELD)) {
    const name = m[1]!;
    if (name === 'xml' || name in out) continue;
    out[name] = m[2] !== undefined ? m[2] : decode(m[3] ?? '');
  }
  return out;
}

// --- what an inbound packet means ------------------------------------------------------------------------------------------

export type InboundMediaType = 'image' | 'audio' | 'video';

export interface WechatInbound {
  openid: string;
  /** `message` (any user message), `subscribe`, `unsubscribe`, `click` (a custom-menu tap, replayed as a message) or `ignored`. */
  kind: 'message' | 'subscribe' | 'unsubscribe' | 'click' | 'ignored';
  /** WeChat's `MsgId`; events have none. */
  msgId: string | null;
  msgType: string;
  event: string;
  eventKey: string;
  createTime: string;
  /** The text shown in the inbox and given to automation. */
  text: string;
  media: { id: string; type: InboundMediaType } | null;
  location: { latitude: number; longitude: number; label: string } | null;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** An inbound packet's meaning (Reference's mapping of text, image, voice, video, location, link and the subscribe, unsubscribe and click events). */
export function classify(d: Record<string, string>): WechatInbound | null {
  const openid = d.FromUserName ?? '';
  if (openid === '') return null;
  const msgType = (d.MsgType ?? '').toLowerCase();
  const event = (d.Event ?? '').toLowerCase();
  const base = {
    openid,
    msgId: d.MsgId && d.MsgId !== '' ? d.MsgId : null,
    msgType,
    event,
    eventKey: d.EventKey ?? '',
    createTime: d.CreateTime ?? '',
    text: '',
    media: null,
    location: null,
  } satisfies Omit<WechatInbound, 'kind'>;

  if (msgType === 'event') {
    if (event === 'unsubscribe') return { ...base, kind: 'unsubscribe' };
    if (event === 'subscribe') return { ...base, kind: 'subscribe' };
    if (event === 'click') {
      // A menu tap comes back as its key, typed as if the person had written it, so keyword rules and flows answer it.
      return base.eventKey === ''
        ? { ...base, kind: 'ignored' }
        : { ...base, kind: 'click', text: base.eventKey };
    }
    // Scans, views, locations and the rest are acknowledged and nothing more (Reference).
    return { ...base, kind: 'ignored' };
  }

  const mediaId = d.MediaId ?? '';
  switch (msgType) {
    case 'text':
      return { ...base, kind: 'message', text: d.Content ?? '' };
    case 'image':
      return {
        ...base,
        kind: 'message',
        media: mediaId ? { id: mediaId, type: 'image' } : null,
      };
    case 'voice':
      return {
        ...base,
        kind: 'message',
        // WeChat's speech recognition, when the account has it on, is the message's text.
        text: (d.Recognition ?? '').trim(),
        media: mediaId ? { id: mediaId, type: 'audio' } : null,
      };
    case 'video':
    case 'shortvideo':
      return {
        ...base,
        kind: 'message',
        media: mediaId ? { id: mediaId, type: 'video' } : null,
      };
    case 'location': {
      const latitude = num(d.Location_X);
      const longitude = num(d.Location_Y);
      return {
        ...base,
        kind: 'message',
        text: `[location] ${d.Label ?? ''}`.trim(),
        location:
          latitude !== null && longitude !== null
            ? { latitude, longitude, label: d.Label ?? '' }
            : null,
      };
    }
    case 'link':
      return { ...base, kind: 'message', text: `${d.Title ?? ''} ${d.Url ?? ''}`.trim() };
    default:
      return { ...base, kind: 'message', text: `[${msgType === '' ? 'message' : msgType}]` };
  }
}

/** The ledger key of a stored inbound: WeChat redelivers the same MsgId (or, for an event, the same user, event and time). */
export function inboundKey(i: WechatInbound): string | null {
  if (i.msgId) return `msg:${i.msgId}`;
  if (i.createTime !== '') return `evt:${i.event || i.msgType}:${i.openid}:${i.createTime}`;
  return null;
}

// --- the 48 hour window ----------------------------------------------------------------------------------------------------

/** A free-form customer-service message may be sent for 48 hours after the follower's last message (Reference). */
export const WINDOW_HOURS = 48;

export const WINDOW_CLOSED_MESSAGE =
  'Outside the 48-hour WeChat window — a template message is required.';

export const windowOpen = (lastInboundAt: Date | null, now: Date = new Date()): boolean =>
  lastInboundAt !== null && lastInboundAt.getTime() >= now.getTime() - WINDOW_HOURS * 3_600_000;

// --- broadcasts ------------------------------------------------------------------------------------------------------------

/** The texts WeChat's mass send takes, cut to its own ceiling in characters (never in the middle of an emoji). */
export function clipText(s: string, limit: number): string {
  const chars = [...s];
  return chars.length > limit ? chars.slice(0, limit).join('') : s;
}

/** The number WeChat's own tag id field takes, from the digits stored on the broadcast. */
export const tagIdOf = (tagId: string | null): number => {
  const n = Number(tagId ?? '0');
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

/** A broadcast that has been `sending` this long without finishing belongs to a worker that died. */
export const STALE_SENDING_MINUTES = 15;

// --- where WeChat may be used ----------------------------------------------------------------------------------------------

/** Countries where WeChat is not allowed (ISO 3166-1 alpha-2). India bans WeChat, so no channel can run for an Indian workspace. */
export const WECHAT_BLOCKED_COUNTRIES: ReadonlySet<string> = new Set(['IN']);

/**
 * The country a workspace is judged by: its billing country when it has one (the latest paid order), else the country it gave at
 * onboarding. The same order Compliance uses. Null when neither is a country we can read.
 */
export function workspaceCountry(billing: string | null, onboarding: string | null): string | null {
  return countryCodeOf(billing) ?? countryCodeOf(onboarding);
}

/** WeChat is usable unless the workspace's country is blocked. An unknown country is not blocked: nothing is taken away without a reason. */
export function wechatAllowedIn(country: string | null): boolean {
  return country === null || !WECHAT_BLOCKED_COUNTRIES.has(country);
}
