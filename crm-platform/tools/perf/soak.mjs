#!/usr/bin/env node
// Memory soak (Sheet3 #58). Boots the built API and worker with --expose-gc, drives a steady mixed workload for --minutes,
// samples every --interval s, forces a GC every --gc-every samples, fits a linear slope (MB/h, 95% CI) to the post-warm-up
// samples and exits 1 on sustained growth. 24 h run: node tools/perf/soak.mjs --minutes 1440
// Needs: pnpm --filter @crm/api build, a migrated + seeded throwaway Postgres database (SOAK_DATABASE), Redis (db SOAK_REDIS_DB, default 13).
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg, cpus } from 'node:os';
import { summarize, analyzeSnapshot } from './memory-profile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const api = join(root, 'apps/api');
const req = createRequire(join(api, 'package.json'));

const NUM = {
  minutes: 'minutes',
  warmup: 'warmup',
  interval: 'interval',
  'gc-every': 'gcEvery',
  rate: 'rate',
  port: 'port',
  'threshold-mb-h': 'thresholdMbH',
  sockets: 'sockets',
  calls: 'calls',
};
const STR = { out: 'out', email: 'email', password: 'password' };

export function parseArgs(argv) {
  const o = {
    minutes: 20,
    warmup: 3,
    interval: 10,
    gcEvery: 6,
    rate: 15,
    port: 3999,
    thresholdMbH: 10,
    out: join(root, 'perf/results/soak'),
    email: 'nachiket.challawar@geta.ai',
    password: 'Passw0rd!',
    worker: true,
    snapshots: false,
    profile: false,
    calls: 200,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'no-worker') o.worker = false;
    else if (k === 'profile')
      o.profile = true; // writes memory-profile.json: boot sample, p50/p95/p99, heap spaces, per-endpoint delta
    else if (k === 'snapshots')
      o.snapshots = true; // opt in: writing a snapshot of a big heap pauses the process for seconds
    else if (k in NUM) o[NUM[k]] = Number(argv[++i]);
    else if (k in STR) o[STR[k]] = argv[++i];
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return o;
}

/** OLS slope of y on t (hours) with a 95% confidence interval. shortcut: t value 2.1 below 60 points, 1.96 above. */
export function fitSlope(t, y) {
  const n = t.length;
  if (n < 4) return { n, slope: NaN, lo: NaN, hi: NaN };
  const mx = t.reduce((a, b) => a + b, 0) / n,
    my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (t[i] - mx) ** 2;
    sxy += (t[i] - mx) * (y[i] - my);
  }
  const slope = sxy / sxx,
    b0 = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - (b0 + slope * t[i])) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx),
    tv = n > 60 ? 1.96 : 2.1;
  return { n, slope, lo: slope - tv * se, hi: slope + tv * se };
}

/** Sustained = slope above the threshold AND the whole confidence interval above zero. */
export const isSustained = (f, thr) => Number.isFinite(f.slope) && f.slope > thr && f.lo > 0;

/** Self size and count per constructor from a V8 heap snapshot file. */
export function snapshotByName(path) {
  const s = JSON.parse(readFileSync(path, 'utf8'));
  const nf = s.snapshot.meta.node_fields,
    w = nf.length,
    ti = nf.indexOf('type'),
    ni = nf.indexOf('name'),
    si = nf.indexOf('self_size');
  const types = s.snapshot.meta.node_types[0],
    m = new Map();
  for (let i = 0; i < s.nodes.length; i += w) {
    const ty = types[s.nodes[i + ti]];
    if (ty !== 'object' && ty !== 'closure' && ty !== 'string' && ty !== 'array') continue;
    const key = `${ty === 'object' ? '' : ty + ':'}${s.strings[s.nodes[i + ni]]}`.slice(0, 80);
    const e = m.get(key) || { n: 0, bytes: 0 };
    e.n++;
    e.bytes += s.nodes[i + si];
    m.set(key, e);
  }
  return m;
}
export function diffSnapshots(a, b, top = 15) {
  const rows = [],
    lastSpaces = {};
  for (const [k, e] of b) {
    const p = a.get(k) || { n: 0, bytes: 0 };
    rows.push({ name: k, dCount: e.n - p.n, dBytes: e.bytes - p.bytes });
  }
  return rows.sort((x, y) => y.dBytes - x.dBytes).slice(0, top);
}

