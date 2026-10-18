// QA #55: a sudden jump from normal load to three times the expected peak, held, dropped, then watched for recovery.
//   SPIKE=http     the API traffic mix (70/25/5)
//   SPIKE=webhook  signed WhatsApp webhooks on the public ingest route (needs WHATSAPP_APP_SECRET on the API and here as WEBHOOK_SECRET)
//   SPIKE=socket   a realtime connection storm (socket.io clients connecting together)
// Phases run one after the other: normal -> ramp (to 3x in RAMP seconds) -> hold -> drop (back to normal) -> recovery.
// A canary at a steady low rate runs through every phase on /health and on a light authenticated read: "unrelated endpoints stay healthy".
//   k6 run perf/spike.js -e SPIKE=http -e NORMAL=20 -e RAMP=60 -e HOLD=300 -e RECOVERY=300
import http from 'k6/http';
import ws from 'k6/ws';
import crypto from 'k6/crypto';
import { check } from 'k6';
import { BASE, BUDGETS, call, discover, login, probes } from './lib/common.js';

const SPIKE = __ENV.SPIKE || 'http';
const NORMAL = Number(__ENV.NORMAL || 20); // requests (or connections) per second that count as the normal busy period
const MULT = Number(__ENV.MULT || BUDGETS.spike.peakMultiplier);
const RAMP = Number(__ENV.RAMP || BUDGETS.spike.rampSeconds);
const HOLD = Number(__ENV.HOLD || 300);
const RECOVERY = Number(__ENV.RECOVERY || 300);
const BASELINE = Number(__ENV.BASELINE || 60); // normal load before the spike, for the comparison
const MAXVUS = Number(__ENV.MAXVUS || 800);
const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET || '';
const OUT = __ENV.OUT || `perf/results/spike-${SPIKE}.json`;
const PEAK = NORMAL * MULT;

const PHASES = [
  ['normal', BASELINE, 'constant', NORMAL],
  ['ramp', RAMP, 'ramp', null],
  ['hold', HOLD, 'constant', PEAK],
  ['drop', 30, 'constant', NORMAL],
  ['recovery', RECOVERY, 'constant', NORMAL],
];

const scenarios = {};
const thresholds = {};
let at = 0;
for (const [name, secs, kind, rate] of PHASES) {
  const start = `${at}s`;
  const alloc = Math.min(MAXVUS, Math.max(20, Math.ceil(PEAK / 2)));
  scenarios[`load_${name}`] =
    kind === 'ramp'
      ? { executor: 'ramping-arrival-rate', startRate: NORMAL, timeUnit: '1s', preAllocatedVUs: alloc, maxVUs: MAXVUS, stages: [{ target: PEAK, duration: `${secs}s` }], startTime: start, exec: 'load', tags: { phase: name } }
      : { executor: 'constant-arrival-rate', rate, timeUnit: '1s', duration: `${secs}s`, preAllocatedVUs: alloc, maxVUs: MAXVUS, startTime: start, exec: 'load', tags: { phase: name } };
  scenarios[`canary_${name}`] = { executor: 'constant-arrival-rate', rate: 5, timeUnit: '1s', duration: `${secs}s`, preAllocatedVUs: 5, maxVUs: 20, startTime: start, exec: 'canary', tags: { phase: name, canary: 'yes' } };
  thresholds[`http_req_failed{phase:${name},canary:no}`] = ['rate>=0'];
  thresholds[`http_req_failed{phase:${name},canary:yes}`] = ['rate>=0'];
  thresholds[`http_req_duration{phase:${name},canary:no}`] = ['max>=0'];
  thresholds[`http_req_duration{phase:${name},canary:yes}`] = ['max>=0'];
  thresholds[`http_reqs{phase:${name},canary:no}`] = ['count>=0'];
  thresholds[`dropped_iterations{phase:${name}}`] = ['count>=0'];
  if (SPIKE === 'socket') {
    thresholds[`ws_sessions{phase:${name},canary:no}`] = ['count>=0'];
    thresholds[`ws_connecting{phase:${name},canary:no}`] = ['max>=0'];
    thresholds[`checks{phase:${name},canary:no}`] = ['rate>=0'];
  }
  at += secs;
}

