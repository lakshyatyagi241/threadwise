#!/usr/bin/env node
// Critical-path drill: REAL faults -> real Prometheus (repo rules, `for:` shortened in a copy) -> real Alertmanager (alertmanager.gchat.yml)
// -> real chat-bridge -> FAKE Google Chat receiver (fake-chat.mjs). Nothing here talks to chat.googleapis.com or any remote host.
// Usage: node tools/alerting/critical-path-drill.mjs <workDir> <out.json>    env: ALERT_DB (migrated throwaway db), QUICK=1 (faults pg + warning only)
import { spawn, execFileSync, execSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [work, outFile] = [path.resolve(process.argv[2]), path.resolve(process.argv[3])];
const ROOT = path.resolve(import.meta.dirname, '../..');
const API = path.join(ROOT, 'apps/api');
const QUICK = process.env.QUICK === '1';
const DB = process.env.ALERT_DB;
if (!DB) throw new Error('ALERT_DB is required');
const FOR_S = 20, GROUP_INTERVAL = '15s';
const sfx = Math.random().toString(36).slice(2, 7);
const names = { redis: `cpd-redis-${sfx}`, prom: `cpd-prom-${sfx}`, am: `cpd-am-${sfx}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const P = {};
for (const k of ['api', 'apiM', 'workerM', 'probeM', 'prom', 'am', 'redisRaw', 'redis', 'pg', 'chat', 'bridge']) P[k] = await freePort();
const procs = {}; const checks = []; const faults = [];
const check = (name, pass, detail = '') => { checks.push({ name, pass: Boolean(pass), detail }); log(pass ? 'PASS' : 'FAIL', name, detail); };
fs.mkdirSync(work, { recursive: true });

// ---- configs: rules copy with every `for:` shortened (repo files untouched), repo gchat Alertmanager config pointed at the local bridge
const rulesDir = path.join(work, 'rules'); fs.mkdirSync(rulesDir, { recursive: true });
const obs = path.join(ROOT, 'deploy/observability');
const ruleFiles = fs.readdirSync(obs).filter((f) => f.endsWith('.rules.yml'));
for (const f of ruleFiles) fs.writeFileSync(path.join(rulesDir, f), fs.readFileSync(path.join(obs, f), 'utf8').replace(/^(\s*for: )\d+[smh]$/gm, `$1${FOR_S}s`));
const writeProm = (apiPort) => fs.writeFileSync(path.join(work, 'prom.yml'), `global: { scrape_interval: 5s, evaluation_interval: 5s }
rule_files: [${ruleFiles.map((f) => `/c/rules/${f}`).join(', ')}]
alerting: { alertmanagers: [{ static_configs: [{ targets: ['localhost:${P.am}'] }] }] }
scrape_configs:
  - { job_name: crm-api, static_configs: [{ targets: ['localhost:${apiPort}'] }] }
  - { job_name: crm-worker, static_configs: [{ targets: ['localhost:${P.workerM}'] }] }
  - { job_name: crm-probe, static_configs: [{ targets: ['localhost:${P.probeM}'] }] }
`);
writeProm(P.apiM);
const amSrc = fs.readFileSync(path.join(obs, 'alertmanager.gchat.yml'), 'utf8');
fs.writeFileSync(path.join(work, 'am.yml'), amSrc.replace('http://gchat-bridge:9095/alertmanager', `http://127.0.0.1:${P.bridge}/alertmanager`).replace(/group_interval: 2m/g, `group_interval: ${GROUP_INTERVAL}`));

// ---- TCP fault proxy (modes: pass, blackhole, down)
function makeProxy(listen, target) {
  const st = { mode: 'pass', socks: new Set() };
  st.server = createServer((c) => {
    if (st.mode === 'down') return c.destroy();
    st.socks.add(c); c.on('close', () => st.socks.delete(c)); c.on('error', () => {});
    if (st.mode === 'blackhole') return;
    const u = connect(target, '127.0.0.1'); st.socks.add(u); u.on('error', () => c.destroy()); c.on('error', () => u.destroy()); c.pipe(u); u.pipe(c);
  }).listen(listen, '127.0.0.1');
  st.set = (m) => { st.mode = m; if (m !== 'pass') for (const s of st.socks) s.destroy(); };
  return st;
}
const pgProxy = makeProxy(P.pg, 5432), redisProxy = makeProxy(P.redis, P.redisRaw);

// ---- processes
const baseEnv = { ...process.env, NODE_ENV: 'development',
  DATABASE_URL: `postgres://crm_app_user:crm_app_dev@localhost:${P.pg}/${DB}`, MIGRATION_DATABASE_URL: `postgres://crm:crm@localhost:5432/${DB}`,
  DATABASE_REPLICA_URL: `postgres://crm_app_user:crm_app_dev@localhost:${P.pg}/${DB}`, REDIS_URL: `redis://localhost:${P.redis}`,
  OBS_METRICS_HOST: '127.0.0.1', INFRA_WORKER_HEARTBEAT_SECONDS: '5' };
function start(name, file, env, cwd = API) {
  const out = fs.openSync(path.join(work, `${name}.log`), 'a');
  procs[name] = spawn('node', [file], { cwd, env: { ...baseEnv, ...env }, stdio: ['ignore', out, out] });
  log('started', name, procs[name].pid);
}
const startProbe = (target = `http://localhost:${P.api}/ready`) => start('probe', 'dist/src/tools/event-loop-probe.js', { OBS_METRICS_PORT: String(P.probeM), PROBE_TARGETS: `ready=${target}`, PROBE_INTERVAL_MS: '3000' });
const dk = (...a) => execFileSync('docker', a, { encoding: 'utf8' });
const get = (url) => new Promise((res) => { http.get(url, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ s: r.statusCode, b })); }).on('error', () => res({ s: 0, b: '' })); });
const post = (url) => new Promise((res) => { const r = http.request(url, { method: 'POST' }, (x) => { x.resume(); x.on('end', () => res(x.statusCode)); }); r.on('error', () => res(0)); r.end(); });
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(1000); } log('TIMEOUT', label); return false; };

