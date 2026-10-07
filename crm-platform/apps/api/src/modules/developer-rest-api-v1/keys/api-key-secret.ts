import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { API_KEY_PREFIX } from '@crm/contracts';

/** `wsk_` plus 40 random characters, as in Reference, so a client that pattern-matches a key keeps working (TW-API-001). */
const RANDOM_LENGTH = 40;
/** What the console shows and what the lookup uses: the first 12 characters of the raw key (Reference `prefix`). */
export const KEY_PREFIX_LENGTH = 12;
/** Stored before the hex digest, so the hash column says how it was made (the partner keys there are argon2). */
const HASH_TAG = 'sha256$';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** The largest multiple of 62 below 256: a byte at or above it is thrown away so every character is equally likely. */
const UNBIASED_BELOW = 248;

/** Random characters without modulo bias: ~190 bits for 40 characters. */
export function randomKeyBody(length = RANDOM_LENGTH): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= UNBIASED_BELOW) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function generateRawKey(): string {
  return `${API_KEY_PREFIX}${randomKeyBody()}`;
}

export function keyPrefixOf(raw: string): string {
  return raw.slice(0, KEY_PREFIX_LENGTH);
}

/**
 * sha256, not argon2, on purpose: the secret is 40 random characters, so there is nothing for a slow hash to protect against, and an
 * argon2 verify on every call of a polled API would be a CPU lever for anyone who can send requests.
 */
export function hashRawKey(raw: string): string {
  return HASH_TAG + createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Constant-time compare of a presented key with a stored hash. A stored value that is not a sha256 hash (a partner key) never matches. */
export function rawKeyMatches(raw: string, storedHash: string): boolean {
  if (!storedHash.startsWith(HASH_TAG)) return false;
  const a = Buffer.from(hashRawKey(raw));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cheap shape check before any lookup: a token that cannot be one of ours never reaches the database. */
export function looksLikeRawKey(raw: string): boolean {
  return raw.length === API_KEY_PREFIX.length + RANDOM_LENGTH && /^wsk_[A-Za-z0-9]{40}$/.test(raw);
}
