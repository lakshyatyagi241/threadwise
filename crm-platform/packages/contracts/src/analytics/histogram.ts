/** Upper edges (ms) of the latency buckets. Bucket i holds [edges[i-1], edges[i]); the last bucket is open ended. 15 buckets. */
export const LATENCY_EDGES_MS = [
  1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000,
  21_600_000, 43_200_000, 86_400_000,
] as const;

export function histBucket(valueMs: number, edges: readonly number[] = LATENCY_EDGES_MS): number {
  let i = 0;
  while (i < edges.length && valueMs >= edges[i]!) i += 1;
  return i;
}

/**
 * The upper edge of the bucket holding the p-th item (0 < p <= 1), or null for an empty histogram.
 * The open last bucket reports its lower edge.
 */
export function percentileFromBuckets(
  counts: readonly number[],
  p: number,
  edges: readonly number[] = LATENCY_EDGES_MS,
): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil(p * total));
  let seen = 0;
  for (let i = 0; i < counts.length; i += 1) {
    seen += counts[i]!;
    if (seen >= rank) return i < edges.length ? edges[i]! : edges[edges.length - 1]!;
  }
  return edges[edges.length - 1]!;
}
