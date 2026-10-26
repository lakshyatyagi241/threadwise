// Sheet3 D-04: the watcher's windowed statement mean (delta of total time over delta of calls between two snapshots).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatcher, windowedMeans } from './watcher.mjs';

const snap = (o) =>
  new Map(
    Object.entries(o).map(([k, [calls, total, q]]) => [k, { calls, total, q: q ?? 'select 1' }]),
  );

test('the mean is over the new calls only, not the lifetime of the statement', () => {
  // 1000 fast calls, then 5 slow ones: lifetime mean ~ 5.5 ms, window mean 300 ms
  const ref = snap({ a: [1000, 5000] });
  const cur = snap({ a: [1005, 6500] });
  const w = windowedMeans(ref, cur, { minCalls: 3, thresholdMs: 120 });
  assert.equal(Math.round(w.maxMs), 300);
  assert.equal(w.over, 1);
  assert.equal(w.top[0].calls, 5);
});

test('fewer than minCalls new calls is not a trend', () => {
  const w = windowedMeans(snap({ a: [10, 100] }), snap({ a: [12, 2100] }), {
    minCalls: 3,
    thresholdMs: 120,
  });
  assert.equal(w.over, 0);
  assert.equal(w.maxMs, 0);
});

test('a statement that is new since the baseline counts all its calls, one whose counters reset is skipped', () => {
  // b did not exist at the baseline: 5 calls of 300 ms since then is a slow window. a was reset (fewer calls than before): no basis.
  const w = windowedMeans(snap({ a: [100, 9000] }), snap({ a: [5, 10], b: [5, 1500] }), {
    minCalls: 3,
    thresholdMs: 120,
  });
  assert.equal(w.over, 1);
  assert.deepEqual(
    w.top.map((x) => x.id),
    ['b'],
  );
});

test('maintenance statements are skipped through skip()', () => {
  const ref = snap({ a: [0, 0, 'vacuum t'], b: [0, 0, 'select 2'] });
  const cur = snap({ a: [5, 5000, 'vacuum t'], b: [5, 100, 'select 2'] });
  const w = windowedMeans(ref, cur, {
    minCalls: 3,
    thresholdMs: 120,
    skip: (id, q) => /^vacuum/.test(q),
  });
  assert.equal(w.over, 0);
  assert.equal(Math.round(w.maxMs), 20);
});

test('only statements at or over the threshold are counted, the worst first', () => {
  const ref = snap({ a: [0, 0], b: [0, 0], c: [0, 0] });
  const cur = snap({ a: [10, 500], b: [10, 1500], c: [10, 1250] }); // 50, 150, 125 ms
  const w = windowedMeans(ref, cur, { minCalls: 3, thresholdMs: 120 });
  assert.equal(w.over, 2);
  assert.deepEqual(
    w.top.map((x) => x.id),
    ['b', 'c'],
  );
});

// createWatcher end to end with a fake database: polls a known time apart.
function harness(winRowsByPoll) {
  let poll = -1;
  const gauges = {},
    logs = [];
  const query = async (sql) => {
    if (sql.includes('left(query, 160)'))
      return { rows: winRowsByPoll[Math.min(poll, winRowsByPoll.length - 1)] };
    return { rows: [] }; // no running queries, no slow lifetime statements
  };
  let t = 1_000_000;
  const w = createWatcher({
    query,
    env: {},
    metrics: { set: (n, _t, v) => (gauges[n] = v), inc: () => {} },
    send: async () => {},
    log: (e) => logs.push(e),
    now: () => t,
  });
  return {
    gauges,
    logs,
    async next(advanceMs) {
      poll++;
      t += advanceMs;
      await w.poll();
    },
  };
}

test('the watcher publishes the window mean and how many statements are over 120 ms', async () => {
  const h = harness([
    [{ queryid: '1', calls: 100, total_exec_time: 1000, q: 'select * from t where id = $1' }],
    [{ queryid: '1', calls: 105, total_exec_time: 2500, q: 'select * from t where id = $1' }], // 5 new calls, 300 ms each
  ]);
  await h.next(0);
  assert.equal(h.gauges.crm_slow_query_window_statements_over, 0); // first snapshot: nothing to compare with yet
  await h.next(60_000);
  assert.equal(h.gauges.crm_slow_query_window_statements_over, 1);
  assert.equal(Math.round(h.gauges.crm_slow_query_window_mean_max_seconds * 1000), 300);
  assert.ok(h.logs.some((l) => l.evt === 'slow_statement_window_mean' && l.over === 1));
});

test('once the slow calls fall out of the window the gauge returns to 0', async () => {
  const slow = { queryid: '1', calls: 105, total_exec_time: 2500, q: 'select 1' };
  const h = harness([
    [{ queryid: '1', calls: 100, total_exec_time: 1000, q: 'select 1' }],
    [slow],
    [{ ...slow, calls: 205, total_exec_time: 2600 }], // 100 fast calls since
  ]);
  await h.next(0);
  await h.next(60_000);
  assert.equal(h.gauges.crm_slow_query_window_statements_over, 1);
  await h.next(301_000); // the earlier snapshots are now older than the 5-minute window
  assert.equal(h.gauges.crm_slow_query_window_statements_over, 0);
});
