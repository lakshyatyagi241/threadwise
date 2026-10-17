#!/usr/bin/env node
// Is the path from the host to Docker containers slow or unstable by itself, with the application nowhere in sight?
//
//   node tools/event-loop-audit/load/rtt-drift.mjs                 # 2 min quiet, 1 min of raw load, 2 min quiet
//
// Starts a throwaway Postgres and Redis, then from this Node process times one `SELECT 1` and one Redis `PING` per second and prints
// the p50 / p95 / max for every 30 s bucket. In the middle minute it adds 20 parallel loops of `SELECT 1` and `PING` (no application,
// no tenant, no auth). If round trips are slow or climb with this alone, the host's container networking is a cause of the slow
// authenticated requests seen in the load baselines (EL-B16), not the product. Writes reports/event-loop/rtt-drift.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(join(root, 'apps/api/package.json'));
const { Client } = require('pg');
const ioredis = require('ioredis');
const IORedis = ioredis.default ?? ioredis;

const QUIET = Number(process.argv.find((a) => a.startsWith('--quiet='))?.slice(8) ?? 120);
const BUSY = Number(process.argv.find((a) => a.startsWith('--busy='))?.slice(7) ?? 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) =>
  execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const PG = 'el-rtt-pg';
const RD = 'el-rtt-redis';
const cleanup = () => {
  for (const n of [PG, RD]) {
    try {
      docker('rm', '-f', n);
    } catch {
      /* not running */
    }
  }
};
cleanup();
docker(
  'run',
  '-d',
  '--rm',
  '--name',
  PG,
  '-e',
  'POSTGRES_PASSWORD=x',
  '-p',
  '55435:5432',
  'postgres:16-alpine',
);
docker('run', '-d', '--rm', '--name', RD, '-p', '56382:6379', 'redis:7-alpine');

const url = 'postgres://postgres:x@127.0.0.1:55435/postgres';
let pg;
for (let i = 0; i < 60; i++) {
  try {
    pg = new Client({ connectionString: url });
    await pg.connect();
    break;
  } catch {
    pg = undefined;
    await sleep(2000);
  }
}
if (!pg) {
  cleanup();
  throw new Error('postgres did not start');
}
const redis = new IORedis({ host: '127.0.0.1', port: 56382, maxRetriesPerRequest: null });
await redis.ping();

const samples = []; // {t, pg, redis, phase}
let phase = 'quiet-1';
const t0 = Date.now();
let stop = false;
const sampler = (async () => {
  while (!stop) {
    let t = performance.now();
    await pg.query('SELECT 1');
    const a = performance.now() - t;
    t = performance.now();
    await redis.ping();
    samples.push({ s: (Date.now() - t0) / 1000, pg: a, redis: performance.now() - t, phase });
    await sleep(1000);
  }
})();

await sleep(QUIET * 1000);

// What the real API plus worker hold open: pools of Postgres connections and many Redis connections (BullMQ opens several per queue).
// They stay idle; if round trips of the one sampler connection rise, the container networking is sensitive to connection count.
phase = 'idle-connections';
const idle = [];
for (let i = 0; i < 60; i++) {
  const c = new Client({ connectionString: url });
  await c.connect();
  idle.push(() => c.end());
}
for (let i = 0; i < 150; i++) {
  const r = new IORedis({ host: '127.0.0.1', port: 56382, maxRetriesPerRequest: null });
  await r.ping();
  idle.push(() => r.disconnect());
}
await sleep(QUIET * 1000);

phase = 'busy';
const workers = [];
let busyStop = false;
for (let i = 0; i < 20; i++) {
  workers.push(
    (async () => {
      const c = new Client({ connectionString: url });
      await c.connect();
      const r = new IORedis({ host: '127.0.0.1', port: 56382, maxRetriesPerRequest: null });
      while (!busyStop) {
        await c.query('SELECT 1');
        await r.ping();
      }
      await c.end();
      r.disconnect();
    })(),
  );
}
await sleep(BUSY * 1000);
busyStop = true;
await Promise.all(workers);
for (const close of idle) await Promise.resolve(close()).catch(() => undefined);
phase = 'quiet-2';
await sleep(QUIET * 1000);
stop = true;
await sampler;
await pg.end();
redis.disconnect();
cleanup();

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100
    : undefined;
};
const buckets = [];
const end = Math.max(...samples.map((x) => x.s));
for (let from = 0; from < end; from += 30) {
  const xs = samples.filter((x) => x.s >= from && x.s < from + 30);
  if (xs.length === 0) continue;
  buckets.push({
    fromSecond: from,
    phase: xs[0].phase,
    samples: xs.length,
    postgresSelect1Ms: {
      p50: q(
        xs.map((x) => x.pg),
        0.5,
      ),
      p95: q(
        xs.map((x) => x.pg),
        0.95,
      ),
      max: q(
        xs.map((x) => x.pg),
        1,
      ),
    },
    redisPingMs: {
      p50: q(
        xs.map((x) => x.redis),
        0.5,
      ),
      p95: q(
        xs.map((x) => x.redis),
        0.95,
      ),
      max: q(
        xs.map((x) => x.redis),
        1,
      ),
    },
  });
}
for (const b of buckets)
  console.log(
    `${String(b.fromSecond).padStart(4)}s ${b.phase.padEnd(8)} SELECT 1 p50 ${b.postgresSelect1Ms.p50} p95 ${b.postgresSelect1Ms.p95} max ${b.postgresSelect1Ms.max} | PING p50 ${b.redisPingMs.p50} p95 ${b.redisPingMs.p95} max ${b.redisPingMs.max}`,
  );
const out = join(root, 'reports/event-loop');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'rtt-drift.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, quietSeconds: QUIET, busySeconds: BUSY, buckets }, null, 1)}\n`,
);
console.log('written reports/event-loop/rtt-drift.json');
