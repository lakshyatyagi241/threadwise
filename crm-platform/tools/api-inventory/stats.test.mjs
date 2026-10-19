// Run: node --test tools/api-inventory/stats.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { percentile, summarize } from './stats.mjs';

test('nearest-rank percentiles report a time that really happened', () => {
  const s = [10, 20, 30, 40, 50, 60, 70];
  assert.equal(percentile(s, 50), 40);
  assert.equal(percentile(s, 95), 70);
  assert.equal(percentile(s, 1), 10);
});

test('a single sample is its own p50, p95 and max; an empty list has none', () => {
  assert.deepEqual(summarize([12]), { n: 1, p50: 12, p95: 12, max: 12 });
  assert.equal(percentile([], 95), null);
});

test('summarize does not need sorted input and does not mutate it', () => {
  const t = [30, 10, 20];
  assert.deepEqual(summarize(t), { n: 3, p50: 20, p95: 30, max: 30 });
  assert.deepEqual(t, [30, 10, 20]);
});
