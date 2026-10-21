// Consistency of docs/performance/cache/invalidation-results.json: every measured stale time is within its documented bound
// (tolerance max(0.5 s, 2%) for timer granularity: the measurements overshoot a TTL by 0.01 to 0.3 s), and the matrix/ratchet sections exist.
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const bad = [];
let n = 0;
for (const [k, v] of Object.entries(j.measured ?? {})) {
  if (v.measuredStaleSeconds == null || v.documentedSeconds == null) continue;
  n++;
  const tol = Math.max(0.5, v.documentedSeconds * 0.02);
  if (v.measuredStaleSeconds > v.documentedSeconds + tol) bad.push(`${k}: ${v.measuredStaleSeconds} > ${v.documentedSeconds} (+${tol})`);
}
if (!Array.isArray(j.matrix) || !j.matrix.length) bad.push('matrix section missing or empty');
if (!j.ratchet) bad.push('ratchet section missing');
console.log(`checked ${n} measured bounds, ${j.matrix?.length ?? 0} matrix rows; open items: ${(j.open ?? []).length}`);
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
