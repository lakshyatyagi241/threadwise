// Run: node --test tools/api-inventory/compare-sweeps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, rank } from './compare-sweeps.mjs';

const t = (query, calls, meanMs) => ({
  query,
  calls,
  meanMs,
  maxMs: meanMs * 1.2,
  totalMs: calls * meanMs,
  rows: calls,
});

test('ranks by total time, not by mean', () => {
  const r = rank([
    t('select slow', 1, 500),
    t('select chatty', 1000, 1),
    t('select tiny', 10, 0.5),
  ]);
  assert.deepEqual(
    r.rows.map((x) => x.key),
    ['select chatty', 'select slow', 'select tiny'], // 1000, 500, 5 ms in total
  );
});

test("reports each statement's share and the running share", () => {
  const r = rank([t('select slow', 1, 500), t('select chatty', 1000, 1)]);
  assert.equal(r.rows[0].key, 'select chatty');
  assert.equal(Math.round(r.rows[0].share * 100), 67);
  assert.equal(Math.round(r.rows[1].cumulative * 100), 100);
});

test('whitespace differences do not make two copies of a statement different', () => {
  const c = compare([t('select\n  a   from x', 4, 10)], [t('select a from x', 4, 2)]);
  assert.equal(c.top[0].gone, false);
  assert.equal(c.top[0].afterMeanMs, 2);
});

test('a statement missing from the after run is gone; without an after run nothing is claimed', () => {
  const before = [t('select a', 8, 100), t('select b', 8, 10)];
  const c = compare(before, [t('select b', 8, 10)], 5);
  assert.deepEqual(
    c.top.map((x) => [x.key, x.gone, x.afterMeanMs]),
    [
      ['select a', true, null],
      ['select b', false, 10],
    ],
  );
  assert.equal(c.after.totalMs, 80);
  const solo = compare(before, null, 5);
  assert.equal(solo.after, null);
  assert.equal(solo.top[0].gone, undefined);
});

test('top limits the list', () => {
  const rows = Array.from({ length: 30 }, (_, i) => t(`select ${i}`, 1, i + 1));
  assert.equal(compare(rows, null, 20).top.length, 20);
  assert.equal(compare(rows, null).top[0].key, 'select 29');
});
