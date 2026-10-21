#!/usr/bin/env node
// Live alert test (Sheet3 #76). Runs PRIVATE processes only: own API/worker/probe, own Redis container, own Prometheus + Alertmanager
// containers, a TCP proxy in front of a throwaway database. Induces real failures one at a time and records the time to Pending/Firing.
// The rules are a COPY of the repo rules with every `for:` shortened to FOR_S seconds (the repo files are never edited).
// Usage: node tools/alerting/live-test.mjs <workDir> <out.json>     (needs docker, built apps/api, migrated DB alerting76_t1)
import { spawn, execFileSync, execSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [work, outFile] = [process.argv[2], process.argv[3]];
const ROOT = path.resolve(import.meta.dirname, '../..');
const API = path.join(ROOT, 'apps/api');
const P = { api: 3921, apiM: 59521, workerM: 59525, probeM: 59526, prom: 59191, am: 59193, hook: 59194, redis: 59422, pg: 59424 };
const FOR_S = 20;
const DB = 'alerting76_t1';
const sfx = Math.random().toString(36).slice(2, 7);
const names = { redis: `al76-redis-${sfx}`, prom: `al76-prom-${sfx}`, am: `al76-am-${sfx}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = {};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

fs.mkdirSync(work, { recursive: true });

// ---- config files ---------------------------------------------------------------------------------------------------------------
const rulesDir = path.join(work, 'rules');
fs.mkdirSync(rulesDir, { recursive: true });
const ruleFiles = fs.readdirSync(path.join(ROOT, 'deploy/observability')).filter((f) => f.endsWith('.rules.yml'));
for (const f of ruleFiles) {
  const s = fs.readFileSync(path.join(ROOT, 'deploy/observability', f), 'utf8').replace(/^(\s*for: )\d+[smh]$/gm, `$1${FOR_S}s`);
  fs.writeFileSync(path.join(rulesDir, f), s);
}
fs.writeFileSync(
  path.join(work, 'prom.yml'),
  `global: { scrape_interval: 5s, evaluation_interval: 5s }
rule_files: [${ruleFiles.map((f) => `/c/rules/${f}`).join(', ')}]
alerting: { alertmanagers: [{ static_configs: [{ targets: ['localhost:${P.am}'] }] }] }
scrape_configs:
  - { job_name: crm-api, static_configs: [{ targets: ['localhost:${P.apiM}'] }] }
  - { job_name: crm-worker, static_configs: [{ targets: ['localhost:${P.workerM}'] }] }
  - { job_name: crm-probe, static_configs: [{ targets: ['localhost:${P.probeM}'] }] }
`,
);
// The repo Alertmanager config with only the webhook destination swapped for the local receiver.
fs.writeFileSync(
  path.join(work, 'am.yml'),
  fs.readFileSync(path.join(ROOT, 'deploy/observability/alertmanager.yml'), 'utf8')
    .replace('url_file: /run/secrets/alert_webhook_url', `url: http://localhost:${P.hook}/hook`)
    .replace(/group_interval: 5m/, 'group_interval: 10s'),
);

// ---- webhook receiver -----------------------------------------------------------------------------------------------------------
const received = [];
const hook = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    try { received.push({ at: Date.now(), body: JSON.parse(b) }); } catch { /* ignore */ }
    res.end('ok');
  });
}).listen(P.hook);

// ---- postgres proxy (modes: pass, blackhole, down) --------------------------------------------------------------------------------
let pgMode = 'pass';
const socks = new Set();
const proxy = createServer((c) => {
  if (pgMode === 'down') return c.destroy();
  socks.add(c);
  c.on('close', () => socks.delete(c));
  c.on('error', () => {});
  if (pgMode === 'blackhole') return; // accept and never answer: connects, queries hang
  const u = connect(5432, 'localhost');
  socks.add(u);
  u.on('error', () => c.destroy());
  c.on('error', () => u.destroy());
  c.pipe(u); u.pipe(c);
}).listen(P.pg);
const setPg = (m) => { pgMode = m; if (m !== 'pass') for (const s of socks) s.destroy(); };

