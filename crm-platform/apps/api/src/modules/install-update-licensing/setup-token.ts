import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of the presented setup token with the configured one. Both sides are hashed first so the
 * comparison is over equal-length buffers: comparing raw strings would leak the secret's length through timing, and
 * `timingSafeEqual` throws on unequal lengths.
 */
export function setupTokenMatches(presented: string, configured: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(configured).digest();
  return timingSafeEqual(a, b);
}
