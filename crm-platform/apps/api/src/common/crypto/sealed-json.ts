import type { CryptoService } from './crypto.service';

/**
 * A JSON value sealed with the credentials key (AES-256-GCM), for queue jobs that carry message text or phone numbers: Redis then
 * holds ciphertext, not the message (ASYNC-075/079). `openJson` throws when the blob does not open (a key rotated away, a corrupt
 * value), which a retry would not fix.
 */
export const sealJson = (crypto: Pick<CryptoService, 'encrypt'>, value: unknown): string =>
  crypto.encrypt(JSON.stringify(value));

export const openJson = <T>(crypto: Pick<CryptoService, 'decrypt'>, sealed: string): T =>
  JSON.parse(crypto.decrypt(sealed)) as T;
