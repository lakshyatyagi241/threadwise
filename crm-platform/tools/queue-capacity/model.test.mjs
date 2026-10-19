import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from './lib/model.mjs';
import { CLASSES } from './lib/classes.mjs';
import { readFileSync } from 'node:fs';

test('example from the standard: 500/s in, 350/s out grows 150/s, 90k after 10 min', () => {
  assert.equal(m.backlogGrowthRate(500, 350), 150);
  assert.equal(m.backlogAfter(0, 500, 350, 600), 90_000);
});
test('backlog never negative and drains', () => assert.equal(m.backlogAfter(100, 10, 50, 100), 0));
test('drain: 50k backlog, 100/s in, 150/s capacity = 1000 s (16.7 min)', () => {
  assert.equal(m.drainSeconds(50_000, 100, 150), 1000);
});
test('drain: ongoing arrivals count (100k at 1000/s with 900/s arriving = 1000 s)', () => assert.equal(m.drainSeconds(100_000, 900, 1000), 1000));
test('drain is Infinity when arrivals >= capacity, 0 when empty', () => {
  assert.equal(m.drainSeconds(10, 100, 100), Infinity);
  assert.equal(m.drainSeconds(0, 500, 1), 0);
});
test('sizing example: 100/s x 200ms @70% = 29 slots, 2 instances of 20', () => {
  assert.equal(m.requiredSlots(100, 0.2, 0.7), 29);
  assert.equal(m.requiredInstances({ lambda: 100, avgSeconds: 0.2, slotsPerInstance: 20 }).instances, 2);
});
test('provider ceiling caps the estimate and flags provider-bound', () => {
  const r = m.requiredInstances({ lambda: 1000, avgSeconds: 0.2, slotsPerInstance: 20, providerCeilingPerSec: 50 });
  assert.equal(r.providerBound, true);
  assert.equal(r.effectiveLambda, 50);
  assert.equal(r.instances, 1);
});
test('utilization bounds validated', () => assert.throws(() => m.requiredSlots(1, 1, 0)));
test('percentile interpolates and handles empty', () => {
  assert.equal(m.percentile([], 95), null);
  assert.equal(m.percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(m.percentile([10], 99), 10);
});
test('knee: picks smallest level within 5% of peak, applies 30% headroom', () => {
  const k = m.findKnee([
    { concurrency: 1, throughput: 50 },
    { concurrency: 5, throughput: 240 },
    { concurrency: 10, throughput: 480 },
    { concurrency: 20, throughput: 500 },
    { concurrency: 50, throughput: 400 },
  ]);
  assert.equal(k.knee, 10);
  assert.equal(k.safeDefault, 7);
  assert.equal(k.degradesPastKnee, true);
});
test('knee ignores levels over the failure budget', () => {
  const k = m.findKnee([{ concurrency: 1, throughput: 10 }, { concurrency: 50, throughput: 900, failRate: 0.2 }]);
  assert.equal(k.knee, 1);
  assert.equal(m.findKnee([{ concurrency: 1, throughput: 1, failRate: 1 }]).knee, null);
});
test('regression gate: throughput drop, latency rise, noise floor, lost jobs', () => {
  const base = { throughput: 100, waitP95Ms: 50, procP95Ms: 10 };
  assert.equal(m.regression(base, { throughput: 99, waitP95Ms: 52, procP95Ms: 11 }).ok, true);
  assert.equal(m.regression(base, { throughput: 80 }).ok, false);
  assert.equal(m.regression(base, { throughput: 100, waitP95Ms: 120 }).ok, false);
  assert.equal(m.regression(base, { throughput: 100, procP95Ms: 14 }).ok, true, '40% of 10ms is under the 20ms noise floor');
  assert.equal(m.regression(base, { throughput: 100, lost: 1 }).ok, false);
});
const cfg = { minReplicas: 1, maxReplicas: 6, ageSloS: 5, connPerReplica: 10 };
test('scale out on age breach, by 50%', () => assert.equal(m.scaleDecision({ replicas: 2, oldestWaitingS: 30, utilization: 0.5, secondsCalm: 0, dbConnHeadroom: 100 }, cfg).desired, 3));
test('scale out capped by DB connection headroom', () => {
  const d = m.scaleDecision({ replicas: 2, oldestWaitingS: 30, utilization: 0.9, secondsCalm: 0, dbConnHeadroom: 10 }, cfg);
  assert.equal(d.desired, 3);
  assert.equal(m.scaleDecision({ replicas: 2, oldestWaitingS: 30, utilization: 0.9, secondsCalm: 0, dbConnHeadroom: 0 }, cfg).desired, 2);
});
test('no scale out when provider has no headroom', () => {
  const d = m.scaleDecision({ replicas: 2, oldestWaitingS: 99, utilization: 0.9, secondsCalm: 0, dbConnHeadroom: 100, providerHeadroom: 0 }, cfg);
  assert.equal(d.desired, 2);
  assert.match(d.reason, /provider-bound/);
});
test('hysteresis: calm shorter than cooldown holds, long calm scales in by one, never below min', () => {
  const calm = { replicas: 3, oldestWaitingS: 0, utilization: 0.1, dbConnHeadroom: 100 };
  assert.equal(m.scaleDecision({ ...calm, secondsCalm: 60 }, cfg).desired, 3);
  assert.equal(m.scaleDecision({ ...calm, secondsCalm: 900 }, cfg).desired, 2);
  assert.equal(m.scaleDecision({ ...calm, replicas: 1, secondsCalm: 900 }, cfg).desired, 1);
});
test('every queue constant in queues.ts has a workload class', () => {
  const ts = readFileSync(new URL('../../apps/api/src/infra/queue/queues.ts', import.meta.url), 'utf8');
  const block = ts.slice(ts.indexOf('export const QUEUES'), ts.indexOf('} as const'));
  const consts = [...block.matchAll(/^\s*([A-Z0-9_]+):\s*'/gm)].map((x) => x[1]);
  assert.ok(consts.length > 40);
  assert.deepEqual(consts.filter((c) => !CLASSES[c]), []);
});
