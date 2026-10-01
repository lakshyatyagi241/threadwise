import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** URL-safe random token. 32 bytes = 256 bits, far beyond guessing. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still burn a comparison so length is not a free timing signal.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Numeric code of exactly `length` digits, zero-padded, cryptographically random. */
export function randomNumericCode(length: number): string {
  const max = 10 ** length;
  // Rejection sampling: modulo of a 32-bit value would bias the low codes.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < limit) return String(n % max).padStart(length, '0');
  }
}
