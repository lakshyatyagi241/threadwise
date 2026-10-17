#!/usr/bin/env node
// A real Prometheus + Alertmanager watching a real API process, a real worker process and a real probe process (EL-B02, B12, B13).
//
//   pnpm --filter @crm/db --filter @crm/contracts --filter @crm/config --filter @crm/tax build
//   pnpm --filter @crm/api build
//   node tools/event-loop-audit/scrape-demo.mjs                  # steady state, probe, receiver, worker killed
//   node tools/event-loop-audit/scrape-demo.mjs --stall          # + API stall, worker stall with a backlog, a 12 s block
//   node tools/event-loop-audit/scrape-demo.mjs --phases=api,long   # pick phases (api, worker, long)
//
// It starts throwaway Postgres + Redis containers, migrates, runs the BUILT api (dist/src/main.js), worker (dist/src/worker.js) and
// probe (dist/src/tools/event-loop-probe.js) as separate processes, then runs prom/prometheus and prom/alertmanager with the files
// from deploy/observability (only addresses and intervals are rewritten, so what ships is what is tested) and asks their own HTTP
// APIs what they see. A small HTTP server in this script plays the alert destination, so delivery of firing and resolved
// notifications is observed, not assumed. Stalls are injected into the live processes through their inspectors: no app change.
// Needs Docker (prom/alertmanager is pulled the first time). Takes about 10 minutes, about 35 with --stall. Exit 1 on a failed check.
//
// Host ports: 55433 Postgres, 56380 Redis, 3998 API, 9464/9465/9466 metrics of api/worker/probe, 9099 Prometheus, 9500 receiver,
// 9229/9230 inspectors of api/worker (loopback only). The metrics listeners bind 0.0.0.0 (so the containers can reach them through
// host.docker.internal) behind a random per-run bearer token; on Windows the firewall may ask whether node.exe may listen.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const apiDir = join(root, 'apps/api');
const require = createRequire(join(apiDir, 'package.json'));
const { Client } = require('pg');
const { runMigrations } = require('@crm/db');
const { Queue } = require('bullmq');

const argv = process.argv.slice(2);
const phaseArg = argv.find((a) => a.startsWith('--phases='))?.slice('--phases='.length);
const PHASES = new Set(
  (phaseArg ?? (argv.includes('--stall') ? 'api,worker,long' : '')).split(',').filter(Boolean),
);
const INSPECT = PHASES.size > 0;

const P = {
  pg: 55433,
  redis: 56380,
  api: 3998,
  apiMetrics: 9464,
  workerMetrics: 9465,
  probeMetrics: 9466,
  prom: 9099,
  receiver: 9500,
  inspectApi: 9229,
  inspectWorker: 9230,
};
const NAMES = {
  pg: 'el-scrape-pg',
  redis: 'el-scrape-redis',
  prom: 'el-scrape-prom',
  am: 'el-scrape-am',
  net: 'el-scrape-net',
};
const token = randomBytes(24).toString('hex');
const work = mkdtempSync(join(tmpdir(), 'el-scrape-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) =>
  execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`,
  );
};
const observe = (msg) => console.log(`OBSERVE  ${msg}`);
async function waitFor(what, fn, timeoutMs, everyMs = 1000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

const procs = [];
let receiverServer;
function cleanup() {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* already gone */
    }
  }
  try {
    receiverServer?.close();
  } catch {
    /* not started */
  }
  for (const n of [NAMES.pg, NAMES.redis, NAMES.prom, NAMES.am]) {
    try {
      docker('rm', '-f', n);
    } catch {
      /* not running */
    }
  }
  try {
    docker('network', 'rm', NAMES.net);
  } catch {
    /* not created */
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

async function prom(path) {
  const r = await fetch(`http://127.0.0.1:${P.prom}${path}`);
  return (await r.json()).data;
}
const instant = async (q) => (await prom(`/api/v1/query?query=${encodeURIComponent(q)}`)).result;
const num = async (q) => {
  const r = await instant(q);
  return r.length ? Number(r[0].value[1]) : Number.NaN;
};
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(3) : 'n/a');
const alerts = async () => (await prom('/api/v1/alerts')).alerts;
const alertState = async (name) => (await alerts()).find((a) => a.labels.alertname === name)?.state;
const firing = async (name) =>
  (await alerts()).find((a) => a.labels.alertname === name && a.state === 'firing');

