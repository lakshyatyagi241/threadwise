#!/usr/bin/env node
// Live rules check (the check that caught the collision bug of #735; promtool tests alone do not): boots the built API against a
// throwaway database, starts a PRIVATE Prometheus (prom/prometheus:v2.55.0, host network) that loads the rule files of
// deploy/observability, generates authenticated traffic, then asserts every rule of the "cache-hit-rate" group has health=ok and the
// lookups / hit-ratio series are non-empty.
// Env in: LIVE_DB_URL (app role url of a migrated + seeded database), API_PORT, METRICS_PORT, REDIS_DB, OUT_DIR. Exit 1 on a failed assertion.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { LIVE_DB_URL, API_PORT = '3932', METRICS_PORT = '59532', REDIS_DB = '8', OUT_DIR } = process.env;
if (!LIVE_DB_URL || !OUT_DIR) throw new Error('LIVE_DB_URL and OUT_DIR are required');
mkdirSync(OUT_DIR, { recursive: true });
const token = randomBytes(16).toString('hex');
const name = `ri-prom-${randomBytes(3).toString('hex')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
const results = [];
const check = (n, pass, detail = '') => {
  results.push({ name: n, pass, detail });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${n} ${detail}`);
};

const env = { ...process.env };
for (const l of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in env)) env[m[1]] = m[2];
}
Object.assign(env, {
  NODE_OPTIONS: '',
  NODE_ENV: 'development',
  PORT: API_PORT,
  LOG_LEVEL: 'error',
  DATABASE_URL: LIVE_DB_URL,
  DATABASE_REPLICA_URL: LIVE_DB_URL,
  REDIS_URL: `redis://localhost:56379/${REDIS_DB}`,
  OBS_METRICS_PORT: METRICS_PORT,
  OBS_METRICS_HOST: '127.0.0.1',
  OBS_METRICS_TOKEN: token,
  WORKER_MODE: 'false',
});
const logFd = openSync(join(OUT_DIR, 'api.log'), 'w');
const api = spawn(process.execPath, ['dist/src/main.js'], { cwd: join(root, 'apps/api'), env, stdio: ['ignore', logFd, logFd] });
let exited = false;
api.on('exit', () => (exited = true));
const cleanup = () => {
  try { api.kill('SIGTERM'); } catch {}
  try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); } catch {}
};
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

let failed = false;
try {
  const base = `http://127.0.0.1:${API_PORT}`;
  let up = false;
  for (let i = 0; i < 120 && !exited; i++) {
    try { if ((await fetch(`${base}/ready`)).status === 200) { up = true; break; } } catch {}
    await sleep(1000);
  }
  check('api boots and is ready', up);
  if (!up) throw new Error('api did not become ready (see api.log)');

  // private Prometheus on the host network: scrape the API metrics listener every 2 s, evaluate rules every 2 s
  const cfg = join(OUT_DIR, 'prom');
  mkdirSync(cfg, { recursive: true });
  const rules = ['event-loop', 'queue-capacity', 'resource-limits', 'cache-hit-rate'].map((n) => `${n}.rules.yml`);
  writeFileSync(
    join(cfg, 'prometheus.yml'),
    `global: { scrape_interval: 2s, evaluation_interval: 2s }
rule_files:
${rules.map((r) => `  - /rules/${r}`).join('\n')}
scrape_configs:
  - job_name: crm-api
    metrics_path: /metrics
    authorization: { type: Bearer, credentials: ${token} }
    static_configs: [{ targets: ['127.0.0.1:${METRICS_PORT}'] }]
`,
  );
  const pport = await freePort();
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', name, '--network', 'host',
    '-v', `${cfg}:/etc/prometheus:ro`, '-v', `${join(root, 'deploy/observability')}:/rules:ro`,
    'prom/prometheus:v2.55.0', '--config.file=/etc/prometheus/prometheus.yml', `--web.listen-address=127.0.0.1:${pport}`,
    '--storage.tsdb.path=/prometheus',
  ]);
  const prom = `http://127.0.0.1:${pport}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${prom}/-/ready`)).ok) break; } catch {} await sleep(1000); }

  // traffic: login, then authenticated reads (hits the gate / RBAC / plan caches) for ~45 s
  let n = 0;
  const hdr = (t) => ({ 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), 'x-forwarded-for': `10.8.0.${n++ % 250}` });
  const lr = await fetch(`${base}/v2/auth/login`, { method: 'POST', headers: hdr(), body: JSON.stringify({ email: 'nachiket.challawar@geta.ai', password: 'Passw0rd!' }) });
  const tok = (await lr.json()).tokens?.accessToken;
  check('login for traffic', !!tok, `status ${lr.status}`);
  const end = Date.now() + 45_000;
  let ok = 0;
  while (Date.now() < end) {
    await Promise.all(['/v2/contacts?limit=20', '/v2/companies?limit=20', '/v2/contacts?limit=5&search=a'].map(async (p) => { const r = await fetch(`${base}${p}`, { headers: hdr(tok) }); if (r.ok) ok++; }));
    await sleep(100);
  }
  check('traffic generated', ok > 50, `${ok} ok responses`);
  await sleep(8000); // a few evaluation cycles

  const q = async (expr) => (await (await fetch(`${prom}/api/v1/query?query=${encodeURIComponent(expr)}`)).json()).data?.result ?? [];
  const groups = (await (await fetch(`${prom}/api/v1/rules`)).json()).data.groups;
  const g = groups.find((x) => x.name === 'cache-hit-rate');
  check('group cache-hit-rate is loaded', !!g);
  for (const r of g?.rules ?? []) check(`rule ${r.name} health=ok`, r.health === 'ok', `health=${r.health}${r.lastError ? ' error: ' + r.lastError : ''}`);
  const others = groups.flatMap((x) => x.rules.filter((r) => r.health !== 'ok').map((r) => `${x.name}/${r.name}`));
  console.log(`  other groups: ${others.length ? 'rules not ok: ' + others.join(', ') : 'all rules ok'} (informational)`);
  const raw = await q('crm_cache_hits_total');
  check('raw series crm_cache_hits_total non-empty', raw.length > 0, `${raw.length} series`);
  const lookups = await q('crm:cache_lookups:rate5m');
  check('crm:cache_lookups:rate5m non-empty', lookups.length > 0, `${lookups.length} series`);
  const ratio = await q('crm:cache_hit_ratio:5m');
  check('crm:cache_hit_ratio:5m non-empty', ratio.length > 0, `${ratio.length} series`);
  writeFileSync(join(OUT_DIR, 'live-series.json'), JSON.stringify({ lookups, ratio }, null, 2));
  failed = results.some((r) => !r.pass);
} catch (e) {
  console.error(String(e?.message ?? e));
  failed = true;
} finally {
  writeFileSync(join(OUT_DIR, 'live-checks.json'), JSON.stringify(results, null, 2));
  cleanup();
}
process.exit(failed ? 1 : 0);