// ---- processes ------------------------------------------------------------------------------------------------------------------
const baseEnv = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: `postgres://crm_app_user:crm_app_dev@localhost:${P.pg}/${DB}`,
  MIGRATION_DATABASE_URL: `postgres://crm:crm@localhost:5432/${DB}`,
  // the env schema rejects an empty value; the replica pool points at the same private proxy so nothing can reach the shared `crm` database
  DATABASE_REPLICA_URL: `postgres://crm_app_user:crm_app_dev@localhost:${P.pg}/${DB}`,
  REDIS_URL: `redis://localhost:${P.redis}`,
  OBS_METRICS_HOST: '127.0.0.1',
  INFRA_WORKER_HEARTBEAT_SECONDS: '5',
};
function start(name, file, env) {
  const out = fs.openSync(path.join(work, `${name}.log`), 'a');
  procs[name] = spawn('node', [file], { cwd: API, env: { ...baseEnv, ...env }, stdio: ['ignore', out, out] });
  log('started', name, procs[name].pid);
}
const startApi = (extra = {}) => start('api', 'dist/src/main.js', { PORT: String(P.api), OBS_METRICS_PORT: String(P.apiM), ...extra });
const startWorker = () => start('worker', 'dist/src/worker.js', { WORKER_MODE: 'true', OBS_METRICS_PORT: String(P.workerM) });
const startProbe = (target = `http://localhost:${P.api}/ready`) =>
  start('probe', 'dist/src/tools/event-loop-probe.js', { OBS_METRICS_PORT: String(P.probeM), PROBE_TARGETS: `ready=${target}`, PROBE_INTERVAL_MS: '3000' });
const kill = async (name, sig = 'SIGKILL') => { procs[name]?.kill(sig); await sleep(500); log('killed', name); };

const dk = (...a) => execFileSync('docker', a, { encoding: 'utf8' });
const psql = (sql) => dk('exec', 'crm-platform-postgres', 'psql', '-U', 'crm', '-d', DB, '-tAc', sql);

async function get(url) {
  return new Promise((res) => {
    http.get(url, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ s: r.statusCode, b })); }).on('error', () => res({ s: 0, b: '' }));
  });
}
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(1000); }
  log('TIMEOUT waiting for', label);
  return false;
}

// ---- alert tracker --------------------------------------------------------------------------------------------------------------
const seen = new Map(); // key -> {name, labels, pendingAt, firingAt, resolvedAt}
let phase = 'init';
async function poll() {
  const r = await get(`http://localhost:${P.prom}/api/v1/alerts`);
  if (r.s !== 200) return;
  const now = Date.now();
  const live = new Set();
  for (const a of JSON.parse(r.b).data.alerts) {
    const k = `${phase}|${a.labels.alertname}|${a.labels.job ?? a.labels.service ?? a.labels.queue ?? a.labels.target ?? ''}`;
    live.add(k);
    const e = seen.get(k) ?? { phase, alert: a.labels.alertname, labels: a.labels, pendingAt: null, firingAt: null, resolvedAt: null };
    if (a.state === 'pending' && !e.pendingAt) e.pendingAt = now;
    if (a.state === 'firing' && !e.firingAt) { e.firingAt = now; e.pendingAt ??= now; }
    e.resolvedAt = null;
    seen.set(k, e);
  }
  for (const [k, e] of seen) if (!live.has(k) && e.firingAt && !e.resolvedAt) e.resolvedAt = now;
}
setInterval(() => void poll(), 1000).unref();
const firing = async () => {
  const r = await get(`http://localhost:${P.prom}/api/v1/alerts`);
  return r.s === 200 ? JSON.parse(r.b).data.alerts.filter((a) => a.state === 'firing').map((a) => a.labels.alertname + (a.labels.job ? `{${a.labels.job}}` : '')) : [];
};

