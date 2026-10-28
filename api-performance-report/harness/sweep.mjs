// Sweep every operation in the live OpenAPI document, one at a time (pure latency, no contention).
// node sweep.mjs [outfile]
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.argv[2] || 'sweep.json';
const spec = JSON.parse(fs.readFileSync(new URL('./openapi.json', import.meta.url)));
const TIMEOUT_MS = 8000;
const SKIP = /logout|sign-?out|revoke|password|\/sessions|delete-account|close-account|\/impersonat|terminate/i;

let token = '';
const RAW = process.argv[3] || 'sweep-raw.jsonl';
const rawOut = fs.createWriteStream(RAW);
let seq = 0;
const logRaw = (o, url, k, r, note = '') => rawOut.write(JSON.stringify({ seq: ++seq, at: new Date().toISOString(), phase: 'sweep', method: o.method, route: o.path, url, attempt: k + 1, note, status: r.status, ttfbMs: r.ttfb == null ? null : +r.ttfb.toFixed(3), totalMs: +r.total.toFixed(3), reqBytes: r.reqBytes, respBytes: r.bytes }) + '\n');
async function login() {
  const r = await fetch(`${BASE}/v2/auth/staff/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      orgSlug: 'Admin',
      email: 'nachiket.challawar@geta.ai',
      password: process.env.SEED_PW,
    }),
  });
  const j = await r.json();
  token = j.tokens.accessToken;
}

const ref = (o) => {
  if (o && o.$ref) {
    let n = spec;
    for (const k of o.$ref.slice(2).split('/')) n = n?.[k];
    return n;
  }
  return o;
};
function example(s, depth = 0) {
  s = ref(s);
  if (!s || depth > 4) return {};
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => example(x, depth + 1)));
  if (s.oneOf || s.anyOf) return example((s.oneOf || s.anyOf)[0], depth + 1);
  switch (s.type) {
    case 'string':
      if (s.format === 'uuid') return randomUUID();
      if (s.format === 'email') return 'perf@example.test';
      if (s.format === 'date-time') return new Date().toISOString();
      if (s.format === 'date') return '2026-10-28';
      return 'x'.repeat(Math.max(1, s.minLength || 3));
    case 'integer':
    case 'number':
      return s.minimum ?? 1;
    case 'boolean':
      return false;
    case 'array':
      return s.minItems ? [example(s.items, depth + 1)] : [];
    case 'object':
    default: {
      const o = {};
      for (const k of s.required || []) o[k] = example(s.properties?.[k], depth + 1);
      return o;
    }
  }
}

const ops = [];
for (const [p, item] of Object.entries(spec.paths))
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    const op = item[m];
    if (!op) continue;
    const params = [...(item.parameters || []), ...(op.parameters || [])].map(ref);
    ops.push({ method: m.toUpperCase(), path: p, op, params, tags: op.tags || [] });
  }

// ids harvested from list endpoints: prefix -> id
const ids = new Map();
function harvest(path, body) {
  try {
    const j = JSON.parse(body);
    const arr = Array.isArray(j) ? j : j.items || j.data || j.results || null;
    const first = arr?.[0];
    if (first?.id !== undefined) ids.set(path, String(first.id));
  } catch {}
}
function fill(o) {
  let url = o.path;
  const pathParams = o.params.filter((x) => x.in === 'path');
  for (const prm of pathParams) {
    const prefix = o.path.split(`{${prm.name}}`)[0].replace(/\/$/, '');
    let v = ids.get(prefix);
    if (v === undefined) {
      const t = ref(prm.schema)?.type;
      v = t === 'integer' || t === 'number' ? '1' : randomUUID();
    }
    url = url.replace(`{${prm.name}}`, encodeURIComponent(v));
  }
  const qs = o.params
    .filter((x) => x.in === 'query' && x.required)
    .map((x) => `${encodeURIComponent(x.name)}=${encodeURIComponent(String(example(x.schema)))}`);
  return url + (qs.length ? `?${qs.join('&')}` : '');
}

async function hit(o, url, body) {
  const isPublic = Array.isArray(o.op.security) && o.op.security.length === 0;
  const headers = { accept: 'application/json' };
  if (!isPublic) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (o.method !== 'GET' && o.op['x-idempotent'] !== false) headers['idempotency-key'] = randomUUID();
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const r = await fetch(BASE + url, { method: o.method, headers, body: payload, signal: ac.signal });
    const ttfb = performance.now() - t0;
    const buf = Buffer.from(await r.arrayBuffer());
    const total = performance.now() - t0;
    return { status: r.status, ttfb, total, bytes: buf.length, reqBytes: payload ? Buffer.byteLength(payload) : 0, text: buf.toString('utf8', 0, 200000) };
  } catch (e) {
    return { status: e.name === 'AbortError' ? 'timeout' : 'error', ttfb: null, total: performance.now() - t0, bytes: 0, reqBytes: 0, text: '' };
  } finally {
    clearTimeout(to);
  }
}

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

await login();
const results = [];
// phase A: parameterless GETs first so ids exist
const order = [
  ...ops.filter((o) => o.method === 'GET' && !o.path.includes('{')),
  ...ops.filter((o) => !(o.method === 'GET' && !o.path.includes('{'))),
];
let i = 0;
for (const o of order) {
  i++;
  const key = `${o.method} ${o.path}`;
  const rec = { key, method: o.method, path: o.path, tag: o.tags[0] || '-', summary: o.op.summary || '', public: Array.isArray(o.op.security) && o.op.security.length === 0 };
  if (SKIP.test(o.path)) {
    results.push({ ...rec, skipped: 'would invalidate the test session or change credentials' });
    continue;
  }
  const url = fill(o);
  const rb = o.op.requestBody?.content?.['application/json']?.schema;
  const body = o.method === 'GET' || o.method === 'DELETE' ? undefined : rb ? example(rb) : {};
  const N = o.method === 'GET' ? 10 : 5;
  const samples = [];
  let first = null;
  for (let k = 0; k < N; k++) {
    let r = await hit(o, url, body);
    logRaw(o, url, k, r);
    if (r.status === 401 && !rec.public && /^\/v2\/(?!platform|partner)/.test(o.path)) {
      await login();
      r = await hit(o, url, body);
      logRaw(o, url, k, r, 'retry-after-relogin');
    }
    if (k === 0) {
      first = r;
      if (o.method === 'GET' && !o.path.includes('{') && r.status === 200) harvest(o.path, r.text);
    } else samples.push(r);
    if (typeof r.status !== 'number' || (r.status >= 500 && k >= 1)) break;
    if (r.status === 429) break;
  }
  const tot = samples.map((s) => s.total);
  const tf = samples.filter((s) => s.ttfb != null).map((s) => s.ttfb);
  results.push({
    ...rec,
    url,
    status: first.status,
    statuses: [...new Set([first, ...samples].map((s) => s.status))],
    coldMs: +first.total.toFixed(2),
    n: tot.length,
    minMs: tot.length ? +Math.min(...tot).toFixed(2) : null,
    p50Ms: tot.length ? +pct(tot, 50).toFixed(2) : null,
    p95Ms: tot.length ? +pct(tot, 95).toFixed(2) : null,
    p99Ms: tot.length ? +pct(tot, 99).toFixed(2) : null,
    maxMs: tot.length ? +Math.max(...tot).toFixed(2) : null,
    meanMs: tot.length ? +(tot.reduce((a, b) => a + b, 0) / tot.length).toFixed(2) : null,
    ttfbP50Ms: tf.length ? +pct(tf, 50).toFixed(2) : null,
    respBytes: first.bytes,
    reqBytes: first.reqBytes,
    errCode: first.status >= 400 ? (first.text.match(/"code":"([A-Z_]+)"/) || [])[1] || null : null,
  });
  if (i % 100 === 0) {
    console.log(`${i}/${order.length}`);
    fs.writeFileSync(OUT, JSON.stringify(results));
  }
}
fs.writeFileSync(OUT, JSON.stringify(results));
rawOut.end();
console.log('done', results.length);
