// QA #50: API latency per class. One script, two modes:
//   VUS=1  (default)  pure latency, one user, no contention
//   VUS=20            contention: 20 users at once
// Each class runs in its own scenario one after the other, after a warm-up that is thrown away.
//   k6 run perf/latency.js -e VUS=1 -e DURATION=30s
import { sleep } from 'k6';
import { BUDGETS, call, classThresholds, discover, endpointThresholds, login, probes, summarise } from './lib/common.js';
import { check } from 'k6';

const VUS = Number(__ENV.VUS || 1);
const DURATION = Number(__ENV.DURATION || 30); // seconds per class
const WARMUP = Number(__ENV.WARMUP || 20); // seconds, results discarded
const OUT = __ENV.OUT || 'perf/results/latency.json';
const CLASSES = ['A', 'B', 'C'];

const scenarios = {
  warmup: { executor: 'constant-vus', vus: Math.max(1, Math.min(VUS, 4)), duration: `${WARMUP}s`, exec: 'warmup', startTime: '0s', tags: { phase: 'warmup' } },
};
CLASSES.forEach((c, i) => {
  scenarios[`class_${c}`] = { executor: 'constant-vus', vus: VUS, duration: `${DURATION}s`, exec: 'run', env: { CLASS: c }, startTime: `${WARMUP + i * DURATION + i}s`, tags: { phase: 'measure' } };
});

const KNOWN = ['GET /v2/auth/session', 'GET /v2/contacts', 'GET /v2/companies', 'GET /v2/tags', 'GET /v2/tasks', 'GET /v2/inbox/conversations', 'GET /v2/inbox/counts', 'GET /v2/contacts/:id', 'GET /v2/companies/:id', 'GET /v2/tasks/:id', 'GET /v2/inbox/conversations/:id/messages', 'GET /v2/contacts?q', 'POST /v2/tags', 'POST /v2/contacts', 'POST /v2/companies', 'POST /v2/tasks', 'PATCH /v2/contacts/:id', 'GET /v2/crm/dashboard', 'GET /v2/inbox/analytics/team'];

// Only the measuring phase is judged: the warm-up scenario carries phase:warmup and is filtered out by the tag on every threshold.
const thresholds = {};
for (const [k, v] of Object.entries(classThresholds())) thresholds[k.includes('{') ? k.replace('}', ',phase:measure}') : k] = v;
for (const [k, v] of Object.entries(endpointThresholds(KNOWN))) thresholds[k.replace('}', ',phase:measure}')] = v;
for (const r of KNOWN) thresholds[`http_req_failed{endpoint:${r},phase:measure}`] = ['rate>=0'];

export const options = { scenarios, thresholds, summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'], discardResponseBodies: false };

export function setup() {
  const token = login();
  const ids = discover(token);
  return { token, ids };
}

export function warmup(d) {
  for (const p of probes(d.ids)) call(d.token, p, { phase: 'warmup' });
}

export function run(d) {
  const list = probes(d.ids).filter((p) => p.class === __ENV.CLASS);
  const p = list[Math.floor(Math.random() * list.length)];
  const res = call(d.token, p, { phase: 'measure' });
  check(res, { 'status is 2xx': (r) => r.status >= 200 && r.status < 300 }, { endpoint: p.route });
  sleep(Number(__ENV.THINK || 0));
}

export function handleSummary(data) {
  const s = summarise(data, { vus: VUS, durationPerClass: DURATION, warmup: WARMUP, base: __ENV.API_URL || 'http://localhost:3000' }, probes({}));
  return { [OUT]: JSON.stringify(s, null, 1), stdout: '' };
}
