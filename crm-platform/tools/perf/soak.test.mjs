import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSlope, isSustained, diffSnapshots } from './soak.mjs';

test('flat series is not flagged, growing series is', () => {
  const t = Array.from({ length: 40 }, (_, i) => i / 360);
  const flat = fitSlope(t, t.map((_, i) => 100 + (i % 2)));
  assert.equal(isSustained(flat, 10), false);
  const grow = fitSlope(t, t.map((x) => 100 + 500 * x));
  assert.ok(Math.abs(grow.slope - 500) < 1e-6);
  assert.equal(isSustained(grow, 10), true);
});

test('snapshot diff ranks by bytes', () => {
  const a = new Map([['A', { n: 1, bytes: 10 }]]);
  const b = new Map([['A', { n: 3, bytes: 50 }], ['B', { n: 1, bytes: 5 }]]);
  assert.equal(diffSnapshots(a, b)[0].name, 'A');
});
