import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBudget } from './memory-budget-check.mjs';
import { percentile, summarize } from './memory-profile.mjs';

const profile = { bootMb: { api: { rssMb: 400 } }, loadWindow: { api: { rssMb: { p95: 900 } } } };
const limits = (a, b) => ({
  limits: [
    { id: 'boot', path: 'bootMb.api.rssMb', max: a },
    { id: 'p95', path: 'loadWindow.api.rssMb.p95', max: b },
  ],
});

test('passes when every metric is within its limit (equal counts as within)', () => {
  assert.ok(checkBudget(profile, limits(400, 1000)).every((r) => r.ok));
});

test('fails the exceeded metric only', () => {
  assert.deepEqual(
    checkBudget(profile, limits(399, 1000)).map((r) => r.ok),
    [false, true],
  );
});

test('a metric missing from the profile fails instead of being skipped', () => {
  const r = checkBudget({}, limits(1, 1));
  assert.ok(r.every((x) => !x.ok));
});

test('nearest-rank percentiles and the warm-up cut', () => {
  const xs = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(xs, 50), 50);
  assert.equal(percentile(xs, 95), 95);
  assert.equal(percentile(xs, 99), 99);
  assert.ok(Number.isNaN(percentile([], 50)));
  const row = (t, rssMb, gc = 0) => ({ proc: 'api', t, gc, rssMb, heapUsedMb: rssMb / 2 });
  const s = summarize([row(1, 999), row(100, 10), row(105, 20), row(110, 30, 1)], 60);
  assert.equal(s.api.rssMb.max, 30); // the t=1 boot-time row is outside the load window
  assert.equal(s.api.heapUsedMb.n, 2); // GC samples are kept out of the working-level heap percentiles
});