// ---- observation: chat spaces, Prometheus alerts, Alertmanager
const chat = async () => JSON.parse((await get(`http://127.0.0.1:${P.chat}/api.json`)).b || '{}');
const flat = (m) => { // flatten a Chat message body to {title, rows[], buttons[]}
  const card = (m.cardsV2?.[0]?.card) ?? {}; const rows = [], buttons = [];
  for (const s of card.sections ?? []) for (const w of s.widgets ?? []) {
    if (w.decoratedText) rows.push(`${w.decoratedText.topLabel ?? ''}: ${w.decoratedText.text ?? ''}`);
    if (w.textParagraph) rows.push(w.textParagraph.text);
    for (const b of w.buttonList?.buttons ?? []) buttons.push(`${b.text} -> ${b.onClick?.openLink?.url}`);
  }
  return { text: m.text, title: card.header?.title ?? '', rows, buttons };
};
const seenProm = new Map(); // alertname|labels -> {severity, firingAt}
setInterval(async () => {
  const r = await get(`http://localhost:${P.prom}/api/v1/alerts`); if (r.s !== 200) return;
  for (const a of JSON.parse(r.b).data.alerts) { const k = `${a.labels.alertname}|${a.labels.job ?? a.labels.service ?? a.labels.target ?? ''}`; const e = seenProm.get(k) ?? { alert: a.labels.alertname, severity: a.labels.severity, firingAt: null }; if (a.state === 'firing' && !e.firingAt) e.firingAt = Date.now(); seenProm.set(k, e); }
}, 1000).unref();
const promFiring = async () => { const r = await get(`http://localhost:${P.prom}/api/v1/alerts`); return r.s === 200 ? JSON.parse(r.b).data.alerts.filter((a) => a.state === 'firing').map((a) => a.labels.alertname) : []; };
const incidents = async () => JSON.parse((await get(`http://127.0.0.1:${P.bridge}/incidents`)).b || '{}');
// all messages of one space grouped by thread, oldest first
const threadsOf = (msgs) => { const t = {}; for (const m of [...msgs].reverse()) (t[m.thread] ??= []).push({ at: Date.parse(m.at), ...flat(m.body) }); return t; };
const cardFor = (msgs, alertname) => { const t = threadsOf(msgs); for (const [k, list] of Object.entries(t)) if (list[0].text?.includes(alertname) && /FIRING/.test(list[0].title)) return { thread: k, list }; return null; };