/** Runs `expression` inside a live process through its inspector (Chrome DevTools Protocol over a WebSocket). */
async function inspectorEval(port, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('inspector connection failed'));
  });
  const reply = new Promise((res) => {
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id === 1) res(d);
    };
  });
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    }),
  );
  const r = await reply;
  ws.close();
  return r;
}
const startStall = (port, busyMs, everyMs) =>
  inspectorEval(
    port,
    `globalThis.__elStall = setInterval(() => { const e = Date.now() + ${busyMs}; while (Date.now() < e) {} }, ${everyMs}); 1`,
  );
const stopStall = (port) =>
  inspectorEval(port, 'clearInterval(globalThis.__elStall); 1').catch(() => undefined);

// ---- the alert destination: records what Alertmanager delivers ------------------------------------------------------------
const delivered = [];
function startReceiver() {
  receiverServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        for (const a of msg.alerts ?? [])
          delivered.push({
            name: a.labels?.alertname,
            status: a.status,
            at: Date.now(),
            labels: a.labels,
          });
      } catch {
        /* not JSON */
      }
      res.writeHead(200).end('ok');
    });
  });
  receiverServer.listen(P.receiver, '0.0.0.0');
}
const wasDelivered = (name, status) =>
  delivered.some((d) => d.name === name && d.status === status);

/** Reads a deployment file and changes only what the demo must (addresses, intervals, secret paths); a missing pattern is an error. */
function swap(text, pairs) {
  let out = text;
  for (const [from, to] of pairs) {
    if (!out.includes(from))
      throw new Error(`deployment file no longer contains "${from}": update the demo`);
    out = out.split(from).join(to);
  }
  return out;
}

// ---- phases ----------------------------------------------------------------------------------------------------------------------
let clientMs = [];
const clientP95 = () => {
  const s = [...clientMs].sort((a, b) => a - b);
  return (s[Math.floor(s.length * 0.95)] ?? 0) / 1000;
};
function startLoad() {
  let stop = false;
  clientMs = [];
  const one = async () => {
    while (!stop) {
      const t0 = performance.now();
      try {
        await fetch(`http://127.0.0.1:${P.api}/health`);
        clientMs.push(performance.now() - t0);
      } catch {
        /* the API may be mid-block */
      }
      await sleep(50);
    }
  };
  const loops = [one(), one()];
  return async () => {
    stop = true;
    await Promise.all(loops);
  };
}

async function apiStallPhase() {
  console.log('\n== API stall: 1500 ms busy every 1700 ms ==');
  const stopLoad = startLoad();
  await startStall(P.inspectApi, 1500, 1700);
  try {
    const seen = await waitFor(
      'stalled windows',
      async () =>
        (await num('max_over_time(crm_event_loop_delay_max_seconds{service="api"}[1m])')) > 1
          ? true
          : null,
      180_000,
      5000,
    );
    void seen;
    check(
      'Prometheus sees the injected stall as a large max delay',
      true,
      `${fmt(await num('max_over_time(crm_event_loop_delay_max_seconds{service="api"}[1m])'))} s`,
    );
    observe(
      `api target availability over the stall so far: ${fmt(await num('avg_over_time(up{job="crm-api"}[2m])'))}`,
    );

    // Both critical alerts need a 5 minute hold on top of their windows.
    const both = async () =>
      (await firing('EventLoopBlockingWithImpact')) && (await firing('ApiCallerLatencyHigh'))
        ? true
        : null;
    await waitFor('both API critical alerts', both, 900_000, 10_000).catch(() => null);
    const serverP95 = await num(
      'histogram_quantile(0.95, sum by (le) (rate(crm_http_request_duration_seconds_bucket{service="api",route="/health"}[5m])))',
    );
    const probeP95 = await num(
      'histogram_quantile(0.95, sum by (le) (rate(crm_probe_http_duration_seconds_bucket{target="health"}[2m])))',
    );
    observe(
      `p95: loop delay ${fmt(await num('crm_event_loop_delay_p95_seconds{service="api"}'))} s, ELU ${fmt(await num('crm_event_loop_utilization_ratio{service="api"}'))}; /health seen by callers (load) ${clientP95().toFixed(3)} s, by the probe ${fmt(probeP95)} s, by the server histogram ${fmt(serverP95)} s`,
    );
    check(
      'callers and the probe saw the stall; the server request histogram did not',
      clientP95() > 0.25 && probeP95 > 0.25 && serverP95 < 0.1,
      `load ${clientP95().toFixed(3)} / probe ${fmt(probeP95)} / server ${fmt(serverP95)} s`,
    );
    observe(`alerts: ${(await alerts()).map((a) => `${a.labels.alertname}:${a.state}`).join(' ')}`);
    const impact = await firing('EventLoopBlockingWithImpact');
    check(
      'EventLoopBlockingWithImpact fires from a real, sustained API stall',
      Boolean(impact),
      impact ? impact.labels.job : 'not firing',
    );
    const callers = await firing('ApiCallerLatencyHigh');
    check(
      'ApiCallerLatencyHigh (the probe, outside the API process) fires from the same stall',
      Boolean(callers),
      callers ? callers.labels.target : 'not firing',
    );
  } finally {
    await stopLoad();
    await stopStall(P.inspectApi);
  }
  const back = await waitFor(
    'the API loop to recover',
    async () => {
      const m = await num('crm_event_loop_delay_max_seconds{service="api"}');
      return m < 0.3 ? m : null;
    },
    120_000,
    3000,
  );
  check('the API loop recovers once the stall stops', true, `max delay ${fmt(back)} s`);
}

