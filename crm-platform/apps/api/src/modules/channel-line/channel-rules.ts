import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Pure helpers for connecting a LINE channel and verifying what LINE pushes. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A URL-safe random string of `length` characters (48 for the routing token). */
export function randomToken(length = 48): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** The address LINE pushes to. LINE refuses plain http, so it is forced to https. */
export function webhookUrl(appUrl: string, routingToken: string): string {
  const base = appUrl.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  return `${base}/v2/line/inbound/${routingToken}`;
}

/** Errors are kept to 255 characters on the row. */
export const clipError = (s: string | null | undefined): string | null =>
  s ? s.slice(0, 255) : null;

/** What the operator reads when LINE refuses the webhook. */
export function webhookRefusedMessage(why: string): string {
  return `Saved the channel, but LINE refused the webhook: ${why} — the URL must be public HTTPS. On a local machine, use a tunnel (ngrok / Cloudflare Tunnel).`;
}

/** The value LINE puts in `X-Line-Signature`: base64 of HMAC-SHA256 of the raw body, keyed by the channel secret. */
export function lineSignature(rawBody: Buffer, channelSecret: string): string {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}

/**
 * Whether a delivery really came from LINE, compared in constant time on the RAW body. A missing secret or header never matches
 * (Reference refuses both the same way).
 */
export function signatureMatches(rawBody: Buffer, channelSecret: string, given: string): boolean {
  if (channelSecret === '' || given === '') return false;
  const expected = Buffer.from(lineSignature(rawBody, channelSecret));
  const got = Buffer.from(given);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** The numeric Channel ID shown in the LINE console (a bot's user id, which starts with `U`, is not one). */
export const isNumericChannelId = (v: string | null | undefined): boolean => /^\d+$/.test(v ?? '');
