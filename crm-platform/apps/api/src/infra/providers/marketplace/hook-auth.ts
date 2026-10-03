import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authentication of a delivery to a connection's public address. Two ways, both over a secret only the connection and its sender know:
 *  - token: the sender repeats the secret in a header (Zapier, Make and most form tools can set a header, few can compute a signature);
 *  - hmac: the sender signs the exact bytes of the body with HMAC-SHA256 and sends `sha256=<hex>` (what a developer can do in code).
 * Comparisons are constant time. Nothing here logs or returns the secret.
 */

const equalText = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  // timingSafeEqual needs equal lengths; comparing against a same-length buffer first keeps the work independent of where they differ.
  return x.length === y.length && timingSafeEqual(x, y);
};

export function hmacHex(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** `sha256=<hex>` or a bare hex digest. */
export function signatureMatches(
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const given = header
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  return equalText(given, hmacHex(secret, body));
}

export function tokenMatches(secret: string, header: string | undefined): boolean {
  if (!header) return false;
  return equalText(header.trim().replace(/^Bearer\s+/i, ''), secret);
}

/** A new connection secret: 32 random bytes, URL-safe, with a prefix that says what it is when it turns up in a log or a chat. */
export function newConnectionSecret(): string {
  return `mkt_${randomBytes(32).toString('base64url')}`;
}

/** The 32 hex characters that name a connection in its address. */
export function newPublicKey(): string {
  return randomBytes(16).toString('hex');
}

/** What the page shows for a secret that is set: the last four characters. */
export const secretHint = (secret: string): string => `ends in ${secret.slice(-4)}`;
