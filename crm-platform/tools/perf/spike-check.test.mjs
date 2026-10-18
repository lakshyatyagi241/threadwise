import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSpike } from './spike-check.mjs';

const budgets = { errorRate: 0.01, spike: { maxErrorRateDuring: 0.05, maxErrorRateAfter: 0.01, healthMustStayUp: true } };
const phase = (failedRate, p95 = 40, canary = 0, dropped = 0) => ({ failedRate, p95, dropped, canary: { failedRate: canary } });
const good = () => ({ phases: { normal: phase(0, 40), ramp: phase(0.01, 90), hold: phase(0.02, 120), drop: phase(0), recovery: phase(0, 45) } });
const failedNames = (v) => v.checks.filter((c) => !c.pass).map((c) => c.name);

test('a spike that bends but recovers passes', () => assert.equal(checkSpike(good(), budgets).pass, true));
test('too many errors during the hold fail the rule', () => {
  const r = good(); r.phases.hold.failedRate = 0.2;
  assert.match(failedNames(checkSpike(r, budgets))[0], /during hold/);
});
test('errors that remain after recovery fail the rule', () => {
  const r = good(); r.phases.recovery.failedRate = 0.05;
  assert.ok(failedNames(checkSpike(r, budgets)).some((n) => /in recovery/.test(n)));
});
test('a canary that goes unhealthy in the ramp is a cascading failure', () => {
  const r = good(); r.phases.ramp.canary.failedRate = 0.4;
  assert.ok(failedNames(checkSpike(r, budgets)).includes('canary healthy in ramp'));
});
test('recovery latency that stays high fails', () => {
  const r = good(); r.phases.recovery.p95 = 900;
  assert.ok(failedNames(checkSpike(r, budgets)).some((n) => /recovery p95/.test(n)));
});
test('a missing figure never counts as a pass', () => {
  const r = good(); r.phases.ramp.failedRate = null;
  assert.equal(checkSpike(r, budgets).pass, false);
});
test('a restart seen in the samples fails the rule', () => {
  const samples = [{ uptime: 100, queueDepth: 0 }, { uptime: 130, queueDepth: 5 }, { uptime: 3, queueDepth: 0 }];
  assert.ok(failedNames(checkSpike(good(), budgets, samples)).includes('the API did not restart'));
});
test('queues must be empty at the end', () => {
  const samples = [{ uptime: 1, queueDepth: 10 }, { uptime: 3, queueDepth: 4 }];
  assert.ok(failedNames(checkSpike(good(), budgets, samples)).includes('queues are empty at the end of recovery'));
});
