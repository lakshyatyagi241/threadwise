import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classVerdicts, mergeRuns, median, rank, regressions } from './rank.mjs';

const budgets = { latency: { A: { p95: 50, p99: 120 }, B: { p95: 150, p99: 400 }, C: { p95: 300, p99: 800 } }, regression: { share: 0.2, minMs: 20 } };
const run = (eps, classes = {}) => ({ http: { failedRate: 0 }, classes, endpoints: eps });
const ep = (cls, p95, p50 = p95 / 2, p99 = p95 * 1.2) => ({ class: cls, p50, p95, p99, count: 100 });

test('median of an odd and an even list, ignoring gaps', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([null, 5, undefined]), 5);
  assert.equal(median([]), null);
});

test('repeat runs are merged by the median, so one slow run does not decide', () => {
  const merged = mergeRuns([run({ 'GET /a': ep('A', 40) }), run({ 'GET /a': ep('A', 400) }), run({ 'GET /a': ep('A', 42) })]);
  assert.equal(merged.runs, 3);
  assert.equal(merged.endpoints['GET /a'].p95, 42);
  assert.equal(merged.endpoints['GET /a'].class, 'A');
});

test('ranking puts the endpoint furthest over its own class budget first', () => {
  const merged = mergeRuns([run({ 'GET /fast': ep('A', 20), 'GET /slow-a': ep('A', 500), 'POST /b': ep('B', 300), 'GET /report': ep('C', 310) })]);
  const r = rank(merged, budgets);
  assert.deepEqual(r.map((e) => e.route), ['GET /slow-a', 'POST /b', 'GET /report', 'GET /fast']);
  assert.equal(r[0].ratio, 10);
});

test('an endpoint without a class is left out of the ranking, not guessed', () => {
  const merged = mergeRuns([run({ 'GET /x': { p95: 10, count: 1 } })]);
  assert.equal(rank(merged, budgets).length, 0);
});

test('class verdicts: p95 decides the pass, p99 is only reported', () => {
  const merged = mergeRuns([run({}, { A: { p50: 5, p95: 49, p99: 300 }, B: { p50: 5, p95: 151, p99: 200 } })]);
  const v = Object.fromEntries(classVerdicts(merged, budgets).map((x) => [x.class, x]));
  assert.equal(v.A.p95Pass, true);
  assert.equal(v.A.p99Over, true);
  assert.equal(v.B.p95Pass, false);
});

test('regression needs both the share and the minimum change', () => {
  const baseline = { endpoints: { 'GET /big': ep('A', 100), 'GET /tiny': ep('A', 5), 'GET /same': ep('A', 100), 'GET /gone': ep('A', 100) } };
  const merged = mergeRuns([run({ 'GET /big': ep('A', 130), 'GET /tiny': ep('A', 12), 'GET /same': ep('A', 110), 'GET /new': ep('A', 999) })]);
  const regs = regressions(merged, baseline, budgets);
  assert.deepEqual(regs.map((r) => r.route), ['GET /big']);
  assert.equal(regs[0].diff, 30);
});

test('a deliberately slowed endpoint is caught against the baseline', () => {
  const baseline = { endpoints: { 'GET /contacts': ep('A', 30) } };
  const slowed = mergeRuns([run({ 'GET /contacts': ep('A', 30 + 200) })]);
  assert.equal(regressions(slowed, baseline, budgets).length, 1);
});