const results = [];
async function induce(id, desc, expect, doIt, undo, waitMs = 120000) {
  phase = id;
  const before = await firing();
  log('==', id, desc, '| firing before:', before.join(',') || 'none');
  const t0 = Date.now();
  await doIt();
  const t1 = Date.now();
  const ok = await waitFor(() => [...seen.values()].some((e) => e.phase === id && e.alert === expect.alert && e.firingAt && (!expect.job || e.labels.job === expect.job)), waitMs, `${expect.alert} in ${id}`);
  await sleep(3000);
  const mine = [...seen.values()].filter((e) => e.phase === id);
  const hit = mine.find((e) => e.alert === expect.alert && (!expect.job || e.labels.job === expect.job));
  results.push({
    id, desc, expectedAlert: expect.alert, fired: Boolean(hit?.firingAt),
    secondsToPending: hit?.pendingAt ? +((hit.pendingAt - t1) / 1000).toFixed(1) : null,
    secondsToFiring: hit?.firingAt ? +((hit.firingAt - t1) / 1000).toFixed(1) : null,
    inductionTookSeconds: +((t1 - t0) / 1000).toFixed(1),
    firingBefore: before,
    alsoFired: mine.filter((e) => e.firingAt && e !== hit).map((e) => e.alert + (e.labels.job ? `{${e.labels.job}}` : '')),
  });
  await undo();
  // let the alerts of this phase resolve (or time out) before the next phase
  await waitFor(async () => (await firing()).length === 0, 90000, `quiet after ${id}`);
  log('   result', JSON.stringify(results.at(-1)));
  return ok;
}

