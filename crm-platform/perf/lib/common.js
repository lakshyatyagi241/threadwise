// Shared by the k6 scripts. k6 runs this as an ES module in its own runtime (not Node).
import http from 'k6/http';
import { fail } from 'k6';

export const BASE = __ENV.API_URL || 'http://localhost:3000';
export const EMAIL = __ENV.PERF_EMAIL || 'perf1@geta.ai';
export const PASSWORD = __ENV.PERF_PASSWORD || 'Str0ngPassw0rd#1';
export const BUDGETS = JSON.parse(open('../budgets.json'));

let ip = 0;
// Login is rate limited per address; a distinct forwarded address per call keeps the benchmark from measuring the throttle.
const nextIp = () => `10.77.${(ip >> 8) & 255}.${ip++ & 255}`;

export function login() {
  const res = http.post(`${BASE}/v2/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() },
    tags: { endpoint: 'POST /v2/auth/login', class: 'B', setup: 'true' },
  });
  const token = res.status === 200 || res.status === 201 ? res.json('tokens.accessToken') : null;
  if (!token) fail(`login failed: ${res.status} ${res.body}`);
  return token;
}

const auth = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

// Real ids for the single-record routes, taken from what the seed created.
export function discover(token) {
  const h = { headers: auth(token), tags: { setup: 'true' } };
  const first = (path, key = 'data') => {
    const r = http.get(`${BASE}${path}`, h);
    if (r.status !== 200) return null;
    const rows = r.json(key);
    return rows && rows.length ? rows[0] : null;
  };
  const contact = first('/v2/contacts?limit=1');
  const company = first('/v2/companies?limit=1');
  const task = first('/v2/tasks?limit=1');
  const conversation = first('/v2/inbox/conversations?limit=1');
  return {
    contact: contact && (contact.uuid || contact.id),
    company: company && (company.uuid || company.id),
    task: task && (task.uuid || task.id),
    conversation: conversation && (conversation.uuid || conversation.id),
  };
}

let seq = 0;
const uniq = () => `${__VU}-${__ITER}-${seq++}-${Date.now() % 100000}`;

// One entry per probed endpoint. `route` is the key used in perf/endpoint-classes.json; `class` comes from there.
export function probes(ids) {
  const list = [
    { route: 'GET /v2/auth/session', class: 'A', req: () => ['GET', '/v2/auth/session'] },
    { route: 'GET /v2/contacts', class: 'A', req: () => ['GET', '/v2/contacts?limit=20'] },
    { route: 'GET /v2/companies', class: 'A', req: () => ['GET', '/v2/companies?limit=20'] },
    { route: 'GET /v2/tags', class: 'A', req: () => ['GET', '/v2/tags'] },
    { route: 'GET /v2/tasks', class: 'A', req: () => ['GET', '/v2/tasks?limit=20'] },
    { route: 'GET /v2/inbox/conversations', class: 'A', req: () => ['GET', '/v2/inbox/conversations?limit=20'] },
    { route: 'GET /v2/inbox/counts', class: 'A', req: () => ['GET', '/v2/inbox/counts'] },
  ];
  if (ids.contact) list.push({ route: 'GET /v2/contacts/:id', class: 'A', req: () => ['GET', `/v2/contacts/${ids.contact}`] });
  if (ids.company) list.push({ route: 'GET /v2/companies/:id', class: 'A', req: () => ['GET', `/v2/companies/${ids.company}`] });
  if (ids.task) list.push({ route: 'GET /v2/tasks/:id', class: 'A', req: () => ['GET', `/v2/tasks/${ids.task}`] });
  if (ids.conversation) list.push({ route: 'GET /v2/inbox/conversations/:id/messages', class: 'A', req: () => ['GET', `/v2/inbox/conversations/${ids.conversation}/messages?limit=50`] });
  list.push(
    { route: 'GET /v2/contacts?q', class: 'B', req: () => ['GET', `/v2/contacts?limit=20&q=${encodeURIComponent('Lastname' + (1 + Math.floor(Math.random() * 99000)))}`] },
    { route: 'POST /v2/tags', class: 'B', req: () => ['POST', '/v2/tags', { name: `perf-${uniq()}`, color: '#3366ff' }] },
    { route: 'POST /v2/contacts', class: 'B', req: () => ['POST', '/v2/contacts', { firstName: 'Perf', lastName: uniq(), email: `perf.${uniq()}@perf.example.test` }] },
    { route: 'POST /v2/companies', class: 'B', req: () => ['POST', '/v2/companies', { name: `Perf Company ${uniq()}` }] },
    { route: 'POST /v2/tasks', class: 'B', req: () => ['POST', '/v2/tasks', { title: `Perf task ${uniq()}` }] },
  );
  if (ids.contact) list.push({ route: 'PATCH /v2/contacts/:id', class: 'B', optimistic: true, req: (rowVersion) => ['PATCH', `/v2/contacts/${ids.contact}`, { lifecycleStage: 'qualified', rowVersion: rowVersion || 1 }] });
  list.push(
    { route: 'GET /v2/crm/dashboard', class: 'C', req: () => ['GET', '/v2/crm/dashboard'] },
    { route: 'GET /v2/inbox/analytics/team', class: 'C', req: () => ['GET', '/v2/inbox/analytics/team'] },
  );
  return list;
}

export function call(token, p, extraTags = {}) {
  // An update carries the version it read (optimistic lock); the read is part of the setup of the call and is not measured.
  let version;
  if (p.optimistic) {
    const [, readPath] = [0, p.req()[1]];
    const r = http.get(`${BASE}${readPath}`, { headers: auth(token), tags: { setup: 'true' } });
    version = r.status === 200 ? r.json('rowVersion') : undefined;
  }
  const [method, path, body] = p.req(version);
  const params = { headers: auth(token), tags: { endpoint: p.route, class: p.class, ...extraTags } };
  return method === 'GET' ? http.get(`${BASE}${path}`, params) : http.request(method, `${BASE}${path}`, body ? JSON.stringify(body) : null, params);
}

// k6 only records a sub-metric for a tag combination that a threshold names, so every probed endpoint gets an always-true one.
export function endpointThresholds(routes, metric = 'http_req_duration') {
  const t = {};
  for (const r of routes) t[`${metric}{endpoint:${r}}`] = ['max>=0'];
  return t;
}

export function classThresholds(extra = {}) {
  const t = { http_req_failed: [`rate<${BUDGETS.errorRate}`] };
  for (const c of ['A', 'B', 'C']) t[`http_req_duration{class:${c}}`] = [`p(95)<${BUDGETS.latency[c].p95}`];
  return { ...t, ...extra };
}

// The summary the Node tools read. Class and endpoint figures come from the tagged sub-metrics.
export function summarise(data, meta, probeList = []) {
  const classOf = Object.fromEntries(probeList.map((p) => [p.route, p.class]));
  const out = { generatedAt: new Date().toISOString(), meta, classes: {}, endpoints: {}, http: {} };
  const trend = (m) => m && { count: m.values.count, p50: m.values.med, p95: m.values['p(95)'], p99: m.values['p(99)'], max: m.values.max, avg: m.values.avg };
  for (const [name, m] of Object.entries(data.metrics)) {
    let x;
    if ((x = name.match(/^http_req_duration\{class:([ABC])(?:,phase:measure)?\}$/))) out.classes[x[1]] = trend(m);
    else if ((x = name.match(/^http_req_duration\{endpoint:(.+?)(?:,phase:measure)?\}$/))) out.endpoints[x[1]] = { class: classOf[x[1]], ...trend(m), ...(out.endpoints[x[1]] || {}) , ...trend(m) };
    else if ((x = name.match(/^http_req_failed\{endpoint:(.+?)(?:,phase:measure)?\}$/))) out.endpoints[x[1]] = { ...(out.endpoints[x[1]] || {}), class: classOf[x[1]], errorRate: m.values.rate };
  }
  const failed = data.metrics.http_req_failed;
  out.http = {
    requests: data.metrics.http_reqs?.values.count,
    rate: data.metrics.http_reqs?.values.rate,
    failedRate: failed?.values.rate,
    receivedBytes: data.metrics.data_received?.values.count,
  };
  for (const c of Object.keys(out.classes)) out.classes[c].budgetP95 = BUDGETS.latency[c].p95;
  return out;
}
