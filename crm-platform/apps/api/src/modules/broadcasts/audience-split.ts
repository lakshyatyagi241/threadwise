/**
 * Splits one audience across the picked senders by weight (WD-BCAST-014).
 *
 * Carried over from WaDesk: a missing or non-positive weight counts as 1; each sender gets floor(share of the
 * total), and the leftover goes one at a time to the senders with the largest fractional part (ties to the sender
 * picked first), so the split is within 1 of the exact weighted ideal and the sizes always add up to the total.
 * Buckets are sequential slices, so each contact lands in exactly one.
 */
export function splitSizes(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
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