async function workerStallPhase() {
  console.log(
    '\n== worker stall with a queue backlog: 600 ms busy every 700 ms, 20000 queued jobs ==',
  );
  const queue = new Queue('tpl-sweep', {
    connection: { host: '127.0.0.1', port: P.redis, maxRetriesPerRequest: null },
  });
  await startStall(P.inspectWorker, 600, 700);
  await queue.addBulk(
    Array.from({ length: 20_000 }, (_, i) => ({ name: 'sweep', data: { slot: i } })),
  );
  console.log('backlog queued');
  try {
    const alert = await waitFor(
      'WorkerEventLoopBlockingWithQueueImpact firing',
      async () => (await firing('WorkerEventLoopBlockingWithQueueImpact')) ?? null,
      1_200_000,
      10_000,
    ).catch(() => null);
    observe(
      `worker: loop delay p95 ${fmt(await num('crm_event_loop_delay_p95_seconds{service="worker"}'))} s; job wait p95 (5m) ${fmt(await num('histogram_quantile(0.95, sum by (le) (rate(crm_queue_job_wait_seconds_bucket{queue="tpl-sweep"}[5m])))'))} s; jobs done ${fmt(await num('sum(crm_queue_jobs_total{queue="tpl-sweep"})'))}`,
    );
    observe(`alerts: ${(await alerts()).map((a) => `${a.labels.alertname}:${a.state}`).join(' ')}`);
    check(
      'WorkerEventLoopBlockingWithQueueImpact fires from a real worker stall with a real queue backlog',
      Boolean(alert),
      alert ? alert.labels.job : 'not firing',
    );
  } finally {
    await stopStall(P.inspectWorker);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }
  const back = await waitFor(
    'the worker loop to recover',
    async () => {
      const m = await num('crm_event_loop_delay_max_seconds{service="worker"}');
      return m < 0.3 ? m : null;
    },
    180_000,
    3000,
  );
  check('the worker loop recovers once the stall stops', true, `max delay ${fmt(back)} s`);
}

