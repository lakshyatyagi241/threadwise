import { createHmac, randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * `length` random letters and digits. `randomInt` draws without modulo bias; 22 characters of a 62-letter alphabet is about 131 bits, so a
 * key cannot be guessed or enumerated.
 */
export function randomToken(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** The only identifier of a form that appears in a public URL (22 characters, see FORM_PUBLIC_KEY in the contracts). */
export const newPublicKey = (): string => randomToken(22);

/** The receipt a visitor gets for a submission: a handle for the thank-you page, not a credential for anything. */
export const newReceiptToken = (): string => randomToken(22);

/**
 * A raw client address is never stored: this is an HMAC of it keyed by a secret and the UTC day, so the same address correlates within a
 * day (a flood from one source is countable) and means nothing to anyone who reads the table later. The salt rotates daily by construction.
 */
export function hashIp(
  ip: string | undefined,
  secret: string,
  now: Date = new Date(),
): string | null {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10);
  return createHmac('sha256', `${secret}:${day}`).update(ip).digest('hex').slice(0, 32);
}
