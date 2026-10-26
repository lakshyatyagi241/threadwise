#!/usr/bin/env node
// What one busy queue costs in Redis memory, and what each BullMQ setting buys back (Sheet4 V-03). Runs the real BullMQ against a Redis you
// give it (a private one: it fills memory), for each variant: adds --jobs ids-only jobs, a worker completes them, then --fail more jobs that
// fail, and reads the bytes held by the queue's keys with MEMORY USAGE (exact) and the server's used_memory.
//   docker run -d --rm --name qb -p 127.0.0.1:7301:6379 redis:7-alpine redis-server --appendonly no --save ""
//   node tools/queue-capacity/retention-bench.mjs --url redis://127.0.0.1:7301 [--jobs 12000] [--fail 800] [--out f.json]
// Refuses the shared dev Redis ports. Variants are the defaults of apps/api/src/infra/queue/queues.ts and the settings under test.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const url = arg('--url');
if (!url) throw new Error('--url of a private Redis is required');
if (['6379', '56379'].includes(new URL(url).port || '6379'))
  throw new Error('refusing a shared Redis port');
const JOBS = Number(arg('--jobs', 12000));
const FAIL = Number(arg('--fail', 800));

const req = createRequire(join(root, 'apps/api/package.json'));
const { Queue, Worker } = await import(pathToFileURL(req.resolve('bullmq')).href);
const { default: Redis } = await import(pathToFileURL(req.resolve('ioredis')).href);
const conn = () => new Redis(url, { maxRetriesPerRequest: null });
const admin = conn();
const used = async () => Number((await admin.info('memory')).match(/used_memory:(\d+)/)[1]);

/** Queue defaults today (queues.ts DEFAULT_JOB_OPTIONS) and the variants. `events` is streams.events.maxLen (BullMQ default 10,000). */
const VARIANTS = [
  {
    name: 'today',
    events: undefined,
    complete: { count: 1000, age: 3600 },
    fail: { count: 500, age: 3 * 24 * 3600 },
  },
  {
    name: 'events-100',
    events: 100,
    complete: { count: 1000, age: 3600 },
    fail: { count: 500, age: 3 * 24 * 3600 },
  },
  {
    name: 'events-100-complete-100',
    events: 100,
    complete: { count: 100, age: 3600 },
    fail: { count: 500, age: 3 * 24 * 3600 },
  },
  {
    name: 'complete-true',
    events: undefined,
    complete: true,
    fail: { count: 500, age: 3 * 24 * 3600 },
  },
];

const bytesOfQueue = async (name) => {
  let cursor = '0';
  const by = {};
  do {
    const [n, keys] = await admin.scan(cursor, 'MATCH', `bull:${name}:*`, 'COUNT', 1000);
    cursor = n;
    for (const k of keys) {
      const part = k.slice(`bull:${name}:`.length);
      const kind = /^\d+$/.test(part) ? 'job' : /^\d+:/.test(part) ? 'job-sub' : part;
      by[kind] = (by[kind] ?? 0) + Number(await admin.call('MEMORY', 'USAGE', k, 'SAMPLES', '0'));
    }
  } while (cursor !== '0');
  return by;
};

async function run(v) {
  const name = `rb-${v.name}`;
  const q = new Queue(name, {
    connection: conn(),
    ...(v.events ? { streams: { events: { maxLen: v.events } } } : {}),
    defaultJobOptions: { attempts: 1, removeOnComplete: v.complete, removeOnFail: v.fail },
  });
  await q.waitUntilReady();
  const base = await used();
  let done = 0;
  const w = new Worker(
    name,
    async (job) => {
      if (job.data.fail) throw new Error('boom');
    },
    { connection: conn(), concurrency: 50 },
  );
  w.on('completed', () => done++);
  w.on('failed', () => done++);
  for (let i = 0; i < JOBS; i += 1000) {
    await q.addBulk(
      Array.from({ length: Math.min(1000, JOBS - i) }, (_, j) => ({
        name: 'run',
        data: { orgId: 1, id: i + j },
      })),
    );
  }
  await q.addBulk(
    Array.from({ length: FAIL }, (_, j) => ({
      name: 'run',
      data: { orgId: 1, id: j, fail: true },
    })),
  );
  while (done < JOBS + FAIL) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 500));
  const by = await bytesOfQueue(name);
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const res = {
    variant: v.name,
    jobs: JOBS,
    failed: FAIL,
    bytesByKind: by,
    queueBytes: total,
    usedMemoryDelta: (await used()) - base,
    eventsMaxLen: v.events ?? 10000,
  };
  await w.close();
  await q.close();
  return res;
}

const results = [];
for (const v of VARIANTS) results.push(await run(v));
const today = results[0].queueBytes;
for (const r of results) r.vsTodayPct = Math.round((r.queueBytes / today - 1) * 1000) / 10;
const out = {
  at: new Date().toISOString(),
  redis: (await admin.info('server')).match(/redis_version:(\S+)/)[1],
  results,
};
writeFileSync(arg('--out', 'retention-bench.json'), JSON.stringify(out, null, 2));
for (const r of results)
  console.log(
    `${r.variant.padEnd(26)} queue ${(r.queueBytes / 1024).toFixed(0).padStart(7)} KB  ${String(r.vsTodayPct).padStart(6)}%  ${JSON.stringify(Object.fromEntries(Object.entries(r.bytesByKind).map(([k, b]) => [k, Math.round(b / 1024)])))}`,
  );
await admin.quit();
process.exit(0);
