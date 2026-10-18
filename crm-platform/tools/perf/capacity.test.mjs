import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capacity, dropped, judgeStage } from './capacity.mjs';

const budgets = { errorRate: 0.01, latency: { A: { p95: 50 }, B: { p95: 150 }, C: { p95: 300 } }, regression: { throughputDropShare: 0.1 } };
const stage = (target, over = {}) => ({ target, achieved: target, requests: target * 60, dropped: 0, failedRate: 0, classes: { A: { p95: 30 }, B: { p95: 90 }, C: { p95: 200 } }, ...over });
const result = (...stages) => ({ stages: Object.fromEntries(stages.map((s) => [s.target, s])) });

test('a clean step is sustained', () => assert.equal(judgeStage(stage(50), budgets).sustained, true));
test('errors over the budget fail a step', () => {
  const j = judgeStage(stage(50, { failedRate: 0.02 }), budgets);
  assert.equal(j.sustained, false);
  assert.match(j.reasons[0], /errors 2\.00%/);
});
test('a class over its p95 fails a step and names the class', () => {
  const j = judgeStage(stage(100, { classes: { A: { p95: 80 }, B: { p95: 90 } } }), budgets);
  assert.match(j.reasons.join(' '), /class A p95 80 ms over 50/);
});
test('dropped iterations (k6 could not keep the rate) fail a step', () => {
  assert.equal(judgeStage(stage(200, { dropped: 5000 }), budgets).sustained, false);
  assert.equal(judgeStage(stage(200, { dropped: 3 }), budgets).sustained, true);
});
test('capacity is the highest step before the first failure', () => {
  const c = capacity(result(stage(25), stage(50), stage(100, { failedRate: 0.5 }), stage(200)), budgets);
  assert.equal(c.sustainedRps, 50);
  assert.equal(c.firstFailing.target, 100);
});
test('no step sustained gives zero', () => assert.equal(capacity(result(stage(25, { failedRate: 1 })), budgets).sustainedRps, 0));
test('a drop of more than the share against the baseline is flagged', () => {
  assert.ok(dropped({ sustainedRps: 80 }, { sustainedRps: 100 }, budgets));
  assert.equal(dropped({ sustainedRps: 95 }, { sustainedRps: 100 }, budgets), null);
  assert.equal(dropped({ sustainedRps: 10 }, null, budgets), null);
});
