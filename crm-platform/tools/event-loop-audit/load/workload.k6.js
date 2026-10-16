// k6 workload for the event-loop baselines (docs/performance/event-loop). Run it through run-load.mjs, which starts an isolated stack,
// seeds one workspace and sets the environment below. It is NOT meant to be pointed at a shared or production server.
//
//   PROFILE   normal | peak | spike | soak
//   BASE_URL  http://host.docker.internal:3997
//   ORG_SLUG, EMAIL, PASSWORD   the seeded workspace's owner
//   SECONDS   length of normal / peak (default 120); SOAK_MINUTES for soak (default 10)
//
// The arrival rates are CHOSEN, not derived from production traffic (none was available): normal 10 req/s, peak 40 req/s, spike
// ramps to 120 req/s (3x peak). A first 30 s trial at 20 req/s used about a third of one core in the API, so 40 req/s is a busy but
// not saturated single process on the machine this was written on, and 120 req/s is meant to saturate it. Open model (constant arrival rate): when the server falls behind, k6 reports dropped iterations and
// latency grows instead of the load politely slowing down, which is the behaviour a baseline needs to show.
import http from 'k6/http';
import { check } from 'k6';

// 409 is the optimistic lock answering two updates of one contact: expected, not a server failure.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

const BASE = __ENV.BASE_URL;
const PROFILE = __ENV.PROFILE || 'normal';
const SECONDS = Number(__ENV.SECONDS || 120);
const SOAK_MINUTES = Number(__ENV.SOAK_MINUTES || 10);

const scenarios = {
  normal: {
    executor: 'constant-arrival-rate',
    rate: 10,
    timeUnit: '1s',
    duration: `${SECONDS}s`,
    preAllocatedVUs: 20,
    maxVUs: 200,
  },
  peak: {
    executor: 'constant-arrival-rate',
    rate: 40,
    timeUnit: '1s',
    duration: `${SECONDS}s`,
    preAllocatedVUs: 50,
    maxVUs: 400,
  },
  spike: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 800,
    stages: [
      { duration: '20s', target: 10 },
      { duration: '10s', target: 120 },
      { duration: '40s', target: 120 },
      { duration: '10s', target: 10 },
      { duration: '40s', target: 10 },
    ],
  },
  soak: {
    executor: 'constant-arrival-rate',
    rate: 10,
    timeUnit: '1s',
    duration: `${SOAK_MINUTES}m`,
    preAllocatedVUs: 20,
    maxVUs: 200,
  },
};

const ROUTES = ['list', 'search', 'get', 'update', 'create', 'inbox_list', 'inbox_counts'];
// Naming a threshold per route is what makes k6 export a summary line for each route tag.
const thresholds = { http_req_failed: ['rate>=0'] };
for (const r of ROUTES) thresholds[`http_req_duration{name:${r}}`] = ['max>=0'];

export const options = {
  scenarios: { [PROFILE]: scenarios[PROFILE] },
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  discardResponseBodies: false,
};

const hex = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
};

export function setup() {
  const login = http.post(
    `${BASE}/v2/auth/login`,
    JSON.stringify({ orgSlug: __ENV.ORG_SLUG, email: __ENV.EMAIL, password: __ENV.PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'setup_login' } },
  );
  const body = login.json();
  const token = body.tokens && body.tokens.accessToken;
  if (!token)
    throw new Error(`login did not authenticate (status ${login.status}, ${body.status})`);
  const headers = { Authorization: `Bearer ${token}` };
  // A pool of real contact ids for the by-id reads and updates.
  const page = http.get(`${BASE}/v2/contacts?limit=200`, { headers, tags: { name: 'setup_ids' } });
  const ids = (page.json().data || []).map((c) => c.id);
  if (ids.length === 0) throw new Error('the workspace has no contacts to read');
  return { token, ids };
}

function pick(weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i][1];
  let x = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i][1];
    if (x <= 0) return weights[i][0];
  }
  return weights[0][0];
}

const MIX = [
  ['list', 55],
  ['search', 12],
  ['get', 15],
  ['inbox_list', 8],
  ['inbox_counts', 4],
  ['create', 4],
  ['update', 2],
];
const SEARCH_WORDS = ['Load', 'Contact', 'load1', 'load22', '99', 'example'];

export default function (data) {
  const auth = { Authorization: `Bearer ${data.token}` };
  // k6 0.49's compiler does not accept object spread; Object.assign it is.
  const json = Object.assign({}, auth, { 'Content-Type': 'application/json' });
  const id = data.ids[Math.floor(Math.random() * data.ids.length)];
  let res;
  switch (pick(MIX)) {
    case 'list':
      res = http.get(`${BASE}/v2/contacts?limit=25`, { headers: auth, tags: { name: 'list' } });
      break;
    case 'search': {
      const q = SEARCH_WORDS[Math.floor(Math.random() * SEARCH_WORDS.length)];
      res = http.get(`${BASE}/v2/contacts?limit=25&q=${q}`, {
        headers: auth,
        tags: { name: 'search' },
      });
      break;
    }
    case 'get':
      res = http.get(`${BASE}/v2/contacts/${id}`, { headers: auth, tags: { name: 'get' } });
      break;
    case 'inbox_list':
      res = http.get(`${BASE}/v2/inbox/conversations?limit=25`, {
        headers: auth,
        tags: { name: 'inbox_list' },
      });
      break;
    case 'inbox_counts':
      res = http.get(`${BASE}/v2/inbox/counts`, { headers: auth, tags: { name: 'inbox_counts' } });
      break;
    case 'create': {
      const n = hex(12);
      res = http.post(
        `${BASE}/v2/contacts`,
        JSON.stringify({ name: `K6 ${n}`, email: `k6-${n}@example.test` }),
        {
          headers: Object.assign({}, json, {
            'Idempotency-Key': `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`,
          }),
          tags: { name: 'create' },
        },
      );
      break;
    }
    default: {
      const cur = http.get(`${BASE}/v2/contacts/${id}`, { headers: auth, tags: { name: 'get' } });
      const row = cur.json();
      const c = row.data || row;
      res = http.patch(
        `${BASE}/v2/contacts/${id}`,
        JSON.stringify({ leadScore: Math.floor(Math.random() * 100), rowVersion: c.rowVersion }),
        { headers: json, tags: { name: 'update' } },
      );
      // A 409 is the optimistic lock doing its job when two iterations pick the same contact; it is not a server failure.
      check(res, { 'update: 200 or 409': (r) => r.status === 200 || r.status === 409 });
      return;
    }
  }
  check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 300 });
}
