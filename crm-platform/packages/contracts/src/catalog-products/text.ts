import { z } from 'zod';
import { trimEdges } from '../common/trim-edges';

/**
 * Reference trims every text input it receives (Laravel's TrimStrings) of leading and trailing whitespace, separators and
 * invisible format characters (zero-width space, joiner, left-to-right mark, soft hyphen, BOM). `String.prototype.trim` leaves
 * the format characters and the next-line control behind, so a name typed as "Tee" plus a zero-width joiner would be stored with
 * it. Control characters other than whitespace and private-use characters are kept, as Reference keeps them.
 */
const EDGE = /^[\s\u0085\p{Z}\p{Cf}]$/u;

export function trimLikeThreadwise(value: string): string {
  return trimEdges(value, (c) => EDGE.test(c));
}

/** A text field trimmed the Reference way before its length is checked; `min` 1 makes it required. */
export function waString(max: number, min = 0) {
  const base = z.string().max(max);
  return z.preprocess(
    (v) => (typeof v === 'string' ? trimLikeThreadwise(v) : v),
    min > 0 ? base.min(min) : base,
  );
}

/**
 * PHP's `trim()` default: space, tab, line feed, carriage return, NUL and vertical tab, nothing else. Reference cuts the tags box
 * into parts and trims each part with it, so a zero-width character inside the box survives next to a comma.
 */
export function trimLikePhp(value: string): string {
  // NUL and vertical tab are exactly what PHP's trim() strips
  return trimEdges(value, (c) => ' \t\n\r\0\x0B'.includes(c));
}

/** One tag as Reference keeps it: the part between two commas, trimmed the PHP way. */
export function waTag(max: number) {
  return z.preprocess((v) => (typeof v === 'string' ? trimLikePhp(v) : v), z.string().max(max));
}
