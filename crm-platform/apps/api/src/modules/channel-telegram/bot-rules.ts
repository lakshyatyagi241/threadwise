import { randomBytes } from 'node:crypto';

/** Pure helpers for connecting a bot (TW-TG-002). */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A URL-safe random string of `length` characters (48 for the routing token and the header secret). */
export function randomToken(length = 48): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** The address Telegram pushes to. Telegram rejects plain http, so it is forced to https. */
export function webhookUrl(appUrl: string, routingToken: string): string {
  const base = appUrl.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  return `${base}/v2/telegram/inbound/${routingToken}`;
}

/** Errors are kept to 255 characters on the row. */
export const clipError = (s: string | null | undefined): string | null =>
  s ? s.slice(0, 255) : null;

/** What the operator reads when Telegram refuses the webhook (TW-TG-002 rule 6). */
export function webhookRefusedMessage(why: string): string {
  return `Saved the bot, but Telegram refused the webhook: ${why} — the URL must be public HTTPS. On a local machine, use a tunnel (ngrok / Cloudflare Tunnel).`;
}
