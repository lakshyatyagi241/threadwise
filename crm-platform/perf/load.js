// QA #53: load testing with concurrent ACTIVE users. Each virtual user is one person at a screen: it signs in once, then keeps doing what staff do
// (open the inbox, read a conversation, look at contacts, search, glance at the dashboard, add a task) with think time between actions.
// Stages run one after another, each with a fresh set of users: ramp up, then hold, so the figures of a stage are steady-state.
//   k6 run perf/load.js -e USERS=100,250,500,750 -e RAMP=60 -e HOLD=180
//   USERS    the stages, in concurrent active users (500 is the sheet's baseline)
//   THINK    seconds a user waits between actions: "min,max" (default 3,8, about 5.5 s)
//   MIX      "full" (default) or "light": light swaps the two inbox aggregates for plain list reads, to see what fails behind them
// A dedicated stack only.
import http from 'k6/http';
import { sleep } from 'k6';
import { BASE, BUDGETS, EMAIL, PASSWORD, discover } from './lib/common.js';

const USERS = (__ENV.USERS || '100,250,500,750').split(',').map(Number);
const RAMP = Number(__ENV.RAMP || 60);
const HOLD = Number(__ENV.HOLD || 180);
const GAP = Number(__ENV.GAP || 10);
const [THINK_MIN, THINK_MAX] = (__ENV.THINK || '3,8').split(',').map(Number);
const MIX = __ENV.MIX || 'full';
const OUT = __ENV.OUT || `perf/results/load-${MIX}.json`;
const MAX = Math.max(...USERS);

const scenarios = {};
let at = 0;
for (const n of USERS) {
  scenarios[`users_${n}`] = {
    executor: 'ramping-vus',
    startVUs: 0,
    gracefulRampDown: '0s',
    gracefulStop: '30s',
    startTime: `${at}s`,
    stages: [
      { duration: `${RAMP}s`, target: n },
      { duration: `${HOLD}s`, target: n },
    ],
    exec: 'user',
    tags: { stage: String(n) },
  };
  at += RAMP + HOLD + GAP;
}

// One always-true threshold per stage and class makes k6 keep that sub-metric (it keeps only those a threshold names).
const thresholds = {};
for (const n of USERS) {
  thresholds[`http_reqs{stage:${n}}`] = ['count>=0'];
  thresholds[`http_req_failed{stage:${n}}`] = ['rate>=0'];
  thresholds[`http_req_duration{stage:${n}}`] = ['max>=0'];
  for (const c of ['A', 'B', 'C']) {
    thresholds[`http_req_duration{stage:${n},class:${c}}`] = ['max>=0'];
    thresholds[`http_req_failed{stage:${n},class:${c}}`] = ['rate>=0'];
  }
}
export const options = {
  setupTimeout: '900s',
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
};

const ipOf = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255 || 1}`;

export function setup() {
  // One session per user, made outside the measured stages (a sign-in storm is not what this test measures; hashing a password is deliberately slow).
  const tokens = [];
  const BATCH = 20; // a few sign-ins at a time: hashing a password is slow on purpose and one machine has few cores
  for (let from = 1; from <= MAX; from += BATCH) {
    const reqs = [];
    for (let i = from; i < Math.min(from + BATCH, MAX + 1); i++) {
      reqs.push(['POST', `${BASE}/v2/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), { headers: { 'content-type': 'application/json', 'x-forwarded-for': ipOf(i) }, tags: { setup: 'true' } }]);
    }
    for (const r of http.batch(reqs)) {
      const t = r.status === 200 || r.status === 201 ? r.json('tokens.accessToken') : null;
      if (!t) throw new Error(`sign-in failed: ${r.status} ${String(r.body).slice(0, 120)}`);
      tokens.push(t);
    }
  }
  return { tokens, ids: discover(tokens[0]) };
}

const A = 'A',
  B = 'B',
  C = 'C';