async function fault(id, desc, expectAlerts, doIt, undo, { waitMs = 120000, noPostAlerts = [] } = {}) {
  log('==', id, desc);
  const before = await chat(); const nBefore = Object.values(before).reduce((a, x) => a + x.length, 0);
  const t1 = Date.now(); await doIt(); const tFault = Date.now();
  const rec = { id, desc, faultStart: new Date(tFault).toISOString(), expected: {} };
  for (const alertname of expectAlerts) {
    const ok = await waitFor(async () => Boolean(cardFor((await chat()).critical ?? [], alertname)), waitMs, `${alertname} card`);
    const c = cardFor((await chat()).critical ?? [], alertname);
    rec.expected[alertname] = { cardAppeared: ok, secondsToCard: c ? +((c.list[0].at - tFault) / 1000).toFixed(1) : null, thread: c?.thread ?? null, card: c ? { title: c.list[0].title, rows: c.list[0].rows, buttons: c.list[0].buttons } : null };
    check(`${id}: critical card for ${alertname}`, ok, c ? `${rec.expected[alertname].secondsToCard}s after fault start` : 'no card');
  }
  await sleep(Number(process.env.REPEAT_WAIT_MS ?? 20000)); // let a group_interval repeat arrive
  rec.incidentsDuring = (await incidents()).incidents?.map((i) => ({ playbook: i.playbook, state: i.state, thread: i.threadKey, steps: i.events.map((e) => e.label) })) ?? [];
  const mid = await chat();
  for (const alertname of expectAlerts) {
    const e = rec.expected[alertname]; if (!e.thread) continue;
    const list = threadsOf(mid.critical ?? [])[e.thread] ?? [];
    e.messagesInThread = list.map((m) => `${m.title}`);
    e.topLevelCards = list.filter((m) => /FIRING/.test(m.title)).length;
    e.repeatReplies = list.filter((m) => /Still firing/.test(m.title)).length;
    e.resolverSteps = list.filter((m) => /^(DIAGNOSED|ACTION|ESCALATED|VERIFIED)/.test(m.title)).map((m) => `${m.title}: ${m.rows.join(' ').slice(0, 220)}`);
    check(`${id}: ${alertname} has one top-level card (one thread per fingerprint)`, e.topLevelCards === 1, `top-level=${e.topLevelCards}, repeats=${e.repeatReplies}`);
  }
  const fired = await promFiring(); rec.promFiringAtEnd = fired;
  const swallowed = await get(`http://localhost:${P.am}/api/v2/alerts?inhibited=true&silenced=false`);
  rec.alertmanagerInhibited = swallowed.s === 200 ? JSON.parse(swallowed.b).filter((a) => a.status?.inhibitedBy?.length).map((a) => `${a.labels.alertname}(${a.labels.severity})`) : ['am-unreachable'];
  for (const n of noPostAlerts) {
    const all = JSON.stringify(await chat());
    check(`${id}: warning ${n} fired in Prometheus but was NOT posted to Chat`, Boolean([...seenProm.values()].find((e) => e.alert === n && e.firingAt)) && !all.includes(n), all.includes(n) ? 'LEAKED to chat' : 'not posted');
    rec.noPost = { [n]: { promFired: Boolean([...seenProm.values()].find((e) => e.alert === n && e.firingAt)), inChat: all.includes(n) } };
  }
  const tUndo = Date.now(); await undo();
  for (const alertname of expectAlerts) {
    const e = rec.expected[alertname]; if (!e.thread) continue;
    const ok = await waitFor(async () => (threadsOf((await chat()).critical ?? [])[e.thread] ?? []).some((m) => /^RESOLVED/.test(m.title)), 150000, `${alertname} resolved reply`);
    const list = threadsOf((await chat()).critical ?? [])[e.thread] ?? []; const r = list.find((m) => /^RESOLVED/.test(m.title));
    e.resolve = { appearedInSameThread: ok, secondsAfterFaultEnd: r ? +((r.at - tUndo) / 1000).toFixed(1) : null, title: r?.title ?? null, rows: r?.rows ?? [] };
    check(`${id}: RESOLVED reply in the same thread for ${alertname}`, ok, r ? `${e.resolve.secondsAfterFaultEnd}s after fault end: ${r.title}` : 'none');
  }
  await waitFor(async () => (await promFiring()).length === 0, 90000, `quiet after ${id}`);
  faults.push(rec); return rec;
}