// ---- main -----------------------------------------------------------------------------------------------------------------------
async function main() {
  dk('run', '-d', '--name', names.redis, '-p', `${P.redis}:6379`, 'redis:7-alpine', 'redis-server', '--maxmemory', '8mb', '--maxmemory-policy', 'noeviction');
  dk('run', '-d', '--name', names.am, '--network', 'host', '-v', `${work}:/c`, 'prom/alertmanager:v0.27.0', '--config.file=/c/am.yml', `--web.listen-address=:${P.am}`, '--cluster.listen-address=', '--storage.path=/tmp/am');
  dk('run', '-d', '--name', names.prom, '--network', 'host', '-v', `${work}:/c`, 'prom/prometheus:v2.55.0', '--config.file=/c/prom.yml', `--web.listen-address=:${P.prom}`, '--storage.tsdb.path=/tmp/prom');
  await sleep(3000);
  startApi({ DB_POOL_MAX: '2' });
  startWorker();
  startProbe();
  await waitFor(async () => (await get(`http://localhost:${P.api}/health`)).s === 200, 90000, 'api health');
  log('api healthy; ready =', (await get(`http://localhost:${P.api}/ready`)).s);
  await sleep(20000);

  // 0. must-not-fire: healthy stack for 40 s
  phase = 'baseline';
  await sleep(40000);
  const base = await firing();
  results.push({ id: 'baseline', desc: 'healthy stack, 60 s', expectedAlert: null, fired: false, firingBefore: base, note: 'must be empty' });
  log('baseline firing:', base.join(',') || 'none');

  await induce('worker-kill', 'SIGKILL the worker', { alert: 'RuntimeMetricsTargetDown', job: 'crm-worker' }, () => kill('worker'), async () => { startWorker(); });
  await induce('probe-dead-port', 'probe aimed at a dead port', { alert: 'ApiProbeFailing' }, async () => { await kill('probe'); startProbe('http://localhost:1/ready'); }, async () => { await kill('probe'); startProbe(); });
  await induce('api-stop', 'SIGKILL the API', { alert: 'RuntimeMetricsTargetDown', job: 'crm-api' }, () => kill('api'), async () => { startApi({ DB_POOL_MAX: '2' }); await waitFor(async () => (await get(`http://localhost:${P.api}/health`)).s === 200, 60000, 'api'); });

  const fillSh = 'i=0; while [ $i -lt 600 ]; do redis-cli set fill$i $(head -c 20000 /dev/zero | tr "\\0" x) >/dev/null 2>&1; i=$((i+1)); done';
  await induce('redis-full', 'fill the private Redis to maxmemory (8 MB, noeviction)', { alert: 'RedisMemoryNearMax' },
    async () => { dk('exec', names.redis, 'sh', '-c', fillSh); },
    async () => { dk('exec', names.redis, 'redis-cli', 'flushall'); });
  await induce('redis-stop', 'stop the private Redis container', { alert: 'RedisDown' }, async () => { dk('stop', names.redis); }, async () => { dk('start', names.redis); await sleep(5000); });

  // outbox / dead letter, with the database reachable
  await waitFor(async () => (await get(`http://localhost:${P.api}/ready`)).s === 200, 60000, 'ready');
  await induce('outbox-dead', 'insert a dead outbox row', { alert: 'OutboxDeadRows' },
    async () => { psql(`INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload, status, attempts) VALUES (1,'alerttest',1,'alerttest.dead','{}','dead',9)`); },
    async () => { psql(`DELETE FROM event_outbox WHERE aggregate_module='alerttest'`); });
  // a due pending row held under a row lock: the drain (SKIP LOCKED) cannot take it, the sampler (plain read) still sees it due
  psql(`INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload, status, available_at) VALUES (1,'alerttest',2,'alerttest.stuck','{}','pending', now() - interval '15 minutes')`);
  const holder = spawn('docker', ['exec', '-i', 'crm-platform-postgres', 'psql', '-U', 'crm', '-d', DB], { stdio: ['pipe', 'ignore', 'ignore'] });
  holder.stdin.write(`BEGIN; SELECT id FROM event_outbox WHERE aggregate_module='alerttest' FOR UPDATE;\n`);
  await induce('outbox-stuck', 'due outbox row 15 min old that the drain cannot take', { alert: 'OutboxNotDraining' }, async () => {}, async () => { holder.kill(); await sleep(1000); psql(`DELETE FROM event_outbox WHERE aggregate_module='alerttest'`); });
  await induce('dead-letter-old', 'open failed operation 2 h old', { alert: 'DeadLetterOpenTooLong' },
    async () => { psql(`INSERT INTO failed_operations (source_queue, job_name, original_job_id, failure_category, error_code, policy_version, first_failed_at, last_failed_at, created_at) VALUES ('webhook-retry','alerttest','alerttest-1','provider','alerttest','test', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours')`); },
    async () => { psql(`DELETE FROM failed_operations WHERE job_name='alerttest'`); });

  // postgres: hang (pool exhausted), then refuse (5xx)
  const hammer = (secs, conc) => {
    let stop = false;
    for (let i = 0; i < conc; i++) (async () => { while (!stop) { await get(`http://localhost:${P.api}/ready`); await sleep(200); } })();
    setTimeout(() => (stop = true), secs * 1000);
    return () => (stop = true);
  };
  let stopHammer = () => {};
  await induce('pg-blackhole', 'Postgres accepts but never answers (TCP blackhole), pool max 2, 8 callers', { alert: 'DbPoolExhausted' },
    async () => { setPg('blackhole'); stopHammer = hammer(110, 8); }, async () => { stopHammer(); setPg('pass'); await sleep(8000); }, 100000);
  await induce('pg-down', 'Postgres unreachable (proxy refuses), 5 callers hitting /ready', { alert: 'ApiHighErrorRate' },
    async () => { setPg('down'); stopHammer = hammer(150, 5); }, async () => { stopHammer(); setPg('pass'); await sleep(8000); }, 140000);

  // alert delivery: what did the webhook receive?
  const delivered = received.filter((r) => r.body?.alerts?.length).map((r) => ({
    status: r.body.status, receiver: r.body.receiver,
    alerts: r.body.alerts.map((a) => ({ alertname: a.labels.alertname, severity: a.labels.severity, runbook: a.annotations.runbook ?? null, hasSummary: Boolean(a.annotations.summary) })),
  }));
  fs.writeFileSync(outFile, JSON.stringify({ forSeconds: FOR_S, scrapeSeconds: 5, ports: P, results, tracked: [...seen.values()], delivered }, null, 2));
  log('written', outFile);
}

async function cleanup() {
  for (const n of Object.keys(procs)) procs[n]?.kill('SIGKILL');
  for (const n of Object.values(names)) { try { execSync(`docker rm -f ${n}`, { stdio: 'ignore' }); } catch { /* gone */ } }
  proxy.close(); hook.close();
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await cleanup(); process.exit(); });
