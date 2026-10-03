import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * `length` random alphanumeric characters from a CSPRNG (Laravel `Str::random(40)`): the order's tracking token, the only
 * access control of the public tracking page. `randomInt` is uniform, so no character is more likely than another.
 */
export function randomToken(length = 40): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
