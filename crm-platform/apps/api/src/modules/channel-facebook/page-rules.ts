import { createHmac, timingSafeEqual } from 'node:crypto';

/** Pure rules of connecting and addressing a Facebook Page (TW-FB-002 to 006, 011). */

/** Errors are kept to 490 characters on the row (Reference's column held 500). */
export const clipError = (s: string | null | undefined): string | null =>
  s ? s.slice(0, 490) : null;

/** Meta delivers to https only, so the address is forced to it. */
export function webhookAddress(appUrl: string): string {
  const base = appUrl.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  return `${base}/v2/facebook/webhook`;
}

/** The login dialog (TW-FB-002). With a configuration id Meta ignores `scope` and wants the code grant spelled out. */
export function loginUrl(o: {
  graphVersion: string;
  appId: string;
  redirectUri: string;
  state: string;
  scopes: readonly string[];
  configId: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: o.appId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: o.scopes.join(','),
    state: o.state,
  });
  if (o.configId) {
    params.set('config_id', o.configId);
    params.set('override_default_response_type', 'true');
  }
  return `https://www.facebook.com/${o.graphVersion}/dialog/oauth?${params.toString()}`;
}

/** What the login round trip carries and for how long it is good. A callback older than this is refused. */
export const STATE_TTL_MS = 15 * 60_000;

export interface LoginState {
  orgId: number;
  userId: number | null;
  /** When the dialog was started, in epoch milliseconds. */
  at: number;
  /** A random value, so two logins in the same millisecond are different states. */
  nonce: string;
}

/** The state is whatever sealed it handed back: valid only if it parses, is fresh and is not from the future. */
export function readState(json: string, now: number): LoginState | null {
  let s: unknown;
  try {
    s = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof s !== 'object' || s === null) return null;
  const v = s as Partial<LoginState>;
  if (typeof v.orgId !== 'number' || typeof v.at !== 'number' || typeof v.nonce !== 'string') {
    return null;
  }
  if (v.userId !== null && typeof v.userId !== 'number') return null;
  if (v.at > now + 60_000 || now - v.at > STATE_TTL_MS) return null;
  return { orgId: v.orgId, userId: v.userId ?? null, at: v.at, nonce: v.nonce };
}

/** "Facebook Page “X” connected." for one, "3 Facebook Pages connected: A, B, C…" for several (first five named). */
export function connectSummary(names: readonly string[]): string {
  if (names.length === 1) return `Facebook Page “${names[0]}” connected.`;
  const list = names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : '');
  return `${names.length} Facebook Pages connected: ${list}`;
}

/** Why a Page was flagged when Meta stopped accepting its token. */
export const TOKEN_INVALID_MESSAGE = 'Token is no longer valid — reconnect this Page.';

/** Meta error code 190: the token was revoked or expired, the password changed, or the app was removed. */
export const isTokenError = (code: number | undefined): boolean => code === 190;

/** Meta signs the raw body with the app secret: `X-Hub-Signature-256: sha256=<hex>`. True when any secret matches. */
export function signatureMatches(
  rawBody: Buffer | string,
  header: string,
  secrets: readonly string[],
): boolean {
  if (!header.startsWith('sha256=')) return false;
  const given = Buffer.from(header);
  for (const secret of secrets) {
    if (secret === '') continue;
    const expected = Buffer.from(
      `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
    );
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

/** The verify handshake: echo the challenge only for `subscribe` with the right token (constant time). */
export function verifyHandshake(mode: string, token: string, expected: string | null): boolean {
  if (mode !== 'subscribe' || !expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The thread of one Messenger sender (TW-FB-007). */
export const dmThreadKey = (pageId: string, psid: string): string => `fb:${pageId}:${psid}`;

/** The thread of one commenter on one post, so a reply goes to that person (TW-FB-009). */
export const commentThreadKey = (pageId: string, postId: string, commenterId: string): string =>
  `fb:${pageId}:post:${postId}:${commenterId !== '' ? commenterId : 'anon'}`;

export type ThreadTarget =
  | { kind: 'dm'; pageId: string; psid: string }
  | { kind: 'comment'; pageId: string; postId: string };

/** `fb:<page>:<psid>` or `fb:<page>:post:<post>[:<commenter>]`; anything else is not a Facebook thread. */
export function parseThreadKey(rawJid: string): ThreadTarget | null {
  const parts = rawJid.split(':');
  if (parts[0] !== 'fb' || !parts[1]) return null;
  if (parts[2] === 'post')
    return parts[3] ? { kind: 'comment', pageId: parts[1], postId: parts[3] } : null;
  return parts[2] ? { kind: 'dm', pageId: parts[1], psid: parts[2] } : null;
}

/** The preview line of a thread. */
export const preview = (text: string): string =>
  text.length > 120 ? `${text.slice(0, 117)}...` : text;

/** A friendly sender name from Meta's profile: `name`, else first and last name; empty when it gave neither. */
export function senderName(
  p: { name?: string; first_name?: string; last_name?: string } | null,
): string {
  if (!p) return '';
  const full = (p.name ?? '').trim();
  return full !== '' ? full : `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
}

/** How an outbound attachment is typed for Meta from the inbox's media type. */
export function attachmentType(
  mediaType: string | null | undefined,
): 'image' | 'video' | 'audio' | 'file' {
  switch (mediaType) {
    case 'image':
    case 'sticker':
    case 'photo':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
    case 'voice':
    case 'ptt':
      return 'audio';
    default:
      return 'file';
  }
}