export const options = { scenarios, thresholds, summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'] };

export function setup() {
  const token = login();
  return { token, ids: discover(token) };
}

const pick = (l) => l[Math.floor(Math.random() * l.length)];
let n = 0;

function webhookBody() {
  const phoneNumberId = __ENV.PHONE_NUMBER_ID || '100000000000001';
  n++;
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: '200000000000001', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000001', phone_number_id: phoneNumberId }, contacts: [{ profile: { name: 'Perf' }, wa_id: '9198000000' + (n % 90) }], messages: [{ from: '9198000000' + (n % 90), id: `wamid.PERF${__VU}_${__ITER}_${n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'spike test message ' + n } }] } }] }],
  });
}

export function load(d) {
  const tags = { canary: 'no' };
  if (SPIKE === 'webhook') {
    const body = webhookBody();
    const sig = 'sha256=' + crypto.hmac('sha256', WEBHOOK_SECRET, body, 'hex');
    const r = http.post(`${BASE}/v2/public/webhooks/whatsapp`, body, { headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, tags });
    check(r, { accepted: (x) => x.status === 200 }, { canary: 'no' });
  } else if (SPIKE === 'socket') {
    const url = `${BASE.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
    const res = ws.connect(url, { tags }, (socket) => {
      socket.on('message', (m) => { if (m.startsWith('0')) socket.send('40/realtime,' + JSON.stringify({ token: d.token })); });
      socket.on('message', (m) => { if (m.startsWith('40/realtime')) { socket.setTimeout(() => socket.close(), 2000); } });
      socket.setTimeout(() => socket.close(), 8000);
    });
    check(res, { upgraded: (x) => x && x.status === 101 }, { canary: 'no' });
  } else {
    const all = probes(d.ids);
    const x = Math.random();
    const cls = x < BUDGETS.mix.A ? 'A' : x < BUDGETS.mix.A + BUDGETS.mix.B ? 'B' : 'C';
    const r = call(d.token, pick(all.filter((p) => p.class === cls)), tags);
    check(r, { ok: (y) => y.status >= 200 && y.status < 300 }, { canary: 'no' });
  }
}

export function canary(d) {
  const h = http.get(`${BASE}/health`, { tags: { canary: 'yes', endpoint: 'GET /health' } });
  const s = http.get(`${BASE}/v2/auth/session`, { headers: { authorization: `Bearer ${d.token}` }, tags: { canary: 'yes', endpoint: 'GET /v2/auth/session' } });
  check(h, { up: (x) => x.status === 200 });
  check(s, { up: (x) => x.status === 200 });
}

export function handleSummary(data) {
  const out = { generatedAt: new Date().toISOString(), meta: { spike: SPIKE, normal: NORMAL, peak: PEAK, ramp: RAMP, hold: HOLD, recovery: RECOVERY, baseline: BASELINE }, phases: {} };
  for (const [name, secs] of PHASES) {
    const g = (m, c) => data.metrics[`${m}{phase:${name},canary:${c}}`]?.values;
    let load = g('http_req_duration', 'no');
    const can = g('http_req_duration', 'yes');
    let requests = g('http_reqs', 'no')?.count ?? 0;
    let failedRate = g('http_req_failed', 'no')?.rate ?? null;
    if (SPIKE === 'socket') {
      // A socket session is not an HTTP request: count sessions, time the connect, and read failures from the upgrade check.
      load = data.metrics[`ws_connecting{phase:${name},canary:no}`]?.values;
      requests = data.metrics[`ws_sessions{phase:${name},canary:no}`]?.values.count ?? 0;
      const ok = data.metrics[`checks{phase:${name},canary:no}`]?.values.rate;
      failedRate = ok == null ? null : 1 - ok;
    }
    out.phases[name] = {
      seconds: secs,
      requests,
      failedRate,
      p95: load?.['p(95)'] ?? null,
      p99: load?.['p(99)'] ?? null,
      dropped: data.metrics[`dropped_iterations{phase:${name}}`]?.values.count ?? 0,
      canary: { failedRate: g('http_req_failed', 'yes')?.rate ?? null, p95: can?.['p(95)'] ?? null, max: can?.max ?? null },
    };
  }
  return { [OUT]: JSON.stringify(out, null, 1), stdout: '' };
}
