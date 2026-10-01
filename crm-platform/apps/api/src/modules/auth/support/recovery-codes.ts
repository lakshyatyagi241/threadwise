import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;

/** "K7QH2-9WXMD": ten characters from an alphabet without look-alikes. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

/** Codes are compared without case or the separator, so users can type them loosely. */
export const normalizeRecoveryCode = (code: string): string =>
  code.replace(/[\s-]/g, '').toUpperCase();

export async function createRecoveryCodes(): Promise<{ plain: string[]; hashes: string[] }> {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const hashes = await Promise.all(plain.map((c) => hash(normalizeRecoveryCode(c))));
  return { plain, hashes };
}

/**
 * If `candidate` matches one of the stored hashes, returns the remaining
 * hashes (the used code is gone: single use). Otherwise null.
 */
export async function consumeRecoveryCode(
  hashes: string[],
  candidate: string,
): Promise<string[] | null> {
  const normalized = normalizeRecoveryCode(candidate);
  if (normalized.length !== 10) return null;
  for (let i = 0; i < hashes.length; i++) {
    const ok = await verify(hashes[i]!, normalized).catch(() => false);
    if (ok) return hashes.filter((_, idx) => idx !== i);
  }
  return null;
}
