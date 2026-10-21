#!/usr/bin/env node
// Live health/readiness test (Sheet3 #73). Boots the built API on a throwaway DB behind two TCP fault proxies (Postgres, Redis) and checks
// /health and /ready while each dependency is refused, black-holed and restored. Never touches the shared containers: faults are injected in
// the proxies, not in the services. Env: HR_DB, HR_ADMIN (postgres://user:pw@host:port), HR_REDIS_PORT, HR_API_PORT, HR_PG_PORT, HR_REDIS_PROXY,
// HR_METRICS_PORT, HR_OUT, HR_QUICK. Exit 0 all passed, 1 a check failed.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const E = process.env;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const adminUrl = new URL(E.HR_ADMIN ?? 'postgres://crm:crm@localhost:5432');
const apiPort = +E.HR_API_PORT, pgProxyPort = +E.HR_PG_PORT, redisProxyPort = +E.HR_REDIS_PROXY;
const DEADLINE_MS = 2000, SLACK_MS = 1500;

class Proxy {
  constructor(listen, host, port) { Object.assign(this, { listen, host, port, mode: 'pass', conns: new Set(), accepted: 0 }); }
  start() {
    return new Promise((res) => {
      this.srv = net.createServer((c) => {
        this.accepted++; this.conns.add(c); c.on('close', () => this.conns.delete(c)); c.on('error', () => {});
        if (this.mode === 'blackhole') { c.resume(); return; }
        const u = net.connect(this.port, this.host); this.conns.add(u); u.on('close', () => this.conns.delete(u)); u.on('error', () => c.destroy());
        c.pipe(u); u.pipe(c);
      }).listen(this.listen, '127.0.0.1', res);
    });
  }
  async set(mode) {
    this.mode = mode;
    for (const c of this.conns) c.destroy();
    this.conns.clear();
    if (mode === 'refuse' && this.srv.listening) await new Promise((r) => this.srv.close(r));
    if (mode !== 'refuse' && !this.srv.listening) await this.start();
  }
}

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, status: pass ? 'PASS' : 'FAIL', detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
const get = async (p, ms = 8000) => { const t = Date.now(); try { const r = await fetch(`http://127.0.0.1:${apiPort}${p}`, { signal: AbortSignal.timeout(ms) }); const text = await r.text(); let body; try { body = JSON.parse(text); } catch {} return { status: r.status, ms: Date.now() - t, text, body }; } catch (e) { return { status: 0, ms: Date.now() - t, text: String(e), body: undefined }; } };
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((s) => setTimeout(s, 500)); } return null; };
const leaks = ['crm_app_user', 'crm_app_dev', E.HR_DB, 'postgres://', 'redis://', String(pgProxyPort), String(redisProxyPort), os.hostname()].filter(Boolean);
const leaked = (text) => leaks.filter((l) => text.includes(l));

const pg = new Proxy(pgProxyPort, adminUrl.hostname, +(adminUrl.port || 5432));
const rd = new Proxy(redisProxyPort, '127.0.0.1', +E.HR_REDIS_PORT);
await pg.start(); await rd.start();
const app = `postgres://crm_app_user:crm_app_dev@127.0.0.1:${pgProxyPort}/${E.HR_DB}`;
const api = spawn('node', ['dist/src/main.js'], { cwd: path.join(root, 'apps/api'), stdio: ['ignore', fs.openSync(path.join(E.HR_OUT, 'api.log'), 'w'), 'inherit'],
  env: { ...process.env, PORT: String(apiPort), OBS_METRICS_PORT: E.HR_METRICS_PORT, APP_URL: `http://localhost:${apiPort}`, DATABASE_URL: app, DATABASE_REPLICA_URL: app,
    MIGRATION_DATABASE_URL: `${E.HR_ADMIN}/${E.HR_DB}`, REDIS_URL: `redis://127.0.0.1:${redisProxyPort}/13` } });
const done = async (code) => { api.kill(); await pg.set('refuse').catch(() => {}); await rd.set('refuse').catch(() => {}); fs.writeFileSync(path.join(E.HR_OUT, 'live-results.json'), JSON.stringify({ results, openedPgConnections: pg.accepted }, null, 2)); process.exit(code); };