async function main() {
  dk('run', '-d', '--name', names.redis, '-p', `127.0.0.1:${P.redisRaw}:6379`, 'redis:7-alpine');
  dk('run', '-d', '--name', names.am, '--network', 'host', '-v', `${work}:/c`, 'prom/alertmanager:v0.27.0', '--config.file=/c/am.yml', `--web.listen-address=127.0.0.1:${P.am}`, '--cluster.listen-address=', '--storage.path=/tmp/am');
  dk('run', '-d', '--name', names.prom, '--network', 'host', '-v', `${work}:/c`, 'prom/prometheus:v2.55.0', '--config.file=/c/prom.yml', `--web.listen-address=127.0.0.1:${P.prom}`, '--web.enable-lifecycle', '--storage.tsdb.path=/tmp/prom');
  // fake Chat on its own port; three DISTINCT urls so a mis-route is visible
  start('fakechat', 'tools/chat-bridge/fake-chat.mjs', { FAKE_CHAT_PORT: String(P.chat), FAKE_CHAT_HOST: '127.0.0.1' }, ROOT);
  const u = (s) => `http://127.0.0.1:${P.chat}/hook/${s}`;
  start('bridge', 'tools/chat-bridge/index.mjs', { PORT: String(P.bridge), SLOW_WATCHER: '0', CHAT_ALLOW_ANY_HOST: '1', PROMETHEUS_URL: `http://127.0.0.1:${P.prom}`, GCHAT_CRITICAL_URL: u('critical'), GCHAT_SLOWQUERY_URL: u('slowquery'), GCHAT_DEPLOY_URL: u('deploy'), AUTO_REMEDIATE: '', INCIDENTS_DIR: path.join(work, 'incidents'), GRAFANA_URL: 'http://grafana.invalid' }, ROOT);
  start('api', 'dist/src/main.js', { PORT: String(P.api), OBS_METRICS_PORT: String(P.apiM), DB_POOL_MAX: '2' });
  start('worker', 'dist/src/worker.js', { WORKER_MODE: 'true', OBS_METRICS_PORT: String(P.workerM) });
  startProbe();
  await waitFor(async () => (await get(`http://localhost:${P.api}/health`)).s === 200, 90000, 'api health');
  await waitFor(async () => (await get(`http://127.0.0.1:${P.bridge}/health`)).s === 200 && (await get(`http://127.0.0.1:${P.chat}/api.json`)).s === 200, 20000, 'bridge+chat');
  log('ready =', (await get(`http://localhost:${P.api}/ready`)).s); await sleep(25000);
  const inc0 = await incidents(); check('AUTO_REMEDIATE is dry-run (bridge /incidents mode)', inc0.mode === 'dry-run', `mode=${inc0.mode}`);
  const base = await promFiring(); check('baseline: nothing firing and nothing posted on a healthy stack', base.length === 0 && Object.values(await chat()).every((x) => x.length === 0), `firing=${base.join(',') || 'none'}`);

  let stop = () => {};
  const hammer = (secs, conc) => { let s = false; for (let i = 0; i < conc; i++) (async () => { while (!s) { await get(`http://localhost:${P.api}/ready`); await sleep(200); } })(); setTimeout(() => (s = true), secs * 1000); return () => (s = true); };
  // 1. Postgres hang: pool exhausted AND SELECT 1 failing
  await fault('pg-hang', 'Postgres accepts TCP but never answers (black-hole proxy), pool max 2, 8 callers', ['DbPoolExhausted', 'PostgresDown'],
    async () => { pgProxy.set('blackhole'); stop = hammer(150, 8); }, async () => { stop(); pgProxy.set('pass'); await sleep(8000); });
  check('pg-hang: API process survived the hang', procs.api.exitCode === null);
  // 4. warning-only: the API metrics target is repointed to a dead port, so CacheMetricsMissing (warning) fires
  await fault('warning-only', 'API metrics target unreachable: CacheMetricsMissing (warning) must not reach Chat', [],
    async () => { writeProm(1); await post(`http://localhost:${P.prom}/-/reload`); }, async () => { writeProm(P.apiM); await post(`http://localhost:${P.prom}/-/reload`); await sleep(8000); }, { noPostAlerts: ['CacheMetricsMissing'] });
  if (!QUICK) {
    // 2. Redis killed behind its proxy
    await fault('redis-down', 'Redis refuses every connection (proxy down)', ['RedisDown'], async () => { redisProxy.set('down'); }, async () => { redisProxy.set('pass'); await sleep(8000); });
    // 3. probe aimed at a dead port
    await fault('probe-dead-port', 'probe aimed at a dead port', ['ApiProbeFailing'],
      async () => { procs.probe.kill('SIGKILL'); await sleep(500); startProbe('http://localhost:1/ready'); }, async () => { procs.probe.kill('SIGKILL'); await sleep(500); startProbe(); await sleep(8000); });
  }
  // global checks
  const fin = await chat();
  check('nothing leaked into Slow Queries', (fin.slowquery ?? []).length === 0, `${(fin.slowquery ?? []).length} messages`);
  check('nothing leaked into Deployments', (fin.deploy ?? []).length === 0, `${(fin.deploy ?? []).length} messages`);
  const warnPosted = (fin.critical ?? []).filter((m) => /warning/i.test(JSON.stringify(flat(m.body).rows.concat(flat(m.body).title)))).length;
  check('no warning-severity card in the Critical space', warnPosted === 0, `${warnPosted}`);
  const inc = await incidents(); const states = inc.incidents.map((i) => `${i.playbook}:${i.state}`);
  check('resolver never auto-acted (no ACTION other than DRY-RUN, no cancel/terminate)', !JSON.stringify(fin).match(/Cancelled|Terminated idle/) && (fin.critical ?? []).filter((m) => /^ACTION/.test(flat(m.body).title)).every((m) => /DRY-RUN/.test(flat(m.body).rows.join(' '))), states.join(','));
  check('critical cards carry a runbook reference', faults.every((f) => Object.values(f.expected).every((e) => !e.card || e.card.rows.concat(e.card.buttons).join(' ').match(/runbook|Runbook|docs\/runbooks/))), 'see card rows');
  const metrics = (await get(`http://127.0.0.1:${P.bridge}/metrics`)).b;
  fs.writeFileSync(outFile, JSON.stringify({ forSeconds: FOR_S, scrapeSeconds: 5, groupInterval: GROUP_INTERVAL, quick: QUICK, faults, incidents: inc, checks, bridgeMetrics: metrics.split('\n').filter((l) => /^crm_(chat_bridge_(sent|failed|dropped)|incident)/.test(l)), chatCounts: Object.fromEntries(Object.entries(fin).map(([k, v]) => [k, v.length])), seenProm: [...seenProm.values()] }, null, 2));
  if (checks.some((c) => !c.pass)) process.exitCode = 1;
}
async function cleanup() {
  for (const n of Object.keys(procs)) procs[n]?.kill('SIGKILL');
  for (const n of Object.values(names)) { try { execSync(`docker rm -f ${n}`, { stdio: 'ignore' }); } catch { /* gone */ } }
}
main().catch((e) => { console.error(e); process.exitCode = 2; }).finally(async () => { await cleanup(); process.exit(); });
