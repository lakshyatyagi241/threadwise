import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const BASE = 'http://localhost:3000';
let token = '';
const login = async () => {
  const r = await fetch(`${BASE}/v2/auth/staff/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgSlug: 'Admin', email: 'nachiket.challawar@geta.ai', password: process.env.SEED_PW }) });
  token = (await r.json()).tokens.accessToken;
};
await login();
let n = 0;
let cur = '';
const raw = [];
const uniq = () => `${Date.now() % 1e6}-${n++}`;
async function req(method, path, body, extra = {}) {
  const headers = { authorization: `Bearer ${token}`, ...extra };
  let payload;
  if (body !== undefined) { headers['content-type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
  if (method !== 'GET') headers['idempotency-key'] = crypto.randomUUID();
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method, headers, body: payload });
  const ttfb = performance.now() - t0;
  const buf = Buffer.from(await r.arrayBuffer());
  const ms = performance.now() - t0;
  let json; try { json = JSON.parse(buf.toString()); } catch {}
  raw.push({ at: new Date().toISOString(), phase: cur, method, route: path, status: r.status, ttfbMs: +ttfb.toFixed(3), totalMs: +ms.toFixed(3), reqBytes: payload ? Buffer.byteLength(payload) : 0, respBytes: buf.length });
  return { status: r.status, ms, ttfb, bytes: buf.length, reqBytes: payload ? Buffer.byteLength(payload) : 0, json };
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const stat = (a) => ({ n: a.length, min: +Math.min(...a).toFixed(2), p50: +pct(a, 50).toFixed(2), p95: +pct(a, 95).toFixed(2), p99: +pct(a, 99).toFixed(2), max: +Math.max(...a).toFixed(2), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) });
const out = { crud: {}, listScaling: [], reqSizeScaling: [], concurrency: [] };

// ---- CRUD with valid bodies, N sequential each (first 20 discarded as warm-up)
async function bench(name, N, fn, keep = (r) => r.status < 300) {
  cur = 'flow: ' + name;
  const ms = [], tt = [], statuses = {}; let bytes = 0, reqBytes = 0;
  for (let i = 0; i < N + 20; i++) {
    const r = await fn(i);
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (i >= 20) { ms.push(r.ms); tt.push(r.ttfb); bytes = r.bytes; reqBytes = r.reqBytes; }
  }
  out.crud[name] = { ...stat(ms), ttfbP50: +pct(tt, 50).toFixed(2), respBytes: bytes, reqBytes, statuses };
  console.log(name, JSON.stringify(out.crud[name]));
}
const ids = {};
await bench('POST /v2/tags', 200, async () => { const r = await req('POST', '/v2/tags', { name: `perf-${uniq()}`, color: '#3366ff' }); ids.tag = r.json?.id; return r; });
await bench('POST /v2/contacts', 500, async () => { const r = await req('POST', '/v2/contacts', { firstName: 'Perf', lastName: uniq(), email: `perf.${uniq()}@perf.example.test` }); if (r.json?.id) { ids.contact = r.json.id; ids.cv = r.json.rowVersion; } return r; });
await bench('POST /v2/companies', 200, async () => { const r = await req('POST', '/v2/companies', { name: `Perf Company ${uniq()}` }); ids.company = r.json?.id; return r; });
await bench('POST /v2/tasks', 200, async () => { const r = await req('POST', '/v2/tasks', { title: `Perf task ${uniq()}` }); ids.task = r.json?.id; return r; });
await bench('GET /v2/contacts/:id', 200, () => req('GET', `/v2/contacts/${ids.contact}`));
await bench('PATCH /v2/contacts/:id', 200, async () => {
  const g = await req('GET', `/v2/contacts/${ids.contact}`);
  return req('PATCH', `/v2/contacts/${ids.contact}`, { lifecycleStage: 'qualified', rowVersion: g.json.rowVersion });
});
await bench('GET /v2/contacts?q= (search)', 200, (i) => req('GET', `/v2/contacts?limit=20&q=${encodeURIComponent('Perf')}`));
await bench('GET /v2/auth/session', 200, () => req('GET', '/v2/auth/session'));
await bench('GET /v2/crm/dashboard', 100, () => req('GET', '/v2/crm/dashboard'));
await bench('GET /v2/inbox/counts', 200, () => req('GET', '/v2/inbox/counts'));
await bench('GET /v2/tags', 200, () => req('GET', '/v2/tags'));
await bench('GET /v2/tasks', 200, () => req('GET', '/v2/tasks?limit=20'));
await bench('GET /v2/companies', 200, () => req('GET', '/v2/companies?limit=20'));
await bench('GET /health (liveness)', 200, async () => { const t0 = performance.now(); const r = await fetch(BASE + '/health'); await r.arrayBuffer(); const ms = performance.now() - t0; return { status: r.status, ms, ttfb: ms, bytes: 0, reqBytes: 0 }; });
await bench('GET /ready (readiness)', 100, async () => { const t0 = performance.now(); const r = await fetch(BASE + '/ready'); await r.arrayBuffer(); const ms = performance.now() - t0; return { status: r.status, ms, ttfb: ms, bytes: 0, reqBytes: 0 }; });
await bench('DELETE /v2/tags/:id', 50, async () => { const c = await req('POST', '/v2/tags', { name: `del-${uniq()}`, color: '#000000' }); return req('DELETE', `/v2/tags/${c.json.id}`); });

// ---- response size scaling: list endpoint with growing page size (data now holds 500+ contacts)
for (const limit of [1, 10, 20, 50, 100]) {
  cur = 'payload: list limit ' + limit;
  const ms = [], tt = []; let bytes = 0, status;
  for (let i = 0; i < 40; i++) { const r = await req('GET', `/v2/contacts?limit=${limit}`); status = r.status; if (i >= 5) { ms.push(r.ms); tt.push(r.ttfb); bytes = r.bytes; } }
  out.listScaling.push({ limit, status, respBytes: bytes, ...stat(ms), ttfbP50: +pct(tt, 50).toFixed(2) });
  console.log('limit', limit, status, bytes, JSON.stringify(stat(ms)));
}
// ---- request size scaling: oversize JSON on a validated endpoint (measures body parse + validation + reject)
for (const kb of [1, 10, 100, 500, 1024, 5120]) {
  cur = 'payload: request ' + kb + ' KB';
  const ms = []; let status, rb = 0;
  for (let i = 0; i < 15; i++) { const r = await req('POST', '/v2/tags', { name: 'p'.repeat(kb * 1024), color: '#3366ff' }); status = r.status; rb = r.reqBytes; if (i >= 3) ms.push(r.ms); }
  out.reqSizeScaling.push({ kb, status, reqBytes: rb, ...stat(ms) });
  console.log('reqkb', kb, status, JSON.stringify(stat(ms)));
}
// ---- concurrency: N workers in a closed loop for 8 s
async function conc(name, path, c, secs = 8) {
  cur = `load: ${name} x${c} clients`;
  const ms = []; let errs = 0; const end = performance.now() + secs * 1000; const t0 = performance.now();
  await Promise.all(Array.from({ length: c }, async () => { while (performance.now() < end) { const r = await req('GET', path); if (r.status !== 200) errs++; else ms.push(r.ms); } }));
  const dur = (performance.now() - t0) / 1000;
  const row = { name, concurrency: c, rps: +(ms.length / dur).toFixed(1), errors: errs, ...stat(ms) };
  out.concurrency.push(row); console.log(JSON.stringify(row));
}
for (const c of [1, 10, 50, 100]) { await conc('GET /v2/auth/session', '/v2/auth/session', c); }
for (const c of [1, 10, 50]) { await conc('GET /v2/contacts?limit=20', '/v2/contacts?limit=20', c); }
for (const c of [1, 10, 50]) { await conc('GET /v2/crm/dashboard', '/v2/crm/dashboard', c); }
await bench('POST /v2/auth/staff/login', 60, async () => { const t0 = performance.now(); const r = await fetch(`${BASE}/v2/auth/staff/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgSlug: 'Admin', email: 'nachiket.challawar@geta.ai', password: process.env.SEED_PW }) }); await r.arrayBuffer(); const ms = performance.now() - t0; return { status: r.status, ms, ttfb: ms, bytes: 0, reqBytes: 0 }; });
fs.writeFileSync(new URL('./flows-raw.json', import.meta.url), JSON.stringify(raw));
fs.writeFileSync(new URL('./flows.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('done');
