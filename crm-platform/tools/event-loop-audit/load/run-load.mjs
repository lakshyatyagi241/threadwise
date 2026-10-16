#!/usr/bin/env node
// Event-loop baselines for the real application (EL-B05): idle, normal, peak, spike and a short soak.
//
//   pnpm --filter @crm/db --filter @crm/contracts --filter @crm/config --filter @crm/tax build
//   pnpm --filter @crm/api build
//   node tools/event-loop-audit/load/run-load.mjs                       # all profiles, ~20 minutes
//   node tools/event-loop-audit/load/run-load.mjs --profiles=idle,normal --seconds=60 --contacts=1000
//
// It starts throwaway Postgres + Redis containers (never your own), migrates, seeds one workspace with an owner and N contacts through
// the API, runs the BUILT api (dist/src/main.js) and worker as separate processes, and drives the API with k6 (grafana/k6 in Docker,
// `host.docker.internal`). While each profile runs it reads the processes' own /metrics every 2 s: loop delay, utilization, CPU, heap,
// RSS, blocked windows and the server-side request histogram. Output: reports/event-loop/load-baseline.json (copy what you keep into
// docs/performance/event-loop/). Only run it against this isolated stack.
//
// Honest limits, written into the output too: load generator and server share one machine; the arrival rates are chosen, not taken
// from production traffic; the soak is minutes, not the 12 h / 24 h the standard asks for; the inbox is empty, so its routes measure
// framework, auth and database round-trip, not a real conversation list.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const apiDir = join(root, 'apps/api');
const { createRequire } = await import('node:module');
const require = createRequire(join(apiDir, 'package.json'));
const { Client } = require('pg');
const { runMigrations } = require('@crm/db');
const { hash } = require('@node-rs/argon2');

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const PROFILES = arg('profiles', 'idle,normal,peak,spike,soak').split(',').filter(Boolean);
const SECONDS = Number(arg('seconds', 120));
const SOAK_MINUTES = Number(arg('soak-minutes', 10));
const IDLE_SECONDS = Number(arg('idle-seconds', 60));
const CONTACTS = Number(arg('contacts', 5000));
const COOLDOWN_SECONDS = 20;
const SETTLE_SECONDS = Number(arg('settle-seconds', 60));

const P = { pg: 55434, redis: 56381, api: 3997, apiMetrics: 9474, workerMetrics: 9475 };
const NAMES = { pg: 'el-load-pg', redis: 'el-load-redis' };
const K6_IMAGE = 'grafana/k6:0.49.0';
const work = mkdtempSync(join(tmpdir(), 'el-load-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) =>
  execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (...a) => {
  try {
    return execFileSync('git', a, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
};
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);

const procs = [];
function cleanup() {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* gone */
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

// ---- reading the processes' own /metrics ---------------------------------------------------------------------------------------
function parseProm(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(\S+)$/.exec(line);
    if (!m) continue;
    const labels = {};
    if (m[2])
      for (const l of m[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g))
        labels[l[1]] = l[2];
    out.push({ name: m[1], labels, value: Number(m[3]) });
  }
  return out;
}
const scrape = async (port) =>
  parseProm(await (await fetch(`http://127.0.0.1:${port}/metrics`)).text());
const gauge = (rows, name) => rows.find((r) => r.name === name)?.value;

/** Sum of the request histogram's buckets over every route/method/status, as {le: count}. */
function requestBuckets(rows) {
  const b = new Map();
  for (const r of rows)
    if (r.name === 'crm_http_request_duration_seconds_bucket')
      b.set(r.labels.le, (b.get(r.labels.le) ?? 0) + r.value);
  return b;
}
function quantileFromDelta(start, end, q) {
  const les = [...end.keys()]
    .filter((k) => k !== '+Inf')
    .map(Number)
    .sort((a, b) => a - b);
  const total = (end.get('+Inf') ?? 0) - (start.get('+Inf') ?? 0);
  if (total <= 0) return undefined;
  const target = total * q;
  let prevLe = 0;
  let prevCount = 0;
  for (const le of les) {
    const count = (end.get(String(le)) ?? 0) - (start.get(String(le)) ?? 0);
    if (count >= target) {
      const span = count - prevCount;
      return span <= 0 ? le : prevLe + ((le - prevLe) * (target - prevCount)) / span;
    }
    prevLe = le;
    prevCount = count;
  }
  return les[les.length - 1]; // beyond the last finite bucket: reported as that bound (a floor)
}
const blockedWindows = (rows) =>
  Object.fromEntries(
    ['warn', 'critical'].map((lvl) => [
      lvl,
      rows.find((r) => r.name === 'crm_event_loop_blocked_windows_total' && r.labels.level === lvl)
        ?.value ?? 0,
    ]),
  );

/** Collects one record per completed runtime window of a service until stopped. */
function startSampler(port) {
  const windows = [];
  let lastTs = 0;
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        const rows = await scrape(port);
        const ts = gauge(rows, 'crm_runtime_last_report_timestamp_seconds');
        if (ts && ts !== lastTs) {
          lastTs = ts;
          windows.push({
            p50: gauge(rows, 'crm_event_loop_delay_p50_seconds'),
            p95: gauge(rows, 'crm_event_loop_delay_p95_seconds'),
            p99: gauge(rows, 'crm_event_loop_delay_p99_seconds'),
            max: gauge(rows, 'crm_event_loop_delay_max_seconds'),
            elu: gauge(rows, 'crm_event_loop_utilization_ratio'),
            cpu: gauge(rows, 'crm_process_cpu_ratio'),
            heap: gauge(rows, 'crm_process_heap_used_bytes'),
            rss: gauge(rows, 'crm_process_rss_bytes'),
            gcMax: gauge(rows, 'crm_gc_pause_max_seconds'),
            at: Date.now(),
          });
        }
      } catch {
        /* a busy process may miss a sample */
      }
      await sleep(2000);
    }
  })();
  return async () => {
    stopped = true;
    await loop;
    return windows;
  };
}
/**
 * What Postgres is doing while a profile runs: every 2 s, the other sessions of the database grouped by state, wait event and the
 * first 90 characters of the statement. A slow API with a quiet event loop is waiting on something; this says on what.
 */