class Proc {
  constructor(name, entry, env) {
    this.name = name;
    this.waiting = new Map();
    this.seq = 0;
    this.exited = false;
    this.child = fork(entry, [], {
      cwd: api,
      execArgv: ['--expose-gc', '-r', join(here, 'soak-probe.cjs')],
      env,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    this.child.on('message', (m) => {
      if (m?.soak === 'sample') {
        this.waiting.get(m.id)?.(m);
        this.waiting.delete(m.id);
      }
    });
    this.child.on('exit', () => {
      this.exited = true;
    });
  }
  ask(extra = {}, ms = 120000) {
    if (this.exited) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise((res) => {
      const t = setTimeout(() => {
        this.waiting.delete(id);
        res(null);
      }, ms);
      this.waiting.set(id, (m) => {
        clearTimeout(t);
        res(m);
      });
      this.child.send({ soak: true, id, ...extra });
    });
  }
  stop() {
    this.child.kill('SIGTERM');
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  mkdirSync(o.out, { recursive: true });
  const env = { ...process.env };
  for (const l of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
  env.NODE_OPTIONS = '';
  env.PORT = String(o.port);
  env.LOG_LEVEL = 'error';
  const db = env.SOAK_DATABASE || 'crm_soak_mem',
    dbIdx = env.SOAK_REDIS_DB || '13';
  env.DATABASE_URL =
    env.DATABASE_REPLICA_URL = `postgres://crm_app_user:crm_app_dev@localhost:5432/${db}`;
  env.REDIS_URL = `redis://localhost:56379/${dbIdx}`;
  const base = `http://localhost:${o.port}`;
  const procs = [new Proc('api', join(api, 'dist/src/main.js'), { ...env, WORKER_MODE: 'false' })];
  if (o.worker)
    procs.push(
      new Proc('worker', join(api, 'dist/src/worker.js'), {
        ...env,
        WORKER_MODE: 'true',
        PORT: String(o.port + 1),
      }),
    );
  const cleanup = () => procs.forEach((p) => p.stop());
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  for (let i = 0; i < 90; i++) {
    try {
      await fetch(base);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const boot = {},
    snaps = {};
  if (o.profile)
    for (const p of procs) {
      boot[p.name] = await p.ask({ gc: true, spaces: true });
      if (o.snapshots)
        await p.ask(
          { snapshot: (snaps[`${p.name}-boot`] = join(o.out, `heap-${p.name}-boot.heapsnapshot`)) },
          300000,
        );
    }
  let ipn = 0;
  const hdr = (t) => ({
    'content-type': 'application/json',
    ...(t ? { authorization: `Bearer ${t}` } : {}),
    'x-forwarded-for': `10.9.${(ipn >> 8) & 255}.${ipn++ & 255}`,
  });
  const login = async () => {
    const r = await fetch(`${base}/v2/auth/login`, {
      method: 'POST',
      headers: hdr(),
      body: JSON.stringify({ email: o.email, password: o.password }),
    });
    const j = await r.json();
    if (!j.tokens?.accessToken) throw new Error(`login failed ${r.status}`);
    return j.tokens.accessToken;
  };
  let token = await login();

  const { io } = req('socket.io-client');
  const stats = { ok: 0, err: 0 };
  let seq = 0,
    stop = false;
  const call = async (method, path, body, tok = token) => {
    try {
      const h = {
        ...hdr(tok),
        ...(method === 'POST' ? { 'idempotency-key': `soak-${Date.now()}-${seq++}` } : {}),
      };
      const r = await fetch(base + path, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
      });
      await r.arrayBuffer();
      if (r.status < 500) stats.ok++;
      else stats.err++;
    } catch {
      stats.err++;
    }
  };
  const ops = [
    () => call('GET', '/v2/contacts?limit=20'),
    () => call('GET', '/v2/companies?limit=20'),
    () => call('GET', '/v2/contacts?limit=5&search=a'),
    () =>
      call('POST', '/v2/contacts', {
        name: `Soak ${seq}`,
        email: `soak${Date.now()}${seq}@soak.example.test`,
      }),
    () =>
      call(
        'POST',
        '/v2/public/webhooks/wa-calling',
        { object: 'soak', entry: [{ id: String(seq) }] },
        null,
      ),
    async () => {
      token = await login();
    },
    async () => {
      const r = await fetch(`${base}/v2/realtime/ticket`, {
        method: 'POST',
        headers: hdr(token),
        body: '{}',
      });
      const j = await r.json().catch(() => ({}));
      const s = io(`${base}/realtime`, {
        auth: j.ticket ? { ticket: j.ticket } : { token },
        transports: ['websocket'],
        reconnection: false,
      });
      await new Promise((res) => {
        s.on('connect', res);
        s.on('connect_error', res);
        setTimeout(res, 1500);
      });
      s.close();
      stats.ok++;
    },
  ];
  const bag = [30, 20, 10, 15, 10, 3, 12].flatMap((w, i) => Array(w).fill(i));
  const loops = Array.from({ length: Math.max(1, Math.round(o.rate / 5)) }, async () => {
    while (!stop) {
      try {
        await ops[bag[Math.floor(Math.random() * bag.length)]]();
      } catch {
        stats.err++;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  const Redis = req('ioredis'),
    { Client } = req('pg');
  const rd = new Redis(env.REDIS_URL),
    pg = new Client({ connectionString: `postgres://crm:crm@localhost:5432/${db}` });
  await pg.connect();
  const rows = [];
  const t0 = Date.now();
  const total = o.minutes * 60e3;
  let n = 0,
    snapA = null;
  const mb = (x) => x / 1048576;
  while (Date.now() - t0 < total) {
    await new Promise((r) => setTimeout(r, o.interval * 1000));
    const gc = ++n % o.gcEvery === 0,
      el = (Date.now() - t0) / 1000;
    const redisClients = (await rd.client('LIST'))
      .split('\n')
      .filter((l) => l.includes(`db=${dbIdx} `)).length;
    const pgConns = Number(
      (await pg.query('select count(*) c from pg_stat_activity where datname=$1', [db])).rows[0].c,
    );
    for (const p of procs) {
      const s = await p.ask({ gc, spaces: o.profile && gc });
      if (s?.spaces) lastSpaces[p.name] = s.spaces;
      if (s)
        rows.push({
          t: Math.round(el),
          proc: p.name,
          gc: gc ? 1 : 0,
          rssMb: mb(s.rss),
          heapUsedMb: mb(s.heapUsed),
          heapTotalMb: mb(s.heapTotal),
          externalMb: mb(s.external),
          arrayBuffersMb: mb(s.arrayBuffers),
          handles: s.handles,
          lagP99Ms: s.lagP99Ms,
          redisClients,
          pgConns,
          reqOk: stats.ok,
          reqErr: stats.err,
        });
    }
    if (procs.some((p) => p.exited)) {
      console.error('\na process exited during the soak: that is a failure');
      cleanup();
      process.exit(1);
    }
    if (o.profile && o.snapshots && !snaps.warm && el >= o.warmup * 60) {
      snaps.warm = true;
      for (const p of procs)
        await p.ask(
          {
            gc: true,
            snapshot: (snaps[`${p.name}-warm`] = join(o.out, `heap-${p.name}-warm.heapsnapshot`)),
          },
          300000,
        );
    }
    if (!o.profile && o.snapshots && !snapA && el >= o.warmup * 60) {
      snapA = join(o.out, 'heap-start.heapsnapshot');
      await procs[0].ask({ gc: true, snapshot: snapA }, 300000);
    }
    process.stdout.write(
      `\r${Math.round(el / 60)}/${o.minutes} min  ok=${stats.ok} err=${stats.err}   `,
    );
  }
  stop = true;
  await Promise.all(loops);
  const endpoints = {};
  if (o.profile) {
    const csv = [
      'name,email,phone',
      ...Array.from(
        { length: 200 },
        (_, i) => `Prof ${i},prof${i}@prof.example.test,+9198${10000000 + i}`,
      ),
    ].join('\n');
    const eps = {
      'GET /v2/contacts?limit=100 (large page)': () =>
        fetch(`${base}/v2/contacts?limit=100`, { headers: hdr(token) }),
      'GET /v2/contacts?search=a (search)': () =>
        fetch(`${base}/v2/contacts?limit=20&search=a`, { headers: hdr(token) }),
      'GET /v2/companies/export (CSV export)': () =>
        fetch(`${base}/v2/companies/export`, { headers: hdr(token) }),
      'POST /v2/contacts/import/preview (200 rows)': () => {
        const f = new FormData();
        f.append('file', new Blob([csv], { type: 'text/csv' }), 'prof.csv');
        const h = hdr(token);
        delete h['content-type'];
        return fetch(`${base}/v2/contacts/import/preview`, { method: 'POST', headers: h, body: f });
      },
    };
    for (const [name, fn] of Object.entries(eps)) {
      const a = await procs[0].ask({ gc: true }),
        codes = {};
      for (let i = 0; i < o.calls; i++) {
        try {
          const r = await fn();
          await r.arrayBuffer();
          codes[r.status] = (codes[r.status] || 0) + 1;
        } catch {
          codes.error = (codes.error || 0) + 1;
        }
      }
      const b = await procs[0].ask({ gc: true });
      endpoints[name] = {
        calls: o.calls,
        statuses: codes,
        heapUsedDeltaMb: +mb(b.heapUsed - a.heapUsed).toFixed(2),
        rssDeltaMb: +mb(b.rss - a.rss).toFixed(2),
        heapUsedKbPerCall: +((b.heapUsed - a.heapUsed) / 1024 / o.calls).toFixed(2),
      };
    }
  }
  let top = [];
  if (snapA) {
    const snapB = join(o.out, 'heap-end.heapsnapshot');
    await procs[0].ask({ gc: true, snapshot: snapB }, 300000);
    try {
      top = diffSnapshots(snapshotByName(snapA), snapshotByName(snapB));
    } catch (e) {
      top = [{ name: `diff failed: ${e.message}` }];
    }
  }
  cleanup();
  rd.disconnect();
  await pg.end();

  if (o.profile) {
    const snapshots = {};
    for (const [k, f] of Object.entries(snaps))
      if (typeof f === 'string') snapshots[k] = analyzeSnapshot(f);
    const mem = (x) =>
      x &&
      Object.fromEntries(
        ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers', 'mallocedMemory'].map((k) => [
          `${k}Mb`,
          +mb(x[k]).toFixed(1),
        ]),
      );
    writeFileSync(
      join(o.out, 'memory-profile.json'),
      JSON.stringify(
        {
          schema: 1,
          generatedAt: new Date().toISOString(),
          node: process.version,
          nodeEnv: env.NODE_ENV || '(unset: dev defaults)',
          options: {
            minutes: o.minutes,
            warmup: o.warmup,
            interval: o.interval,
            gcEvery: o.gcEvery,
            rate: o.rate,
            calls: o.calls,
          },
          machine: { loadavg: loadavg(), cpus: cpus().length },
          requests: stats,
          bootMb: Object.fromEntries(Object.entries(boot).map(([k, v]) => [k, mem(v)])),
          loadWindow: summarize(rows, o.warmup * 60),
          heapSpacesMb: Object.fromEntries(
            Object.entries(lastSpaces).map(([k, v]) => [
              k,
              v.map((x) => ({
                space: x.n,
                usedMb: +mb(x.used).toFixed(1),
                sizeMb: +mb(x.size).toFixed(1),
              })),
            ]),
          ),
          endpoints,
          snapshots,
        },
        null,
        1,
      ),
    );
  }
  const cols = Object.keys(rows[0] || {});
  writeFileSync(
    join(o.out, 'soak.csv'),
    [
      cols.join(','),
      ...rows.map((r) =>
        cols.map((c) => (typeof r[c] === 'number' ? +r[c].toFixed(3) : r[c])).join(','),
      ),
    ].join('\n'),
  );
  const fits = {};
  let fail = false;
  for (const p of procs.map((x) => x.name)) {
    for (const [m, onlyGc] of [
      ['rssMb', false],
      ['heapUsedMb', true],
      ['externalMb', true],
      ['handles', true],
      ['redisClients', true],
      ['pgConns', true],
    ]) {
      const r = rows.filter((x) => x.proc === p && x.t >= o.warmup * 60 && (!onlyGc || x.gc));
      const f = fitSlope(
        r.map((x) => x.t / 3600),
        r.map((x) => x[m]),
      );
      f.unit = m.endsWith('Mb') ? 'MB/h' : 'per h';
      f.threshold = m.endsWith('Mb') ? o.thresholdMbH : 1;
      f.sustained = isSustained(f, f.threshold);
      if (f.sustained && (m === 'rssMb' || m === 'heapUsedMb')) fail = true;
      fits[`${p}.${m}`] = f;
    }
  }
  const summary = {
    options: o,
    samples: rows.length,
    requests: stats,
    fits,
    topGrowingConstructors: top,
    verdict: fail ? 'GROWTH' : 'NO SUSTAINED GROWTH',
    note: 'A run under 60 minutes is a short noisy profile. The slope after warm-up is the signal, absolute numbers are not (shared machine).',
  };
  writeFileSync(join(o.out, 'soak.json'), JSON.stringify(summary, null, 2));
  const fmt = Object.fromEntries(
    Object.entries(fits).map(([k, f]) => [
      k,
      `${f.slope?.toFixed(2)} ${f.unit} [${f.lo?.toFixed(2)}, ${f.hi?.toFixed(2)}] n=${f.n}${f.sustained ? ' FLAG' : ''}`,
    ]),
  );
  console.log(
    '\n' + JSON.stringify({ verdict: summary.verdict, requests: stats, fits: fmt }, null, 1),
  );
  process.exit(fail ? 1 : 0);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
