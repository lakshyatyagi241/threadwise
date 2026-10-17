import { z } from 'zod';
import { BROADCAST_SHARE_MAX, senderKeySchema } from '../broadcasts/broadcast';

/**
 * Sending one broadcast from several numbers (Reference TW-BCAST-006 and TW-BCAST-014, carried into the Campaign wizard).
 *
 * The admin ticks several connected numbers and gives each a share weight; the audience is cut into one slice per number in proportion
 * to the weights, every contact lands in exactly one slice and is messaged from that slice's number. These functions are the one
 * definition of the rule: the API cuts the recipients with them and the Review step shows the same counts before anyone launches.
 */

/** How many numbers one send can be split across (the broadcast composer allowed the same). */
export const WIZARD_SENDERS_MAX = 50;

/** A weight the split can use: a missing, non-numeric or non-positive weight counts as 1 (Reference), so a "0" in the box still sends. */
export const senderWeight = (w: number | null | undefined): number =>
  typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 1;

/** The weights of a draft: number of picks, each 0..1000 (the box allows 0; the split treats it as 1). */
export const senderShareSchema = z.record(
  senderKeySchema,
  z.number().min(0).max(BROADCAST_SHARE_MAX),
);

/**
 * How many of `total` each weight gets: floor of its share, then the leftover one at a time to the largest fractional parts (ties to the
 * number picked first), so every size is within 1 of the exact ideal and the sizes add up to `total`.
 */
export function splitSizes(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => senderWeight(x));
  const sum = w.reduce((a, b) => a + b, 0);

  const sizes = new Array<number>(n).fill(0);
  const fractions: number[] = [];
  let assigned = 0;
  w.forEach((x, i) => {
    const exact = (x / sum) * total;
    sizes[i] = Math.floor(exact);
    fractions[i] = exact - sizes[i]!;
    assigned += sizes[i]!;
  });

  let remainder = total - assigned;
  const order = fractions.map((f, i) => ({ f, i })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    sizes[i]!++;
    remainder--;
  }
  return sizes;
}

/** `items` cut into sequential slices of the sizes {@link splitSizes} gives, so each item is in exactly one. */
export function splitAudience<T>(items: readonly T[], weights: readonly number[]): T[][] {
  const sizes = splitSizes(items.length, weights);
  const buckets: T[][] = [];
  let cursor = 0;
  for (const size of sizes) {
    buckets.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return buckets;
}

/**
 * The numbers a draft sends from, in order. `senderKeys` is the full list once the person has ticked more than one; a draft that never
 * used it (every draft saved before this existed, and every single-number send) has only `senderKey`. The first is the primary: it is
 * the campaign's own number and the one a test message goes from.
 */
export function wizardSenderPicks(d: {
  senderKey: string | null;
  senderKeys?: readonly string[] | undefined;
}): string[] {
  const list =
    d.senderKeys && d.senderKeys.length > 0 ? d.senderKeys : d.senderKey ? [d.senderKey] : [];
  return [...new Set(list)];
}

/** One line of the split: a number, its weight, and what it gets of an audience. */
export interface SenderSlice {
  key: string;
  weight: number;
  /** Recipients sent from this number. */
  count: number;
  /** Its share of the weights, rounded (the figure beside the weight box). */
  percent: number;
}

/** The split of `total` recipients across the picked numbers by weight. A single pick gets everything. */
export function senderSplit(
  total: number,
  picks: readonly string[],
  share: Readonly<Record<string, number>>,
): SenderSlice[] {
  const weights = picks.map((k) => senderWeight(share[k]));
  const counts = splitSizes(total, weights);
  const sum = weights.reduce((a, b) => a + b, 0);
  return picks.map((key, i) => ({
    key,
    weight: weights[i]!,
    count: counts[i]!,
    percent: sum > 0 ? Math.round((weights[i]! / sum) * 100) : 0,
  }));
}

/** One number's part of a send that was shared across several (the detail and status pages). Absent for a send from one number. */
export const senderBreakdownLineSchema = z.object({
  /** `<engine>:<uuid>`; null when the number has since been removed. */
  key: z.string().nullable(),
  label: z.string(),
  engine: z.string(),
  recipients: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
});
export type SenderBreakdownLine = z.infer<typeof senderBreakdownLineSchema>;
