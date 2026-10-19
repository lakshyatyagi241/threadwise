import { createHash } from 'node:crypto';
import type { CryptoService } from './crypto.service';

/**
 * Helpers for columns that held a secret in plaintext and now hold it sealed (encryption audit E2, E3, E7, E8).
 *
 * Rollout is expand/contract so a blue-green switch never meets a value its code cannot read:
 *  - reads accept BOTH a sealed value and a legacy plaintext one (`openIfSealed`), and look a token up by its hash first
 *    (`tokenHash`) with the legacy plaintext column as the fallback;
 *  - while `SECRETS_LEGACY_PLAINTEXT_MIRROR` is on (the default) a writer still fills the legacy plaintext column, because the
 *    live slot's code reads it; once the release is the only one running, set it to `off` and run the seal CLI with `--scrub`.
 */

/** A `CryptoService` blob: `v1:<iv>:<tag>:<data>[:<key id>]`. Plaintext tokens and base64url keys never contain a colon after `v1`. */
const SEALED = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*(?::[0-9a-f]{8})?$/;

export const isSealed = (value: string): boolean => SEALED.test(value);

/** The plaintext of a stored value: opened when it is a sealed blob, returned as it is when it is a legacy plaintext one. */
export const openIfSealed = (crypto: Pick<CryptoService, 'decrypt'>, value: string): string =>
  isSealed(value) ? crypto.decrypt(value) : value;

/**
 * Lookup hash of a bearer token or webhook secret: SHA-256 hex. These values are 128 to 240 bits of server-generated randomness, so
 * a plain hash cannot be reversed or guessed, and (unlike a keyed hash) it stays valid across encryption-key rotation. Same shape as
 * the invoice and sales-document `public_token_hash` columns.
 */
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** True while the legacy plaintext column is still written for the benefit of the previous release (the default). */
export const legacyMirrorOn = (): boolean => process.env.SECRETS_LEGACY_PLAINTEXT_MIRROR !== 'off';

/** What a writer stores in the legacy plaintext column: the value while the mirror is on, NULL once it is off (the column is nullable). */
export const legacyValue = (plaintext: string): string | null =>
  legacyMirrorOn() ? plaintext : null;

/** The three columns a hashed-and-sealed token is stored in: the legacy plaintext mirror, the lookup hash and the sealed copy. */
export interface TokenColumns {
  plain: string | null;
  hash: string;
  enc: string;
}

export function tokenColumns(crypto: Pick<CryptoService, 'encrypt'>, token: string): TokenColumns {
  return { plain: legacyValue(token), hash: tokenHash(token), enc: crypto.encrypt(token) };
}

/** The plaintext of a token held in `enc` (preferred) or in the legacy column. */
export function tokenOf(
  crypto: Pick<CryptoService, 'decrypt'>,
  row: { enc?: string | null; plain?: string | null },
): string {
  if (row.enc) return crypto.decrypt(row.enc);
  if (row.plain) return row.plain;
  throw new Error('token column is empty');
}
