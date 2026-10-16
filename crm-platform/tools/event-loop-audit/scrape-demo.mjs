#!/usr/bin/env node
// A real Prometheus scraping a real API process and a real worker process (EL-B02).
//
//   pnpm --filter @crm/db --filter @crm/contracts --filter @crm/config --filter @crm/tax build
//   pnpm --filter @crm/api build
//   node tools/event-loop-audit/scrape-demo.mjs
//
// What it does: starts throwaway Postgres + Redis containers, migrates, runs the BUILT api (dist/src/main.js) and worker
// (dist/src/worker.js) as separate processes with the metrics listener on, runs prom/prometheus with deploy/observability/prometheus.yml
// and event-loop.rules.yml, then asks Prometheus's own HTTP API what it sees. Finally it kills the worker and waits for the
// RuntimeMetricsTargetDown alert. Needs Docker. Takes several minutes (the API boot is slow on a OneDrive disk). Exit 1 on a failed check.
//
// Host ports: 55433 Postgres, 56380 Redis, 3998 API, 9464 API metrics, 9465 worker metrics, 9099 Prometheus.
// The metrics listeners bind 0.0.0.0 (so the container can reach them through host.docker.internal) behind a random bearer token; on
// Windows the firewall may ask whether node.exe may listen.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

const STALL = process.argv.includes('--stall');
const P = {
  pg: 55433,
  redis: 56380,
  api: 3998,
  apiMetrics: 9464,
  workerMetrics: 9465,
  prom: 9099,
  inspector: 9229,
};
const NAMES = { pg: 'el-scrape-pg', redis: 'el-scrape-redis', prom: 'el-scrape-prom' };
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
function cleanup() {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* already gone */
    }
  }
  for (const n of Object.values(NAMES)) {
    try {
      docker('rm', '-f', n);
    } catch {
      /* not running */
    }
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

/** Runs `expression` inside the live API process through its inspector (Chrome DevTools Protocol over a WebSocket). */
async function inspectorEval(expression) {
  const targets = await (await fetch(`http://127.0.0.1:${P.inspector}/json`)).json();
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

// The stall: the API's loop is kept busy 600 ms out of every 700 ms, the way a CPU-bound handler would, for a while. Requests to
// /health run throughout, so the stall costs real requests real latency (the "user impact" half of the critical alert).
async function stallPhase() {
  console.log('stall phase: injecting a 600 ms block every 700 ms into the API process');
  let stopLoad = false;
  const clientMs = [];
  const load = async () => {
    while (!stopLoad) {
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
  const loaders = [load(), load()];
  await inspectorEval(
    'globalThis.__elStall = setInterval(() => { const e = Date.now() + 600; while (Date.now() < e) {} }, 700); 1',
  );
  try {
    const seen = await waitFor(
      'stalled windows in Prometheus',
      async () => {
        const r = await instant(
          'max_over_time(crm_event_loop_delay_max_seconds{service="api"}[1m])',
        );
        return r.length && Number(r[0].value[1]) > 0.4 ? r : null;
      },
      180_000,
      5000,
    );
    check(
      'Prometheus sees the injected stall as a large max delay',
      true,
      `${Number(seen[0].value[1]).toFixed(2)} s`,
    );

    // Under a sustained stall the metric endpoint shares the blocked loop; record whether the scrape kept working.
    const apiUp = await instant('avg_over_time(up{job="crm-api"}[2m])');
    console.log(
      `OBSERVE  api target availability over the stall so far: ${apiUp.length ? Number(apiUp[0].value[1]).toFixed(2) : 'n/a'}`,
    );

    // The critical alert needs avg(p95) over 5 m above 50 ms AND request p95 above 500 ms, held for 5 m: about 6 to 8 minutes.
    const alert = await waitFor(
      'EventLoopBlockingWithImpact firing',
      async () => {
        const a = (await prom('/api/v1/alerts')).alerts.find(
          (x) => x.labels.alertname === 'EventLoopBlockingWithImpact' && x.state === 'firing',
        );
        return a ?? null;
      },
      900_000,
      10_000,
    ).catch(() => null);
    const snap = async (q) => {
      const r = await instant(q);
      return r.length ? Number(r[0].value[1]).toFixed(3) : 'n/a';
    };
    console.log(
      `OBSERVE  p95=${await snap('crm_event_loop_delay_p95_seconds{service="api"}')}s p99=${await snap('crm_event_loop_delay_p99_seconds{service="api"}')}s max=${await snap('crm_event_loop_delay_max_seconds{service="api"}')}s elu=${await snap('crm_event_loop_utilization_ratio{service="api"}')} request p95=${await snap('histogram_quantile(0.95, sum by (le) (rate(crm_http_request_duration_seconds_bucket{service="api"}[5m])))')}s`,
    );
    // What a caller experienced versus what the server-side request histogram recorded for the same requests.
    const sorted = [...clientMs].sort((a, b) => a - b);
    const clientP95 = (sorted[Math.floor(sorted.length * 0.95)] ?? 0) / 1000;
    const serverP95 = Number(
      await snap(
        'histogram_quantile(0.95, sum by (le) (rate(crm_http_request_duration_seconds_bucket{service="api",route="/health"}[5m])))',
      ),
    );
    console.log(
      `OBSERVE  /health p95: callers saw ${clientP95.toFixed(3)} s (${sorted.length} requests), the server histogram recorded ${serverP95.toFixed(3)} s`,
    );
    check(
      'callers waited far longer than the request histogram shows (the histogram cannot see time queued behind the loop)',
      clientP95 > 0.25 && serverP95 < 0.1,
      `client ${clientP95.toFixed(3)} s vs server ${serverP95.toFixed(3)} s`,
    );
    const states = (await prom('/api/v1/alerts')).alerts.map(
      (a) => `${a.labels.alertname}:${a.state}`,
    );
    console.log(`OBSERVE  alerts during the stall: ${states.join(' ') || 'none'}`);
    check(
      'EventLoopBlockingWithImpact fires from a real, sustained stall in a real process',
      Boolean(alert),
      alert ? alert.labels : states.join(' '),
    );
  } finally {
    stopLoad = true;
    await Promise.all(loaders);
    await inspectorEval('clearInterval(globalThis.__elStall); 1').catch(() => undefined);
  }
  const back = await waitFor(
    'the loop to recover',
    async () => {
      const r = await instant('crm_event_loop_delay_max_seconds{service="api"}');
      return r.length && Number(r[0].value[1]) < 0.3 ? r : null;
    },
    120_000,
    3000,
  );
  check(
    'the loop recovers once the stall stops',
    true,
    `max delay ${Number(back[0].value[1]).toFixed(3)} s`,
  );
}

async function main() {
  // ---- infrastructure ---------------------------------------------------------------------------------------------
  for (const n of Object.values(NAMES)) {
    try {
      docker('rm', '-f', n);
    } catch {
      /* none */
    }
  }
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

  // ---- the two real processes -------------------------------------------------------------------------------------------
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
  const logs = {};
  const start = (name, entry, extra) => {
    const log = join(work, `${name}.log`);
    logs[name] = log;
    const fd = openSync(log, 'w');
    // With --stall the API also opens its inspector (loopback only): that is how a real stall is injected, with no change to the app.
    const execArgv = STALL && name === 'api' ? [`--inspect=127.0.0.1:${P.inspector}`] : [];
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
  start('api', 'dist/src/main.js', { OBS_METRICS_PORT: String(P.apiMetrics) });
  const worker = start('worker', 'dist/src/worker.js', {
    WORKER_MODE: 'true',
    OBS_METRICS_PORT: String(P.workerMetrics),
  });
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
  console.log('api and worker are serving /metrics');
  check(
    'the metrics listener refuses a scrape without the token',
    (await scrapeDirect(P.apiMetrics, false)).status === 401,
  );

  // ---- Prometheus ---------------------------------------------------------------------------------------------------------
  const cfgDir = join(work, 'prom');
  mkdirSync(cfgDir);
  writeFileSync(join(cfgDir, 'metrics-token'), token);
  copyFileSync(
    join(root, 'deploy/observability/event-loop.rules.yml'),
    join(cfgDir, 'event-loop.rules.yml'),
  );
  copyFileSync(join(root, 'deploy/observability/prometheus.yml'), join(cfgDir, 'prometheus.yml'));
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    NAMES.prom,
    '-p',
    `${P.prom}:9090`,
    '-v',
    `${cfgDir}:/etc/prometheus:ro`,
    'prom/prometheus:v2.55.0',
    '--config.file=/etc/prometheus/prometheus.yml',
    '--web.enable-lifecycle',
  );
  await waitFor(
    'prometheus ready',
    async () => (await fetch(`http://127.0.0.1:${P.prom}/-/ready`)).ok,
    60_000,
  );

  const targets = await waitFor(
    'both targets up',
    async () => {
      const t = (await prom('/api/v1/targets')).activeTargets;
      return t.length === 2 && t.every((x) => x.health === 'up') ? t : null;
    },
    120_000,
    2000,
  );
  check(
    'Prometheus has both targets up',
    true,
    targets.map((t) => `${t.labels.job}=${t.health}`).join(' '),
  );
  check(
    'target labels are the job names the rules expect',
    targets
      .map((t) => t.labels.job)
      .sort()
      .join() === 'crm-api,crm-worker',
  );

  // ---- what it sees ---------------------------------------------------------------------------------------------------------
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
    const r = await instant(m);
    const byService = r
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

  // ---- a real job through the real worker, seen by Prometheus -----------------------------------------------------------
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

  // ---- the rules ----------------------------------------------------------------------------------------------------------
  const groups = (await prom('/api/v1/rules')).groups;
  const rules = groups.flatMap((g) => g.rules);
  check('Prometheus loaded all 11 alert rules', rules.length === 11, rules.length);
  check(
    'every rule evaluates without error',
    rules.every((r) => r.health === 'ok'),
    rules
      .filter((r) => r.health !== 'ok')
      .map((r) => r.name)
      .join(),
  );
  const firing = (await prom('/api/v1/alerts')).alerts.filter((a) => a.state === 'firing');
  check(
    'nothing is firing on a healthy idle stack',
    firing.length === 0,
    firing.map((a) => a.labels.alertname).join(),
  );

  if (STALL) await stallPhase();

  // ---- stop the worker: the scrape must notice -----------------------------------------------------------------------------
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
  const sawPending = await waitFor(
    'target-down alert pending',
    async () => {
      const a = (await prom('/api/v1/alerts')).alerts.find(
        (x) => x.labels.alertname === 'RuntimeMetricsTargetDown',
      );
      return a ?? null;
    },
    60_000,
    2000,
  );
  check(
    'RuntimeMetricsTargetDown goes pending first (the 2 m hold)',
    sawPending.state === 'pending',
    sawPending.state,
  );
  const fired = await waitFor(
    'target-down alert firing',
    async () => {
      const a = (await prom('/api/v1/alerts')).alerts.find(
        (x) => x.labels.alertname === 'RuntimeMetricsTargetDown' && x.state === 'firing',
      );
      return a ?? null;
    },
    300_000,
    5000,
  );
  check(
    'RuntimeMetricsTargetDown fires for the worker',
    fired.labels.job === 'crm-worker' && fired.labels.severity === 'critical',
    fired.labels,
  );
  const apiStillUp = await instant('up{job="crm-api"}');
  check(
    'the API target stays up while the worker is down',
    apiStillUp.length === 1 && apiStillUp[0].value[1] === '1',
  );
  const stale = (await prom('/api/v1/alerts')).alerts.filter(
    (a) => a.labels.alertname === 'RuntimeMetricsStale',
  );
  check(
    'RuntimeMetricsStale does NOT fire for a dead process (its series just vanish; TargetDown covers it)',
    stale.length === 0,
    stale.length,
  );

  return logs;
}

let logs = {};
let failed = false;
try {
  logs = await main();
} catch (err) {
  failed = true;
  console.error(`\nABORTED: ${err.message}`);
  for (const f of ['api', 'worker']) {
    try {
      const t = readFileSync(join(work, `${f}.log`), 'utf8')
        .split('\n')
        .slice(-15)
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
  `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, prometheus: 'prom/prometheus:v2.55.0', aborted: failed, results }, null, 1)}\n`,
);
const bad = results.filter((r) => !r.ok).length;
console.log(
  `\n${results.length - bad}/${results.length} checks passed${failed ? ' (aborted early)' : ''}; written reports/event-loop/scrape-demo.json`,
);
cleanup();
void logs;
process.exit(failed || bad ? 1 : 0);
