#!/usr/bin/env node
// Turns a bench run into the machine-readable deliverables and the release certification (QCAP-091..100).
//
//   node tools/queue-capacity/report.mjs [--bench reports/queue-capacity/queue-capacity-bench.json] [--out docs/performance/queue-capacity]
//
// The certification is conservative: it can only say READY when every required control has executed evidence. Anything that was not
// run is listed as a blocker and the verdict is NOT_READY. Theoretical numbers (the forecasts) are labelled as assumptions.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drainSeconds, requiredInstances } from './lib/model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const bench = JSON.parse(readFileSync(resolve(root, opt('bench', 'reports/queue-capacity/queue-capacity-bench.json')), 'utf8'));
const out = resolve(root, opt('out', 'docs/performance/queue-capacity'));
const inv = JSON.parse(readFileSync(join(out, 'queue-inventory.json'), 'utf8'));
mkdirSync(out, { recursive: true });
const w = (name, data) => writeFileSync(join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
const env = { commit: bench.commit, bullmq: bench.bullmq, redis: bench.redis, ioredis: bench.ioredis, node: bench.node, host: bench.host, redisConfig: bench.redisConfig, generatedAt: bench.generatedAt, durationMultiplier: bench.durationMultiplier, caveat: bench.caveat, reproduce: bench.reproduce };
const R = bench.results;

w('worker-throughput-benchmarks.json', { ...env, dataset: 'synthetic: sleep / pool-limited sleep / busy-loop handlers, 1 queue per run, deterministic job counts', shapes: R.sweep ?? null });
w('queue-capacity-baselines.json', { ...env, basis: 'synthetic expected peak = 70% of measured capacity; no production traffic data exists in this repo', profiles: R.profiles ?? null, concurrencyKnees: (R.sweep ?? []).map((s) => ({ shape: s.shape, knee: s.knee, atRangeEdge: s.atRangeEdge, safeDefault: s.safeDefault, peakThroughput: s.peakThroughput })) });
w('queue-drain-time-results.json', { ...env, result: R.drain ?? null });
w('queue-load-stress-spike-results.json', { ...env, ...(R.profiles ?? {}) });
w('queue-soak-results.json', { ...env, ...(R.soak ?? { status: 'not run' }), standardRequires: ['12 h soak', '24 h pre-release soak'], executed: R.soak ? `${R.soak.seconds} s` : 'none' });
w('tenant-fairness-test-results.json', { ...env, scenarios: R.fairness ?? null, isolation: R.isolation ?? null, notRun: ['tenant-context leakage under concurrency (needs the real processors and RLS)', 'tenant deactivation during backlog (QCAP-070)'] });
w('provider-rate-limit-test-results.json', { ...env, scenarios: R.provider ?? null, ceiling: 'mock provider, 100 req/s token bucket', notRun: ['real Meta / partner ceilings (QCAP-055): no sandbox endpoint measured'] });
w('crash-and-recovery-results.json', { ...env, crash: R.crash ?? null, redisRestart: R.redisRestart ?? null });

// Forecast per queue. Durations are ASSUMPTIONS by job kind: the real processors were not benchmarked.
const ASSUMED_MS = { io: 100, db: 30, provider: 300, cpu: 40 };
const forecasts = inv.queues.filter((q) => q.concurrencyPerWorker).map((q) => {
  const ms = ASSUMED_MS[q.jobKind] ?? 100;
  const limiterCap = q.limiter ? q.limiter.max / (q.limiter.durationMs / 1000) : Infinity;
  const mu = Math.min(q.concurrencyPerWorker / (ms / 1000), limiterCap);
  const lambda = mu * 0.5;
  return {
    queue: q.queue, class: q.class, concurrencyPerWorker: q.concurrencyPerWorker, assumedAvgJobMs: ms, assumption: 'duration assumed from job kind, NOT measured on the real processor',
    capacityJobsPerSecPerWorker: +mu.toFixed(1), limiter: q.limiter, drainSecondsFor10kBacklogAt50pctLoad: Math.round(drainSeconds(10_000, lambda, mu)),
    drainSecondsFor100kBacklogAt50pctLoad: Math.round(drainSeconds(100_000, lambda, mu)), waitSloMsP95: q.waitSloMsP95,
    instancesFor100jps: requiredInstances({ lambda: 100, avgSeconds: ms / 1000, slotsPerInstance: q.concurrencyPerWorker, providerCeilingPerSec: limiterCap }),
  };
});
w('queue-backlog-forecasts.json', { generatedAt: bench.generatedAt, status: 'MODEL ONLY. Replace assumedAvgJobMs with p50 processing time per queue from production metrics (jobTimings in job-metrics.ts) before relying on any row.', forecasts });

const unitCount = 17; // tools/queue-capacity/model.test.mjs
w('queue-test-inventory.json', { generatedAt: bench.generatedAt, planningTarget: 500, implemented: { unit: unitCount, benchChecks: bench.checks.length, inventoryGate: 1 }, note: 'The 500-scenario target is a planning figure; this suite is the first slice. Missing families listed in queue-remediation-backlog.md.', checks: bench.checks.map((c) => ({ id: c.id, name: c.name })), commands: ['node --test tools/queue-capacity/model.test.mjs', 'node tools/queue-capacity/inventory.mjs --check', bench.reproduce] });
w('queue-test-results.json', { ...env, summary: bench.summary, checks: bench.checks });

// ---- certification
const controls = [
  ['QCAP-001..010', 'inventory + classification', true, 'inventory.mjs --check'],
  ['QCAP-011..020', 'backlog measurement in harness; production exporter missing', false, 'jobTimings() exists (wait/duration) but no queue-depth / oldest-age / drain-time exporter or alert'],
  ['QCAP-021..030', 'worker throughput + concurrency sweep on synthetic handlers', !!R.sweep, 'real processors not benchmarked'],
  ['QCAP-031..039', 'load profiles 15%..300% and short soak', !!R.profiles && !!R.soak, '12 h and 24 h soak not run'],
  ['QCAP-040', 'job accounting', bench.checks.filter((c) => c.id === 'QCAP-040').every((c) => c.ok), ''],
  ['QCAP-041..050', 'Redis memory/latency/persistence', !!R.redisRestart, 'broker outage drain under load and cleanup policy at volume not tested'],
  ['QCAP-051..060', 'DB + provider ceilings', false, 'DB connections per worker and real provider ceilings not measured; mock provider only'],
  ['QCAP-061..070', 'tenant isolation', false, 'fairness prototype measured; no per-tenant admission control in product; context leakage test needs real processors'],
  ['QCAP-071..080', 'autoscaling + backpressure', false, 'policy function unit-tested; nothing wired to a deployment'],
  ['QCAP-081..090', 'failure scenarios', !!R.crash && !!R.redisRestart, 'DB outage, provider outage, deploy under load, DLQ redrive not tested'],
  ['QCAP-091..100', 'CI gates + certification', false, 'no CI workflow wired; no baselines committed for regression compare'],
];
const blockers = controls.filter((c) => !c[2]).map((c) => `${c[0]} ${c[1]}: ${c[3]}`);
const failed = bench.checks.filter((c) => !c.ok);
w('queue-capacity-release-certification.json', {
  verdict: blockers.length || failed.length ? 'NOT_READY' : 'READY', ...env,
  checksPassed: bench.summary.passed, checksTotal: bench.summary.checks, failedChecks: failed, blockers,
  criticalLoss: bench.checks.filter((c) => c.id === 'QCAP-040').every((c) => c.ok) ? 'no job lost in any executed scenario' : 'JOB LOSS OBSERVED',
  evidenceScope: 'synthetic handlers + local Redis on one machine; not production capacity',
  controls: controls.map(([id, what, ok, gap]) => ({ id, what, evidenced: ok, gap })),
});
console.log(`wrote deliverables to ${out}; verdict ${blockers.length || failed.length ? 'NOT_READY' : 'READY'} (${blockers.length} blockers)`);
