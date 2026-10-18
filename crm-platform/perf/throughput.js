// QA #52: how many requests per second the API sustains inside the latency budgets, with a realistic mix (70% A, 25% B, 5% C).
// The arrival rate is stepped up; each step is held for STEP seconds. The result is read by tools/perf/capacity.mjs:
// the highest step where errors stay under 1% and every class stays inside its p95 budget.
//   k6 run perf/throughput.js -e RATES=25,50,100,200 -e STEP=60
// A dedicated stack only: this is meant to push the system until it gives.
import { BUDGETS, call, discover, login, probes } from './lib/common.js';
import { check } from 'k6';

const RATES = (__ENV.RATES || '25,50,100,200,400').split(',').map(Number);
const STEP = Number(__ENV.STEP || 60);
const GAP = 5; // seconds of quiet between steps so one step's queue does not bleed into the next
const MAXVUS = Number(__ENV.MAXVUS || 600);
const OUT = __ENV.OUT || 'perf/results/throughput.json';

const scenarios = {};
RATES.forEach((rate, i) => {
  scenarios[`step_${rate}`] = {
    executor: 'constant-arrival-rate', rate, timeUnit: '1s', duration: `${STEP}s`,
    preAllocatedVUs: Math.min(MAXVUS, Math.max(10, rate)), maxVUs: MAXVUS,
    startTime: `${i * (STEP + GAP)}s`, tags: { stage: String(rate) }, exec: 'mix',
  };
});

// Sub-metrics only exist for tag sets a threshold names: one always-true threshold per stage and class.
const thresholds = {};
for (const r of RATES) {
  thresholds[`http_req_failed{stage:${r}}`] = ['rate>=0'];
  thresholds[`http_reqs{stage:${r}}`] = ['count>=0'];
  thresholds[`dropped_iterations{stage:${r}}`] = ['count>=0'];
  for (const c of ['A', 'B', 'C']) thresholds[`http_req_duration{stage:${r},class:${c}}`] = ['max>=0'];
}

export const options = { scenarios, thresholds, summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'] };

export function setup() {
  const token = login();
  return { token, ids: discover(token) };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
export function mix(d) {
  const all = probes(d.ids);
  const by = { A: all.filter((p) => p.class === 'A'), B: all.filter((p) => p.class === 'B'), C: all.filter((p) => p.class === 'C') };
  const x = Math.random();
  const cls = x < BUDGETS.mix.A ? 'A' : x < BUDGETS.mix.A + BUDGETS.mix.B ? 'B' : 'C';
  const res = call(d.token, pick(by[cls]));
  check(res, { ok: (r) => r.status >= 200 && r.status < 300 });
}

export function handleSummary(data) {
  const out = { generatedAt: new Date().toISOString(), meta: { rates: RATES, stepSeconds: STEP, mix: BUDGETS.mix }, stages: {} };
  for (const r of RATES) {
    const get = (n) => data.metrics[`${n}{stage:${r}}`]?.values;
    const reqs = get('http_reqs');
    const stage = { target: r, requests: reqs?.count ?? 0, achieved: reqs ? reqs.count / STEP : 0, failedRate: get('http_req_failed')?.rate ?? null, dropped: get('dropped_iterations')?.count ?? 0, classes: {} };
    for (const c of ['A', 'B', 'C']) {
      const t = data.metrics[`http_req_duration{stage:${r},class:${c}}`]?.values;
      if (t) stage.classes[c] = { count: t.count, p50: t.med, p95: t['p(95)'], p99: t['p(99)'] };
    }
    out.stages[r] = stage;
  }
  return { [OUT]: JSON.stringify(out, null, 1), stdout: '' };
}
