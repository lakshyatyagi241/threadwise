import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Pure helpers for connecting a Viber channel (TW-VIB-002) and checking what Viber sends. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A URL-safe random string of `length` characters (48 for the routing token, as Reference). */
export function randomToken(length = 48): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** The address Viber pushes to. Viber needs a valid CA certificate, so plain http is forced to https. */
export function webhookUrl(appUrl: string, routingToken: string): string {
  const base = appUrl.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  return `${base}/v2/viber/inbound/${routingToken}`;
}

/** Errors are kept to 255 characters on the row. */
export const clipError = (s: string | null | undefined): string | null =>
  s ? s.slice(0, 255) : null;

/** What the operator reads when Viber refuses the webhook (Reference's wording). */
export function webhookRefusedMessage(why: string): string {
  return `Saved the channel, but Viber refused the webhook: ${why} — the URL must be public HTTPS with a valid CA certificate (a local/IP address is rejected).`;
}

/**
 * `X-Viber-Content-Signature` is the hex HMAC-SHA256 of the RAW body with the account's auth token. Compared in constant time; an
 * empty signature or token never matches.
 */
export function signatureMatches(raw: Buffer, signature: string, authToken: string): boolean {
  if (signature === '' || authToken === '') return false;
  const expected = Buffer.from(createHmac('sha256', authToken).update(raw).digest('hex'));
  const given = Buffer.from(signature.trim().toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The sender object Viber requires on every send: the bot's name, and its picture when it has one. */
export function senderObject(
  name: string | null,
  avatar: string | null,
): { name: string; avatar?: string } {
  return { name: name || 'Bot', ...(avatar ? { avatar } : {}) };
}
