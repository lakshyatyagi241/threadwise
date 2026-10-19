// Percentiles of a list of timings in milliseconds (nearest-rank, so a small sample reports a time that really happened).
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function summarize(times) {
  const s = [...times].sort((a, b) => a - b);
  return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), max: s[s.length - 1] };
}