try {
  const up = await until(async () => (await get('/health', 2000)).status === 200, 90000);
  check('api boots behind the proxies', !!up);
  if (!up) await done(1);

  // --- healthy baseline ---
  const h = await get('/health'), r = await get('/ready');
  check('healthy: /health 200 and /ready 200', h.status === 200 && r.status === 200, `ready ${r.ms} ms`);
  check('healthy: response time budget (<500 ms)', h.ms < 500 && r.ms < 500, `health ${h.ms} ms, ready ${r.ms} ms`);
  check('unauthenticated /ready is allowed and leaks no DSN/host/role/port', r.status === 200 && leaked(r.text).length === 0 && leaked(h.text).length === 0, leaked(r.text + h.text).join(',') || 'none');

  // --- burst: does readiness overload the database? ---
  const before = pg.accepted, t0 = Date.now();
  const burst = await Promise.all(Array.from({ length: 200 }, () => get('/ready')));
  const lat = burst.map((x) => x.ms).sort((a, b) => a - b);
  check('burst of 200 concurrent /ready all 200', burst.every((x) => x.status === 200), `p50 ${lat[100]} ms, p95 ${lat[189]} ms, total ${Date.now() - t0} ms`);
  const newConns = pg.accepted - before;
  check('burst opens a bounded number of new database connections (<= 20)', newConns <= 20, `${newConns} new connections for 200 requests (no response cache: one SELECT 1 per replica+primary per request)`);

  // --- per dependency fault matrix ---
  for (const [dep, proxy, key] of [['postgres', pg, 'primary'], ['redis', rd, 'redis']]) {
    for (const mode of (E.HR_QUICK ? ['refuse', 'blackhole'] : ['refuse', 'blackhole'])) {
      await proxy.set(mode);
      const [hh, rr] = [await get('/health'), await get('/ready')];
      check(`${dep} ${mode}: /health stays 200 (liveness independent)`, hh.status === 200, `${hh.ms} ms`);
      check(`${dep} ${mode}: /ready is 503 within deadline+slack`, rr.status === 503 && rr.ms <= DEADLINE_MS + SLACK_MS, `${rr.status} in ${rr.ms} ms`);
      check(`${dep} ${mode}: body names the failed check with a fixed word and leaks nothing`, rr.body?.checks?.[key]?.status === 'down' && ['timeout', 'unreachable', 'error'].includes(rr.body.checks[key].error) && leaked(rr.text).length === 0, `${key}=${rr.body?.checks?.[key]?.error}`);
      const par = await Promise.all(Array.from({ length: 20 }, () => get('/ready')));
      check(`${dep} ${mode}: 20 concurrent /ready never hang`, par.every((x) => x.status === 503 && x.ms <= DEADLINE_MS + SLACK_MS * 2), `max ${Math.max(...par.map((x) => x.ms))} ms`);
      await proxy.set('pass');
      const rec = await until(async () => (await get('/ready', 4000)).status === 200, 30000);
      check(`${dep} after ${mode}: /ready recovers to 200`, !!rec);
    }
  }

  // --- worker probe reflects Redis connectivity ---
  const { Redis } = createRequire(path.join(root, 'apps/api/package.json'))('ioredis');
  const direct = new Redis(`redis://127.0.0.1:${E.HR_REDIS_PORT}/13`);
  const member = `${os.hostname()}:hr-test-${process.pid}`;
  await direct.zadd('infra:workers', Date.now(), member);
  const probe = (port) => new Promise((resolve) => { const t = Date.now(); const p = spawn('node', ['dist/src/modules/platform-infrastructure/observability/worker-probe.js'], { cwd: path.join(root, 'apps/api'), stdio: 'ignore', env: { ...process.env, REDIS_URL: `redis://127.0.0.1:${port}/13` } }); p.on('exit', (c) => resolve({ code: c, ms: Date.now() - t })); });
  const okp = await probe(redisProxyPort);
  check('worker probe: exit 0 while its heartbeat is fresh and Redis is reachable', okp.code === 0, `${okp.ms} ms`);
  await rd.set('refuse');
  const refused = await probe(redisProxyPort);
  check('worker probe: exit 1 within 5 s when Redis is refused', refused.code === 1 && refused.ms < 5000, `${refused.ms} ms`);
  await rd.set('blackhole');
  const hole = await probe(redisProxyPort);
  check('worker probe: exit 1 within 5 s when Redis black-holes', hole.code === 1 && hole.ms < 5000, `${hole.ms} ms`);
  await rd.set('pass');
  await direct.zrem('infra:workers', member); direct.disconnect();
  await until(async () => (await get('/ready', 4000)).status === 200, 30000);
} catch (e) { check('live test ran without an exception', false, String(e).slice(0, 200)); }
await done(results.some((r) => r.status === 'FAIL') ? 1 : 0);