function actions(ids) {
  const full = MIX === 'full';
  const list = [
    // weight, route key, class, request
    [
      full ? 30 : 0,
      'GET /v2/inbox/conversations',
      A,
      () => ['GET', '/v2/inbox/conversations?limit=20'],
    ],
    [full ? 5 : 0, 'GET /v2/inbox/counts', A, () => ['GET', '/v2/inbox/counts']],
    [full ? 0 : 20, 'GET /v2/contacts', A, () => ['GET', '/v2/contacts?limit=50']],
    [full ? 0 : 15, 'GET /v2/companies', A, () => ['GET', '/v2/companies?limit=20']],
    [
      ids.conversation ? 15 : 0,
      'GET /v2/inbox/conversations/:id/messages',
      A,
      () => ['GET', `/v2/inbox/conversations/${ids.conversation}/messages?limit=50`],
    ],
    [15, 'GET /v2/contacts', A, () => ['GET', '/v2/contacts?limit=20']],
    [
      10,
      'GET /v2/contacts?q',
      B,
      () => [
        'GET',
        `/v2/contacts?limit=20&q=${encodeURIComponent('Lastname' + (1 + Math.floor(Math.random() * 99000)))}`,
      ],
    ],
    [10, 'GET /v2/crm/dashboard', C, () => ['GET', '/v2/crm/dashboard']],
    [5, 'GET /v2/tasks', A, () => ['GET', '/v2/tasks?limit=20']],
    [5, 'POST /v2/tasks', B, () => ['POST', '/v2/tasks', { title: `Load task ${__VU}-${__ITER}` }]],
    [5, 'GET /v2/auth/session', A, () => ['GET', '/v2/auth/session']],
  ].filter((x) => x[0] > 0);
  const total = list.reduce((n, x) => n + x[0], 0);
  return { list, total };
}

export function user(d) {
  const token = d.tokens[__VU % d.tokens.length];
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-forwarded-for': ipOf(__VU),
  };
  const { list, total } = actions(d.ids);
  let x = Math.random() * total;
  let pick = list[0];
  for (const a of list) {
    x -= a[0];
    if (x <= 0) {
      pick = a;
      break;
    }
  }
  const [, route, cls, req] = pick;
  const [method, path, body] = req();
  const params = { headers, tags: { endpoint: route, class: cls } };
  if (method === 'GET') http.get(`${BASE}${path}`, params);
  else http.request(method, `${BASE}${path}`, JSON.stringify(body), params);
  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

export function handleSummary(data) {
  const out = {
    generatedAt: new Date().toISOString(),
    meta: {
      users: USERS,
      ramp: RAMP,
      hold: HOLD,
      gap: GAP,
      think: [THINK_MIN, THINK_MAX],
      mix: MIX,
      endedAt: Date.now(),
      stageSeconds: RAMP + HOLD + GAP,
    },
    stages: {},
  };
  const trend = (m) =>
    m && {
      count: m.values.count,
      p50: m.values.med,
      p95: m.values['p(95)'],
      p99: m.values['p(99)'],
      max: m.values.max,
    };
  for (const n of USERS) {
    const g = (name) => data.metrics[`${name}{stage:${n}}`];
    const reqs = g('http_reqs')?.values.count ?? 0;
    const st = {
      users: n,
      requests: reqs,
      rps: reqs / (RAMP + HOLD),
      failedRate: g('http_req_failed')?.values.rate ?? null,
      all: trend(g('http_req_duration')),
      classes: {},
    };
    for (const c of [A, B, C]) {
      const t = data.metrics[`http_req_duration{stage:${n},class:${c}}`];
      const f = data.metrics[`http_req_failed{stage:${n},class:${c}}`];
      if (t)
        st.classes[c] = {
          ...trend(t),
          failedRate: f?.values.rate ?? null,
          budgetP95: BUDGETS.latency[c].p95,
        };
    }
    out.stages[n] = st;
  }
  return { [OUT]: JSON.stringify(out, null, 1), stdout: '' };
}
