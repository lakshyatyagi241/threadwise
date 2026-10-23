import { createHash } from 'node:crypto';

/**
 * The ids the wallet charges a usage under. A charge is idempotent on its id: the same id never takes money twice, so a retried job, a
 * replayed event or a double click pays once. That only holds when the id is DERIVED from what identifies the work (a flow step, a
 * message, a batch of passages), never from the clock or a random number taken per attempt.
 */

/** The wallet's usage-id column holds 191 characters and the billing key prefixes it with the kind: stay well under. */
const MAX_USAGE_ID = 150;

/** A short, stable fingerprint of any text (hex, 32 characters = 128 bits). */
export function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/**
 * Joins the parts of an id with `:`. A readable id stays readable (`flow:<run>:<step>:<node>:turn`); one that would be too long (a node
 * id with a long name) is replaced by its own fingerprint, which is just as stable.
 */
export function stableUsageId(...parts: ReadonlyArray<string | number>): string {
  const joined = parts.map(String).join(':');
  return joined.length <= MAX_USAGE_ID ? joined : `h:${fingerprint(joined)}`;
}
