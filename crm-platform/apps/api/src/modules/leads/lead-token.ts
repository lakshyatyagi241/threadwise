import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The credential of a lead hook: a 256-bit random token in the URL. Only its SHA-256 is stored (`lead_sources.token_hash`), so a copy of
 * the database cannot be turned into working hook URLs; the token is shown once, at creation and at rotation. A fast hash is right here:
 * the token is random, not a password a person chose, so there is nothing to brute-force that a slow hash would slow down.
 */
export const generateLeadToken = (): string => randomBytes(32).toString('base64url');

export const hashLeadToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** The shape of a token we issue: anything else cannot be one, and is answered 404 without a lookup. */
export const looksLikeLeadToken = (raw: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(raw);

/** The last characters, for "ends in ####": enough to tell two URLs apart, not enough to guess one. */
export const leadTokenHint = (token: string): string => token.slice(-4);

/**
 * Constant-time comparison of a presented shared secret with the stored one. Both are hashed first so the comparison is over equal-length
 * buffers whatever the caller sent (timingSafeEqual throws on a length mismatch, and a length check alone would leak the length).
 */
export function secretMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
