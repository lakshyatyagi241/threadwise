import { isIP } from 'node:net';
import { normalizeIp } from '../support/ip';

/**
 * Strict reading of an allowlist entry (TW-AUTH-038): an address, or an address,
 * ONE slash and a plain decimal prefix that fits the family. Anything else is
 * malformed.
 *
 * It exists because a lenient reader turns typos into the widest rule there is:
 * `Number('')` is 0, so `10.0.0.5/` reads as `/0`, which matches every address.
 * A malformed entry must be refused when it is saved, and must never match
 * anything if one is found already stored.
 */
export function isStrictAllowlistEntry(entry: string): boolean {
  const text = entry.trim();
  const parts = text.split('/');
  if (parts.length > 2) return false;
  const [base, prefix] = parts;
  if (!base || base !== base.trim()) return false;

  const family = isIP(base);
  // A bare address may be written in the IPv4-mapped form; a range may not (its
  // prefix would be ambiguous between the two readings).
  if (prefix === undefined) return normalizeIp(base) !== null;
  if (family === 0 || normalizeIp(base) !== base) return false;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * What an entry that is not strictly valid becomes when read back from storage.
 * `ipMatches` never matches a base it cannot parse, so this keeps the list's
 * length (a list of only bad entries must not turn into "empty = everyone
 * allowed") while matching nothing.
 */
export const NEUTRALISED_PREFIX = 'invalid:';

export function neutraliseAllowlist(entries: readonly string[]): {
  entries: string[];
  rejected: string[];
} {
  const rejected: string[] = [];
  const out = entries.map((e) => {
    if (isStrictAllowlistEntry(e)) return e;
    rejected.push(e);
    return `${NEUTRALISED_PREFIX}${e}`;
  });
  return { entries: out, rejected };
}