async function longBlockPhase() {
  console.log('\n== one 12 s block in the API process ==');
  const t0 = Date.now();
  await inspectorEval(P.inspectApi, 'const e = Date.now() + 12000; while (Date.now() < e) {} 1');
  observe(`the block lasted ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const crit = await waitFor(
    'EventLoopLongStallCritical firing',
    async () => (await firing('EventLoopLongStallCritical')) ?? null,
    180_000,
    3000,
  ).catch(() => null);
  check(
    'EventLoopLongStallCritical fires for a single 12 s block (no hold)',
    Boolean(crit),
    crit ? fmt(Number(crit.value)) : 'not firing',
  );
  const warn = await firing('EventLoopLongStallWarning');
  check('EventLoopLongStallWarning fires too', Boolean(warn));
  const worst = await num('min_over_time(up{job="crm-api"}[3m])');
  check(
    'the blocked API failed at least one scrape (up dipped to 0)',
    worst === 0,
    `min up ${worst}`,
  );
  const td = await alertState('RuntimeMetricsTargetDown');
  observe(
    `RuntimeMetricsTargetDown after a 12 s block: ${td ?? 'inactive'} (its 2 minute hold is longer than the block)`,
  );
  await waitFor(
    'the API to answer again',
    async () => (await num('up{job="crm-api"}')) === 1,
    60_000,
    2000,
  );
}

// ---- main ----------------------------------------------------------------------------------------------------------------------
async function main() {
  for (const n of [NAMES.pg, NAMES.redis, NAMES.prom, NAMES.am]) {
    try {
      docker('rm', '-f', n);
    } catch {
      /* none */
    }
  }
  try {
    docker('network', 'rm', NAMES.net);
  } catch {
    /* none */
  }
  startReceiver();
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    NAMES.pg,
    '-e',
    'POSTGRES_DB=crm',
    '-e',
    'POSTGRES_USER=crm',
    '-e',
    'POSTGRES_PASSWORD=crm',
    '-p',
    `${P.pg}:5432`,
    'pgvector/pgvector:pg16',
  );
  docker('run', '-d', '--rm', '--name', NAMES.redis, '-p', `${P.redis}:6379`, 'redis:7-alpine');
  const ownerUrl = `postgres://crm:crm@127.0.0.1:${P.pg}/crm`;
  await waitFor(
    'postgres',
    async () => {
      const c = new Client({ connectionString: ownerUrl });
      await c.connect();
      await c.end();
      return true;
    },
    120_000,
    2000,
  );
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query(
    `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await runMigrations(ownerUrl, {
    dir: join(root, 'packages/db/migrations'),
    log: () => undefined,
  });
  await owner.end();
  console.log('infrastructure up, migrated');

  // ---- the three real processes ---------------------------------------------------------------------------------------------
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    PORT: String(P.api),
    APP_URL: `http://localhost:${P.api}`,
    WEB_APP_URL: 'http://localhost:3001',
    APP_NAME: 'Scrape demo',
    TRUST_PROXY: 'loopback',
    DATABASE_URL: `postgres://crm_app_user:test@127.0.0.1:${P.pg}/crm`,
    MIGRATION_DATABASE_URL: ownerUrl,
    REDIS_URL: `redis://127.0.0.1:${P.redis}`,
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    CLERK_SECRET_KEY: 'sk_test_unused',
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    OBS_METRICS_HOST: '0.0.0.0',
    OBS_METRICS_TOKEN: token,
    OBS_RUNTIME_INTERVAL_SECONDS: '5',
  };
  const start = (name, entry, extra, inspectPort) => {
    const log = join(work, `${name}.log`);
    const fd = openSync(log, 'w');
    const execArgv = INSPECT && inspectPort ? [`--inspect=127.0.0.1:${inspectPort}`] : [];
    const child = spawn(process.execPath, [...execArgv, entry], {
      cwd: apiDir,
      env: { ...baseEnv, ...extra },
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    procs.push(child);
    child.on('exit', (code) => console.log(`${name} exited (${code})`));
    return child;
  };
  start('api', 'dist/src/main.js', { OBS_METRICS_PORT: String(P.apiMetrics) }, P.inspectApi);
  const worker = start(
    'worker',
    'dist/src/worker.js',
    { WORKER_MODE: 'true', OBS_METRICS_PORT: String(P.workerMetrics) },
    P.inspectWorker,
  );
  const scrapeDirect = async (port, auth = true) => {
    const r = await fetch(
      `http://127.0.0.1:${port}/metrics`,
      auth ? { headers: { authorization: `Bearer ${token}` } } : {},
    );
    return { status: r.status, text: await r.text() };
  };
  for (const [name, port] of [
    ['api', P.apiMetrics],
    ['worker', P.workerMetrics],
  ]) {
    await waitFor(
      `${name} metrics listener`,
      async () => (await scrapeDirect(port)).status === 200,
      600_000,
      3000,
    );
  }
  await waitFor(
    'the API to answer /ready',
    async () => (await fetch(`http://127.0.0.1:${P.api}/ready`)).status === 200,
    300_000,
    3000,
  ).catch(() => undefined);
  start('probe', 'dist/src/tools/event-loop-probe.js', {
    PROBE_TARGETS: `health=http://127.0.0.1:${P.api}/health,ready=http://127.0.0.1:${P.api}/ready`,
    PROBE_INTERVAL_SECONDS: '2',
    PROBE_TIMEOUT_SECONDS: '10',
    OBS_METRICS_PORT: String(P.probeMetrics),
  });
  await waitFor(
    'probe metrics listener',
    async () => (await scrapeDirect(P.probeMetrics)).status === 200,
    120_000,
    2000,
  );
  console.log('api, worker and probe are serving /metrics');
  check(
    'the metrics listener refuses a scrape without the token',
    (await scrapeDirect(P.apiMetrics, false)).status === 401,
  );

  // ---- Alertmanager + Prometheus, from the deployment files -------------------------------------------------------------------
  docker('network', 'create', NAMES.net);
  const cfgDir = join(work, 'prom');
  const amDir = join(work, 'am');
  mkdirSync(cfgDir);
  mkdirSync(amDir);
  writeFileSync(join(cfgDir, 'metrics-token'), token);
  writeFileSync(
    join(cfgDir, 'event-loop.rules.yml'),
    readFileSync(join(root, 'deploy/observability/event-loop.rules.yml'), 'utf8'),
  );
  writeFileSync(
    join(cfgDir, 'prometheus.yml'),
    swap(readFileSync(join(root, 'deploy/observability/prometheus.yml'), 'utf8'), [
      ['scrape_interval: 15s', 'scrape_interval: 5s'],
      ['evaluation_interval: 15s', 'evaluation_interval: 5s'],
      ['/run/secrets/obs_metrics_token', '/etc/prometheus/metrics-token'],
      ["'api:9464'", `'host.docker.internal:${P.apiMetrics}'`],
      ["'worker:9464'", `'host.docker.internal:${P.workerMetrics}'`],
      ["'probe:9464'", `'host.docker.internal:${P.probeMetrics}'`],
    ]),
  );
  writeFileSync(
    join(amDir, 'alertmanager.yml'),
    swap(readFileSync(join(root, 'deploy/observability/alertmanager.yml'), 'utf8'), [
      [
        'url_file: /run/secrets/alert_webhook_url',
        `url: http://host.docker.internal:${P.receiver}/alerts`,
      ],
      ['group_wait: 30s', 'group_wait: 2s'],
      ['group_interval: 5m', 'group_interval: 5s'],
    ]),
  );
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    NAMES.am,
    '--network',
    NAMES.net,
    '--network-alias',
    'alertmanager',
    '-v',
    `${amDir}:/etc/alertmanager:ro`,
    'prom/alertmanager:v0.27.0',
    '--config.file=/etc/alertmanager/alertmanager.yml',
    '--storage.path=/alertmanager',
  );
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    NAMES.prom,
    '--network',
    NAMES.net,
    '-p',
    `${P.prom}:9090`,
    '-v',
    `${cfgDir}:/etc/prometheus:ro`,
    'prom/prometheus:v2.55.0',
    '--config.file=/etc/prometheus/prometheus.yml',
  );
  await waitFor(
    'prometheus ready',
    async () => (await fetch(`http://127.0.0.1:${P.prom}/-/ready`)).ok,
    60_000,
  );

  const targets = await waitFor(
    'all three targets up',
    async () => {
      const t = (await prom('/api/v1/targets')).activeTargets;
      return t.length === 3 && t.every((x) => x.health === 'up') ? t : null;
    },
    120_000,
    2000,
  );
  check(
    'Prometheus has all three targets up',
    true,
    targets.map((t) => `${t.labels.job}=${t.health}`).join(' '),
  );
  check(
    'target labels are the job names the rules expect',
    targets
      .map((t) => t.labels.job)
      .sort()
      .join() === 'crm-api,crm-probe,crm-worker',
  );
  const ams = (await prom('/api/v1/alertmanagers')).activeAlertmanagers;
  check('Prometheus found Alertmanager', ams.length === 1, ams.map((a) => a.url).join());

  // ---- what it sees -------------------------------------------------------------------------------------------------------------
  const mustHave = [
    'crm_event_loop_delay_p99_seconds',
    'crm_event_loop_delay_max_seconds',
    'crm_event_loop_utilization_ratio',
    'crm_process_heap_used_bytes',
    'crm_process_rss_bytes',
    'crm_runtime_last_report_timestamp_seconds',
  ];
  await waitFor(
    'first runtime windows',
    async () => (await instant('crm_event_loop_delay_p99_seconds')).length === 2,
    120_000,
    3000,
  );
  for (const m of mustHave) {
    const byService = (await instant(m))
      .map((x) => `${x.metric.service}`)
      .sort()
      .join();
    check(`${m} present for the api and the worker`, byService === 'api,worker', byService);
  }
  const one = (await instant('crm_event_loop_delay_p99_seconds'))[0].metric;
  check(
    'series carry service, instance and the scrape job',
    Boolean(one.service && one.instance && one.job),
    one,
  );
  const loop = await instant('crm_event_loop_delay_p99_seconds');
  check(
    'a healthy idle loop reads in a sane range (under 0.5 s)',
    loop.every((x) => Number(x.value[1]) < 0.5),
    loop.map((x) => `${x.metric.service}=${x.value[1]}`).join(' '),
  );
  const fresh = await instant('time() - crm_runtime_last_report_timestamp_seconds');
  check(
    'the heartbeat timestamp is fresh (under 30 s old)',
    fresh.length === 2 && fresh.every((x) => Number(x.value[1]) < 30),
    fresh.map((x) => `${x.metric.service}=${Number(x.value[1]).toFixed(1)}s`).join(' '),
  );

  // ---- the probe (caller-side latency, from another process) ----------------------------------------------------------------------
  await waitFor(
    'probe series',
    async () => (await instant('crm_probe_up')).length === 2,
    60_000,
    2000,
  );
  check(
    'the probe reports both targets up',
    (await instant('crm_probe_up')).every((x) => x.value[1] === '1'),
    (await instant('crm_probe_up')).map((x) => `${x.metric.target}=${x.value[1]}`).join(' '),
  );
  // rate() needs two samples inside the window, so the quantile is empty for the first scrapes after the probe starts.
  const healthyProbe = await waitFor(
    'a probe latency quantile',
    async () => {
      const v = await num(
        'histogram_quantile(0.95, sum by (le) (rate(crm_probe_http_duration_seconds_bucket{target="health"}[1m])))',
      );
      return Number.isFinite(v) ? v : null;
    },
    60_000,
    3000,
  ).catch(() => Number.NaN);
  check(
    'a healthy /health reads fast from the probe (p95 under 0.25 s)',
    healthyProbe < 0.25,
    `${fmt(healthyProbe)} s`,
  );

  // ---- a real job through the real worker -----------------------------------------------------------------------------------------
  const queue = new Queue('tpl-sweep', {
    connection: { host: '127.0.0.1', port: P.redis, maxRetriesPerRequest: null },
  });
  await queue.add('sweep', { slot: 1 }, { jobId: 'el-scrape-demo' });
  await queue.close();
  const job = await waitFor(
    'the job to appear in Prometheus',
    async () => {
      const r = await instant('crm_queue_jobs_total{queue="tpl-sweep",outcome="completed"}');
      return r.length ? r : null;
    },
    120_000,
    3000,
  );
  check(
    'a job run by the real worker shows as completed in Prometheus',
    Number(job[0].value[1]) >= 1,
    `service=${job[0].metric.service}`,
  );

  // ---- the rules ------------------------------------------------------------------------------------------------------------------
  const rules = (await prom('/api/v1/rules')).groups.flatMap((g) => g.rules);
  check('Prometheus loaded all 15 alert rules', rules.length === 15, rules.length);
  check(
    'every rule evaluates without error',
    rules.every((r) => r.health === 'ok'),
    rules
      .filter((r) => r.health !== 'ok')
      .map((r) => r.name)
      .join(),
  );
  await sleep(10_000);
  const idle = (await alerts()).filter((a) => a.state === 'firing');
  check(
    'nothing is firing on a healthy idle stack',
    idle.length === 0,
    idle.map((a) => a.labels.alertname).join(),
  );

  // ---- stalls ---------------------------------------------------------------------------------------------------------------------
  if (PHASES.has('api')) await apiStallPhase();
  if (PHASES.has('worker')) await workerStallPhase();
  if (PHASES.has('long')) await longBlockPhase();

  // ---- stop the worker: the scrape must notice, and someone must be told -------------------------------------------------------------
  console.log('\n== kill the worker ==');
  worker.kill();
  const down = await waitFor(
    'worker target down',
    async () => {
      const r = await instant('up{job="crm-worker"} == 0');
      return r.length ? r : null;
    },
    120_000,
    2000,
  );
  check('Prometheus sees the killed worker as down', down.length === 1);
  const pending = await waitFor(
    'target-down alert pending',
    async () => (await alertState('RuntimeMetricsTargetDown')) ?? null,
    60_000,
    2000,
  );
  check(
    'RuntimeMetricsTargetDown goes pending first (the 2 m hold)',
    pending === 'pending',
    pending,
  );
  const fired = await waitFor(
    'target-down alert firing',
    async () => (await firing('RuntimeMetricsTargetDown')) ?? null,
    300_000,
    5000,
  );
  check(
    'RuntimeMetricsTargetDown fires for the worker',
    fired.labels.job === 'crm-worker' && fired.labels.severity === 'critical',
    fired.labels,
  );
  check('the API target stays up while the worker is down', (await num('up{job="crm-api"}')) === 1);
  check(
    'RuntimeMetricsStale does NOT fire for a dead process (its series vanish; TargetDown covers it)',
    (await alertState('RuntimeMetricsStale')) === undefined,
  );

  // ---- delivery ---------------------------------------------------------------------------------------------------------------------
  console.log('\n== delivery to the receiver ==');
  await waitFor(
    'the notification for RuntimeMetricsTargetDown',
    async () => (wasDelivered('RuntimeMetricsTargetDown', 'firing') ? true : null),
    120_000,
    3000,
  ).catch(() => null);
  check(
    'a firing notification reached the receiver (RuntimeMetricsTargetDown)',
    wasDelivered('RuntimeMetricsTargetDown', 'firing'),
  );
  const sent = delivered.find(
    (d) => d.name === 'RuntimeMetricsTargetDown' && d.status === 'firing',
  );
  check(
    'the notification carries the labels an on-call person needs',
    Boolean(sent?.labels?.job === 'crm-worker' && sent?.labels?.severity === 'critical'),
    sent?.labels,
  );
  for (const name of [
    'EventLoopBlockingWithImpact',
    'ApiCallerLatencyHigh',
    'WorkerEventLoopBlockingWithQueueImpact',
    'EventLoopLongStallCritical',
  ]) {
    const phase = {
      EventLoopBlockingWithImpact: 'api',
      ApiCallerLatencyHigh: 'api',
      WorkerEventLoopBlockingWithQueueImpact: 'worker',
      EventLoopLongStallCritical: 'long',
    }[name];
    if (PHASES.has(phase)) check(`${name} was delivered as firing`, wasDelivered(name, 'firing'));
  }
  if (PHASES.has('api')) {
    // The API stall ended many minutes ago: its alert must have resolved, and the resolution must have been delivered.
    await waitFor(
      'the resolved notification',
      async () => (wasDelivered('EventLoopBlockingWithImpact', 'resolved') ? true : null),
      480_000,
      5000,
    ).catch(() => null);
    check(
      'a RESOLVED notification reached the receiver once the stall was over',
      wasDelivered('EventLoopBlockingWithImpact', 'resolved'),
    );
  }
  observe(`delivered: ${[...new Set(delivered.map((d) => `${d.name}:${d.status}`))].join(' ')}`);
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`\nABORTED: ${err.message}`);
  for (const f of ['api', 'worker', 'probe']) {
    try {
      const t = readFileSync(join(work, `${f}.log`), 'utf8')
        .split('\n')
        .slice(-12)
        .join('\n');
      console.error(`--- last lines of the ${f} log ---\n${t}`);
    } catch {
      /* no log */
    }
  }
}
const out = join(root, 'reports/event-loop');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'scrape-demo.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, prometheus: 'prom/prometheus:v2.55.0', alertmanager: 'prom/alertmanager:v0.27.0', phases: [...PHASES], aborted: failed, delivered, results }, null, 1)}\n`,
);
const bad = results.filter((r) => !r.ok).length;
console.log(
  `\n${results.length - bad}/${results.length} checks passed${failed ? ' (aborted early)' : ''}; written reports/event-loop/scrape-demo.json`,
);
cleanup();
process.exit(failed || bad ? 1 : 0);
