// Sheet3 D-06: the weekly digest. Run: node --test tools/chat-bridge/digest.unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigest, digestCfg, digestDue, digestMessage, weeklyTop } from './digest.mjs';

const cfg = digestCfg({});
const MON_9 = Date.UTC(2026, 9, 26, 9, 5); // Monday 26 Oct 2026 09:05 UTC
const DAY = 86400_000;
const snap = (o) =>
  new Map(
    Object.entries(o).map(([k, [calls, total, max, q]]) => [
      k,
      { calls, total, max: max ?? 1, q: q ?? 'select 1' },
    ]),
  );

test('due only in the configured hour of the configured weekday, once a week', () => {
  assert.equal(digestDue(MON_9, null, cfg), true);
  assert.equal(digestDue(MON_9 + 3600_000, null, cfg), false); // 10:05
  assert.equal(digestDue(MON_9 + DAY, null, cfg), false); // Tuesday
  assert.equal(digestDue(MON_9 + 30 * 60_000, MON_9, cfg), false); // already sent this hour
  assert.equal(digestDue(MON_9 + 7 * DAY, MON_9, cfg), true); // next Monday
});

test('ranked by database time of the week, not by the slowest call or the lifetime total', () => {
  const ref = snap({ a: [1000, 10_000], b: [10, 100], c: [5, 50] });
  const cur = snap({ a: [1100, 10_500], b: [12, 3100], c: [5, 50] }); // a: 100 calls 500 ms; b: 2 calls 3000 ms; c: none
  const w = weeklyTop(ref, cur, { top: 5 });
  assert.deepEqual(
    w.top.map((r) => r.id),
    ['b', 'a'],
  ); // c had no calls this week
  assert.equal(w.top[0].meanMs, 1500);
  assert.equal(w.top[1].calls, 100);
  assert.equal(Math.round(w.top[0].share * 100), 86); // 3000 of 3500 ms
});

test('a new statement counts fully, one whose counters went backwards (reset) uses its current value, and skip drops maintenance', () => {
  const w = weeklyTop(
    snap({ a: [100, 1000] }),
    snap({ a: [4, 40], n: [3, 300], vac: [9, 9000, 1, 'vacuum t'] }),
    {
      skip: (q) => q.startsWith('vacuum'),
    },
  );
  assert.deepEqual(w.top.map((r) => [r.id, r.calls]).sort(), [
    ['a', 4],
    ['n', 3],
  ]);
  assert.equal(w.statements, 2);
});

test('no baseline: the counters themselves (since the statistics reset)', () => {
  const w = weeklyTop(null, snap({ a: [10, 500] }));
  assert.equal(w.top[0].calls, 10);
});

test('the message flags statements over the mean threshold and says what period it covers', () => {
  const m = digestMessage(
    weeklyTop(null, snap({ a: [10, 5000, 900, 'select * from t where id = $1'], b: [1000, 1000] })),
    { sinceLabel: 'last 7 days', thresholdMs: 120 },
  );
  assert.match(m.text, /Weekly database digest: 2 statements/);
  const rows = JSON.stringify(m.cardsV2);
  assert.equal((rows.match(/mean over 120 ms/g) ?? []).length, 1); // a: mean 500 ms is flagged, b: 1 ms is not
  assert.match(m.cardsV2[0].card.header.subtitle, /last 7 days/);
});

test('empty period still produces a plain message', () => {
  assert.match(
    digestMessage(weeklyTop(null, new Map()), { sinceLabel: 'x', thresholdMs: 120 }).text,
    /Nothing ran/,
  );
});

// A fake database: pg_stat_statements counters the test moves forward.
function fakeDb() {
  const st = {
    rows: [{ queryid: '1', calls: 100, total_exec_time: 1000, max_exec_time: 50, q: 'select a' }],
    reset: new Date('2026-10-01'),
  };
  const query = async (sql) =>
    /pg_stat_statements_info/.test(sql) ? { rows: [{ stats_reset: st.reset }] } : { rows: st.rows };
  return { st, query };
}

test('first digest after a start covers the time since the statistics reset; the next one is a full week', async () => {
  const { st, query } = fakeDb();
  const sent = [];
  let t = MON_9 - 3 * DAY;
  const d = createDigest({
    query,
    send: async (ch, body) => sent.push([ch, body]),
    now: () => t,
    env: {},
  });
  await d.tick(); // baseline, not due (Friday)
  assert.equal(sent.length, 0);
  t = MON_9;
  st.rows = [
    { queryid: '1', calls: 130, total_exec_time: 4000, max_exec_time: 900, q: 'select a' },
  ];
  assert.equal(await d.tick(), true);
  assert.equal(sent[0][0], 'slowquery');
  assert.match(sent[0][1].text, /since statistics reset 2026-10-01/);
  assert.equal(await d.tick(), false); // same hour: not again

  t = MON_9 + 7 * DAY;
  st.rows = [
    { queryid: '1', calls: 230, total_exec_time: 4500, max_exec_time: 900, q: 'select a' },
  ];
  assert.equal(await d.tick(), true);
  assert.match(sent[1][1].text, /last 7 days/);
  assert.match(JSON.stringify(sent[1][1]), /100 calls/); // 230 - 130, this week only
});

test('a failing database is logged and retried, never thrown; SLOW_DIGEST=0 turns it off', async () => {
  const logs = [];
  const t = MON_9;
  const bad = createDigest({
    query: async () => {
      throw Object.assign(new Error('x'), { code: '57014' });
    },
    send: async () => {},
    log: (l) => logs.push(l),
    now: () => t,
    env: {},
  });
  assert.equal(await bad.tick(), false);
  assert.equal(logs[0].evt, 'digest_error');
  const off = createDigest({
    query: async () => ({ rows: [] }),
    send: async () => assert.fail('sent'),
    now: () => t,
    env: { SLOW_DIGEST: '0' },
  });
  assert.equal(await off.tick(), false);
});