function startPgSampler(url) {
  const counts = new Map();
  let samples = 0;
  let stopped = false;
  const loop = (async () => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      while (!stopped) {
        try {
          const r = await c.query(
            `SELECT state, coalesce(wait_event_type, '-') AS wt, coalesce(wait_event, '-') AS we, left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS q
               FROM pg_stat_activity WHERE datname = 'crm' AND pid <> pg_backend_pid() AND backend_type = 'client backend' AND state <> 'idle'`,
          );
          samples++;
          for (const row of r.rows) {
            const key = `${row.state} | ${row.wt}/${row.we} | ${row.q}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        } catch {
          /* ignore a missed sample */
        }
        await sleep(2000);
      }
    } finally {
      await c.end().catch(() => undefined);
    }
  })();
  return async () => {
    stopped = true;
    await loop;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return {
      samples,
      note: 'non-idle sessions of the app database, summed over samples; "Lock/..." or "Client/ClientRead" waits and long-running statements show where requests wait',
      top: top.map(([k, n]) => ({
        perSample: Math.round((n / Math.max(1, samples)) * 100) / 100,
        what: k,
      })),
    };
  };
}
/**
 * How fast the machine's own plumbing is right now: 100 sequential `SELECT 1` and Redis `PING` round trips from a Node process on
 * the host to the containers. Two runs of the same workload on the same laptop differed several-fold; this is the number that says
 * whether two runs are comparable at all (Docker Desktop's port forwarding on Windows is the usual suspect).
 */
async function calibrate(pgUrl, redisPort) {
  const ioredis = require('ioredis');
  const IORedis = ioredis.default ?? ioredis;
  const pg = new Client({ connectionString: pgUrl });
  await pg.connect();
  const redis = new IORedis({ host: '127.0.0.1', port: redisPort, maxRetriesPerRequest: null });
  const time = async (fn) => {
    const xs = [];
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      await fn();
      xs.push(performance.now() - t);
    }
    xs.sort((a, b) => a - b);
    const r = (x) => Math.round(x * 100) / 100;
    return { p50: r(xs[50]), p99: r(xs[98]), max: r(xs[99]) };
  };
  try {
    return {
      postgresSelect1Ms: await time(() => pg.query('SELECT 1')),
      redisPingMs: await time(() => redis.ping()),
    };
  } finally {
    await pg.end().catch(() => undefined);
    redis.disconnect();
  }
}
const stat = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length === 0) return undefined;
  const s = [...v].sort((a, b) => a - b);
  return {
    median: s[Math.floor(s.length / 2)],
    max: s[s.length - 1],
    mean: v.reduce((a, b) => a + b, 0) / v.length,
  };
};
const ms = (x) => (x === undefined ? undefined : Math.round(x * 1000 * 100) / 100);
const mb = (x) => (x === undefined ? undefined : Math.round((x / 1048576) * 10) / 10);
/** Least-squares slope in MB per minute over the windows (heap or rss). */
function slopeMbPerMin(windows, key) {
  const pts = windows.filter((w) => Number.isFinite(w[key]));
  // Under about two minutes the slope is the garbage collector's saw-tooth, not a trend: report nothing.
  if (pts.length < 24) return undefined;
  const t0 = pts[0].at;
  const xs = pts.map((p) => (p.at - t0) / 60000);
  const ys = pts.map((p) => p[key] / 1048576);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den === 0
    ? undefined
    : Math.round((xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den) * 100) / 100;
}
function summariseWindows(windows) {
  const f = (k, scale) => {
    const s = stat(windows.map((w) => w[k]));
    return s && { median: scale(s.median), mean: scale(s.mean), max: scale(s.max) };
  };
  return {
    windows: windows.length,
    loopDelayMs: { p50: f('p50', ms), p95: f('p95', ms), p99: f('p99', ms), max: f('max', ms) },
    eventLoopUtilization: f('elu', (x) => Math.round(x * 1000) / 1000),
    cpuCores: f('cpu', (x) => Math.round(x * 1000) / 1000),
    heapUsedMb: f('heap', mb),
    rssMb: f('rss', mb),
    gcPauseMaxMs: f('gcMax', ms),
    heapSlopeMbPerMin: slopeMbPerMin(windows, 'heap'),
    rssSlopeMbPerMin: slopeMbPerMin(windows, 'rss'),
  };
}

// ---- k6 --------------------------------------------------------------------------------------------------------------------------
function runK6(profile, env) {
  const outDir = join(work, 'k6');
  mkdirSync(outDir, { recursive: true });
  const args = [
    'run',
    '--rm',
    '-v',
    `${join(here)}:/scripts:ro`,
    '-v',
    `${outDir}:/out`,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    K6_IMAGE,
    'run',
    '--summary-export',
    `/out/${profile}.json`,
    '--summary-trend-stats',
    'avg,min,med,max,p(90),p(95),p(99)',
    '/scripts/workload.k6.js',
  ];
  return new Promise((res) => {
    const logFile = join(work, `k6-${profile}.log`);
    const fd = openSync(logFile, 'w');
    const child = spawn('docker', args, { stdio: ['ignore', fd, fd] });
    child.on('exit', (code) => {
      closeSync(fd);
      let summary;
      try {
        summary = JSON.parse(readFileSync(join(outDir, `${profile}.json`), 'utf8'));
      } catch {
        /* k6 failed before writing */
      }
      let tail = '';
      try {
        tail = readFileSync(logFile, 'utf8').split('\n').slice(-12).join('\n');
      } catch {
        /* none */
      }
      res({ code, summary, tail });
    });
  });
}
function k6Report(summary) {
  if (!summary) return undefined;
  const m = summary.metrics;
  const trend = (t) =>
    t && {
      avgMs: Math.round(t.avg * 100) / 100,
      p50Ms: Math.round(t.med * 100) / 100,
      p90Ms: Math.round(t['p(90)'] * 100) / 100,
      p95Ms: Math.round(t['p(95)'] * 100) / 100,
      p99Ms: Math.round(t['p(99)'] * 100) / 100,
      maxMs: Math.round(t.max * 100) / 100,
    };
  const routes = {};
  for (const [k, v] of Object.entries(m)) {
    const r = /^http_req_duration\{name:(\w+)\}$/.exec(k);
    if (r && v.avg !== undefined) routes[r[1]] = trend(v);
  }
  return {
    requests: m.http_reqs?.count,
    requestsPerSecond: Math.round((m.http_reqs?.rate ?? 0) * 10) / 10,
    failedRate: m.http_req_failed?.value ?? m.http_req_failed?.rate,
    droppedIterations: m.dropped_iterations?.count ?? 0,
    checkPassRate: m.checks?.value ?? m.checks?.rate,
    maxVUs: m.vus_max?.value,
    clientLatency: trend(m.http_req_duration),
    clientLatencyByRoute: routes,
  };
}

// ---- main ------------------------------------------------------------------------------------------------------------------------
const results = { profiles: {} };
let aborted;
try {
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

  // One workspace with an owner (the same rows deploy/hostinger/seed.js writes). The password is random and never printed.
  const password = `Ld!${randomBytes(12).toString('hex')}`;
  const slug = 'loadtest';
  const email = 'owner@loadtest.example.test';
  const org = await owner.query(
    `INSERT INTO organizations (slug, name, plan, tier) VALUES ($1, 'Load test', 'growth', 'standard') RETURNING id`,
    [slug],
  );
  const orgId = org.rows[0].id;
  await owner.query('SELECT provision_workspace_presets($1)', [orgId]);
  const role = await owner.query(
    `SELECT id FROM roles WHERE org_id = $1 AND system_key = 'admin'`,
    [orgId],
  );
  const user = await owner.query(
    `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, $2, 'Load owner', $3) RETURNING id`,
    [orgId, email, await hash(password)],
  );
  await owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1, $2, $3)`, [
    orgId,
    user.rows[0].id,
    role.rows[0].id,
  ]);
  await owner.end();
  log('infrastructure up, migrated, workspace seeded');

  const token = randomBytes(8).toString('hex');
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    PORT: String(P.api),
    APP_URL: `http://localhost:${P.api}`,
    WEB_APP_URL: 'http://localhost:3001',
    APP_NAME: 'Load baseline',
    TRUST_PROXY: 'loopback',
    DATABASE_URL: `postgres://crm_app_user:test@127.0.0.1:${P.pg}/crm`,
    MIGRATION_DATABASE_URL: ownerUrl,
    REDIS_URL: `redis://127.0.0.1:${P.redis}`,
    JWT_ACCESS_SECRET: `access-${token}-secret-for-load-0123456789`,
    JWT_REFRESH_SECRET: `refresh-${token}-secret-for-load-0123456789`,
    CLERK_SECRET_KEY: 'sk_test_unused',
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    OBS_METRICS_HOST: '127.0.0.1',
    OBS_RUNTIME_INTERVAL_SECONDS: '5',
  };
  const start = (name, entry, extra) => {
    const fd = openSync(join(work, `${name}.log`), 'w');
    const child = spawn(process.execPath, [entry], {
      cwd: apiDir,
      env: { ...baseEnv, ...extra },
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    procs.push(child);
    child.on('exit', (code) => log(`${name} exited (${code})`));
    return child;
  };
  start('api', 'dist/src/main.js', { OBS_METRICS_PORT: String(P.apiMetrics) });
  start('worker', 'dist/src/worker.js', {
    WORKER_MODE: 'true',
    OBS_METRICS_PORT: String(P.workerMetrics),
  });
  await waitFor(
    'the API /ready',
    async () => (await fetch(`http://127.0.0.1:${P.api}/ready`)).status === 200,
    600_000,
    3000,
  );
  await waitFor(
    'the worker metrics',
    async () => (await scrape(P.workerMetrics)).length > 0,
    120_000,
    2000,
  );

  const api = `http://127.0.0.1:${P.api}`;
  const login = await fetch(`${api}/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orgSlug: slug, email, password }),
  });
  const lb = await login.json();
  const bearer = lb.tokens?.accessToken;
  if (!bearer)
    throw new Error(
      `login did not authenticate: status ${login.status}, ${lb.status ?? 'no status field'}`,
    );
  const authHeaders = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' };

  // Contacts through the real create route (this also exercises it), 8 at a time.
  log(`seeding ${CONTACTS} contacts through POST /v2/contacts`);
  let next = 0;
  let seedFailures = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < CONTACTS) {
        const i = next++;
        const r = await fetch(`${api}/v2/contacts`, {
          method: 'POST',
          headers: { ...authHeaders, 'idempotency-key': randomUUID() },
          body: JSON.stringify({ name: `Load Contact ${i}`, email: `load${i}@example.test` }),
        });
        if (!r.ok) {
          seedFailures++;
          if (seedFailures === 1)
            log(`first seed failure: status ${r.status} ${(await r.text()).slice(0, 200)}`);
          if (seedFailures > 50) throw new Error('too many contact seed failures');
        }
      }
    }),
  );
  const total = (
    await (
      await fetch(`${api}/v2/contacts?limit=1&includeTotal=true`, { headers: authHeaders })
    ).json()
  ).meta?.total;
  log(`dataset: ${total} contacts (${seedFailures} seed failures)`);
  results.dataset = {
    workspaces: 1,
    contacts: total,
    conversations: 0,
    note: 'inbox is empty: inbox routes measure framework, auth and database round-trip only',
  };

  const k6Env = {
    BASE_URL: `http://host.docker.internal:${P.api}`,
    ORG_SLUG: slug,
    EMAIL: email,
    PASSWORD: password,
    SECONDS: String(SECONDS),
    SOAK_MINUTES: String(SOAK_MINUTES),
  };
  // Boot and seeding leave a big, young heap and background work behind; the first readings would be start-up, not idle.
  log(`settling ${SETTLE_SECONDS} s`);
  await sleep(SETTLE_SECONDS * 1000);

  results.calibrationBefore = await calibrate(ownerUrl, P.redis);
  log(`round trips from the host: ${JSON.stringify(results.calibrationBefore)}`);
  for (const profile of PROFILES) {
    log(`profile ${profile} starting`);
    const before = await scrape(P.apiMetrics);
    const stopApi = startSampler(P.apiMetrics);
    const stopWorker = startSampler(P.workerMetrics);
    const stopPg = startPgSampler(ownerUrl);
    const t0 = Date.now();
    let k6;
    if (profile === 'idle') {
      await sleep(IDLE_SECONDS * 1000);
    } else {
      k6 = await runK6(profile, { ...k6Env, PROFILE: profile });
    }
    const seconds = (Date.now() - t0) / 1000;
    await sleep(6000); // one more window, so the last seconds of load are reported
    const apiWindows = await stopApi();
    const workerWindows = await stopWorker();
    const postgres = await stopPg();
    const after = await scrape(P.apiMetrics);
    const b0 = blockedWindows(before);
    const b1 = blockedWindows(after);
    const q = (p) => ms(quantileFromDelta(requestBuckets(before), requestBuckets(after), p));
    results.profiles[profile] = {
      durationSeconds: Math.round(seconds),
      api: summariseWindows(apiWindows),
      worker: summariseWindows(workerWindows),
      blockedWindows: { warn: b1.warn - b0.warn, critical: b1.critical - b0.critical },
      postgres,
      serverRequestMs: {
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        note: 'timed from when the handler runs: excludes time queued behind a blocked loop',
      },
      client: k6 ? k6Report(k6.summary) : undefined,
      k6ExitCode: k6?.code,
      k6Failed: k6 && !k6.summary ? k6.tail : undefined,
    };
    results.profiles[profile].calibrationAfter = await calibrate(ownerUrl, P.redis);
    log(
      `profile ${profile} done: loop delay p99 median ${results.profiles[profile].api.loopDelayMs.p99?.median} ms, max ${results.profiles[profile].api.loopDelayMs.max?.max} ms`,
    );
    await sleep(COOLDOWN_SECONDS * 1000);
  }
} catch (err) {
  aborted = err.message;
  console.error(`ABORTED: ${err.message}`);
  for (const f of ['api', 'worker']) {
    try {
      console.error(
        `--- last lines of the ${f} log ---\n${readFileSync(join(work, `${f}.log`), 'utf8')
          .split('\n')
          .slice(-12)
          .join('\n')}`,
      );
    } catch {
      /* no log */
    }
  }
}

const out = join(root, 'reports/event-loop');
mkdirSync(out, { recursive: true });
const c = cpus();
writeFileSync(
  join(out, 'load-baseline.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      aborted,
      environment: {
        commit: git('rev-parse', 'HEAD'),
        branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
        workingTreeClean: git('status', '--porcelain') === '',
        node: process.version,
        os: `${platform()} ${release()}`,
        cpu: `${c[0]?.model}, ${c.length} logical cores, ${(totalmem() / 1073741824).toFixed(1)} GB`,
        infrastructureProfile:
          'developer laptop; API, worker, Postgres, Redis and the k6 container all on one machine',
        loadGenerator: K6_IMAGE,
        workload: 'tools/event-loop-audit/load/workload.k6.js',
        mix: 'contact list 52%, search 12%, get 15%, inbox list 8%, inbox counts 4%, create 4%, update 2%, /health 3% (control, no tenant work)',
        rates:
          'normal 5 req/s, peak 20 req/s, spike 5 to 60 req/s (3x peak), soak 5 req/s; open model (arrival rate)',
        profilesRequested: PROFILES,
        seconds: { normalAndPeak: SECONDS, idle: IDLE_SECONDS, soakMinutes: SOAK_MINUTES },
      },
      comparabilityWarning:
        'Valid only against runs from this same machine and Node version. The rates are chosen, not taken from production traffic. The soak is minutes, not hours.',
      ...results,
    },
    null,
    1,
  )}\n`,
);
log('written reports/event-loop/load-baseline.json');
cleanup();
process.exit(aborted ? 1 : 0);
