import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeStage, samplesFor, summarise } from './load-report.mjs';

const budgets = {
  errorRate: 0.01,
  latency: { A: { p95: 50 }, B: { p95: 150 }, C: { p95: 300 } },
  load: { baselineUsers: 500, usableP95Ms: 2000 },
};
const stage = (users, over = {}) => ({
  users,
  requests: users * 10,
  rps: users / 5,
  failedRate: 0,
  all: { p50: 10, p95: 40 },
  classes: { A: { p95: 30 }, B: { p95: 90 }, C: { p95: 200 } },
  ...over,
});
const result = (...s) => ({
  stages: Object.fromEntries(s.map((x) => [x.users, x])),
  meta: {
    users: s.map((x) => x.users),
    ramp: 60,
    hold: 180,
    stageSeconds: 250,
    endedAt: 1_000_000,
  },
});

test('a clean stage is inside the budgets and usable', () => {
  const v = judgeStage(stage(100), budgets);
  assert.deepEqual([v.inBudget, v.usable], [true, true]);
});
test('a class over its p95 is out of the budgets but can still be usable', () => {
  const v = judgeStage(
    stage(250, { classes: { A: { p95: 900 }, B: { p95: 90 } }, all: { p95: 800 } }),
    budgets,
  );
  assert.deepEqual([v.inBudget, v.usable], [false, true]);
  assert.match(v.why[0], /A 900 ms/);
});
test('errors over the ceiling fail both verdicts', () => {
  const v = judgeStage(stage(500, { failedRate: 0.05 }), budgets);
  assert.deepEqual([v.inBudget, v.usable], [false, false]);
});
test('a slow all-requests p95 is not usable', () => {
  assert.equal(judgeStage(stage(500, { all: { p95: 5000 } }), budgets).usable, false);
});
test('a missing error rate never counts as a pass', () =>
  assert.equal(judgeStage(stage(100, { failedRate: null }), budgets).inBudget, false));
test('the highest stage is the last one before the first that fails, and the baseline is found', () => {
  const r = result(
    stage(100),
    stage(250, { classes: { A: { p95: 900 } }, all: { p95: 800 } }),
    stage(500, { failedRate: 0.2 }),
  );
  const s = summarise(r, budgets);
  assert.equal(s.maxInBudget, 100);
  assert.equal(s.maxUsable, 250);
  assert.equal(s.baseline.inBudget, false);
});
test('sampler readings are windowed to the hold of one stage', () => {
  const meta = { users: [100, 200], ramp: 60, hold: 180, stageSeconds: 250, endedAt: 1_000_000 };
  const start0 = meta.endedAt - 2 * 250 * 1000;
  const samples = [
    { at: start0 + 10_000, systemCpuPct: 99 },
    { at: start0 + 100_000, systemCpuPct: 40 },
    { at: start0 + 255_000, systemCpuPct: 70 },
  ];
  assert.equal(samplesFor(samples, meta, 0).systemCpuPct, 40);
  assert.equal(samplesFor([], meta, 0), null);
});
