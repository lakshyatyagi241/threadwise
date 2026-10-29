#!/usr/bin/env node
// RAM per WhatsApp session (Sheet4 V-01). Drives the real BaileysSocketFactory (the production code path) against a local fake
// WhatsApp endpoint, so no real account is needed. The fake accepts the WebSocket and never answers the handshake: every session
// stays in "connecting", which is the cost of a socket's own structures (caches, timers, noise state, ws), not of a live chat history.
// What this can prove: per-session RSS/heap, and whether an ended socket frees everything (churn, soak). What it cannot: the growth
// of a session with thousands of chats. That needs a live number; see the report.
//
//   cd apps/api && node --expose-gc --import tsx ../../tools/perf/baileys-ram.mjs --mode per-session --sessions 1,5,10,25,50
//   cd apps/api && node --expose-gc --import tsx ../../tools/perf/baileys-ram.mjs --mode churn --cycles 300
//   cd apps/api && node --expose-gc --import tsx ../../tools/perf/baileys-ram.mjs --mode soak --sessions 10 --minutes 720
import { createRequire } from 'node:module';
import { createHook } from 'node:async_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { queryObjects } from 'node:v8';
import { fitSlope } from './soak.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const NUM = {
  cycles: 'cycles',
  minutes: 'minutes',
  interval: 'interval',
  warmup: 'warmup',
  reconnect: 'reconnect',
};
const STR = { mode: 'mode', out: 'out', label: 'label' };

export function parseArgs(argv) {
  const o = {
    mode: 'per-session',
    sessions: [1, 5, 10, 25, 50],
    cycles: 300,
    minutes: 15,
    interval: 10,
    warmup: 2,
    reconnect: 60,
    label: 'run',
    out: join(root, 'perf/results/baileys-ram'),
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'sessions') o.sessions = argv[++i].split(',').map(Number);
    else if (k in NUM) o[NUM[k]] = Number(argv[++i]);
    else if (k in STR) o[STR[k]] = argv[++i];
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return o;
}

/** MB per session: the slope of y on the session count (fitSlope, shared with the soak). */
export const slopeOf = (x, y) => fitSlope(x, y).slope;

/** Growth of a series between its first and last quarter medians, in percent. Robust to one noisy sample. */
export function growthPct(ys) {
  if (ys.length < 8) return NaN;
  const q = Math.floor(ys.length / 4);
  const med = (a) => [...a].sort((p, r) => p - r)[Math.floor(a.length / 2)];
  const first = med(ys.slice(0, q));
  const last = med(ys.slice(-q));
  return ((last - first) / first) * 100;
}

const mb = (b) => Math.round((b / 1048576) * 10) / 10;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (typeof global.gc !== 'function') throw new Error('run with node --expose-gc');
  const req = createRequire(join(root, 'apps/api/package.json'));
  const baileysReq = createRequire(req.resolve('baileys'));
  const { WebSocketServer } = baileysReq('ws');
  const baileys = await import(pathToFileURL(req.resolve('baileys')).href);
  const NodeCache = (await import(pathToFileURL(baileysReq.resolve('@cacheable/node-cache')).href))
    .default;
  const { BaileysSocketFactory } = await import(
    pathToFileURL(
      join(root, 'apps/api/src/infra/providers/node-bridge-runtime/baileys.socket-factory.ts'),
    ).href
  );

  // The fake WhatsApp: accepts, never answers.
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  const port = wss.address().port;
  baileys.DEFAULT_CONNECTION_CONFIG.waWebSocketUrl = `ws://127.0.0.1:${port}`;

  // Stubs for what the factory is given: a store that holds nothing (every session starts with fresh credentials) and no network.
  const store = {
    read: async () => null,
    readMany: async () => new Map(),
    write: async () => undefined,
    deleteAll: async () => undefined,
  };
  const factory = new BaileysSocketFactory(store, {});
  factory.waVersion = async () => undefined; // no call to web.whatsapp.com

  // Live timers by async_hooks: an unref'd setInterval does not show in getActiveResourcesInfo, and that is the leak shape here.
  const live = new Set();
  createHook({
    init: (id, type) => type === 'Timeout' && live.add(id),
    destroy: (id) => live.delete(id),
  }).enable();

  const sample = async () => {
    await new Promise((r) => setTimeout(r, 200));
    global.gc();
    global.gc();
    const m = process.memoryUsage();
    return {
      rssMb: mb(m.rss),
      heapUsedMb: mb(m.heapUsed),
      externalMb: mb(m.external),
      arrayBuffersMb: mb(m.arrayBuffers),
      timers: live.size,
      nodeCaches: await queryObjects(NodeCache, { format: 'count' }),
    };
  };

  const open = [];
  const newSession = async () => {
    const sock = await factory.create({
      orgId: 1,
      deviceId: open.length + 1,
      phoneDigits: '0',
      proxy: null,
      historyImport: 'none',
    });
    sock.subscribe(() => undefined);
    return sock;
  };
  const endAll = () => {
    for (const s of open.splice(0)) s.end();
  };

  const result = {
    mode: o.mode,
    label: o.label,
    node: process.version,
    at: new Date().toISOString(),
    rows: [],
  };
  const cpu0 = process.cpuUsage();
  const base = await sample();
  result.baseline = base;

  if (o.mode === 'per-session') {
    for (const n of o.sessions) {
      while (open.length < n) open.push(await newSession());
      result.rows.push({ sessions: n, ...(await sample()) });
    }
    endAll();
    await new Promise((r) => setTimeout(r, 1000));
    result.afterEnd = await sample();
    const xs = result.rows.map((r) => r.sessions);
    result.perSessionRssMb =
      Math.round(
        slopeOf(
          xs,
          result.rows.map((r) => r.rssMb),
        ) * 1000,
      ) / 1000;
    result.perSessionHeapMb =
      Math.round(
        slopeOf(
          xs,
          result.rows.map((r) => r.heapUsedMb),
        ) * 1000,
      ) / 1000;
    result.perSessionTimers =
      Math.round(
        slopeOf(
          xs,
          result.rows.map((r) => r.timers),
        ) * 100,
      ) / 100;
    result.retainedAfterEndRssMb = Math.round((result.afterEnd.rssMb - base.rssMb) * 10) / 10;
    result.retainedAfterEndHeapMb =
      Math.round((result.afterEnd.heapUsedMb - base.heapUsedMb) * 10) / 10;
    result.retainedTimers = result.afterEnd.timers - base.timers;
    result.retainedNodeCaches = result.afterEnd.nodeCaches - base.nodeCaches;
  } else if (o.mode === 'churn') {
    // One session, created and ended again and again: what a reconnect loop does. Warm up first so one-time costs are not counted.
    for (let i = 0; i < 20; i++) (await newSession()).end();
    const start = await sample();
    const series = [];
    for (let i = 1; i <= o.cycles; i++) {
      (await newSession()).end();
      if (i % Math.max(1, Math.floor(o.cycles / 10)) === 0)
        series.push({ cycles: i, ...(await sample()) });
    }
    const end = series.at(-1);
    result.rows = series;
    result.start = start;
    result.perCycleHeapKb =
      Math.round((((end.heapUsedMb - start.heapUsedMb) * 1024) / o.cycles) * 10) / 10;
    result.perCycleRssKb = Math.round((((end.rssMb - start.rssMb) * 1024) / o.cycles) * 10) / 10;
    result.perCycleTimers = Math.round(((end.timers - start.timers) / o.cycles) * 100) / 100;
    result.perCycleNodeCaches =
      Math.round(((end.nodeCaches - start.nodeCaches) / o.cycles) * 100) / 100;
  } else if (o.mode === 'soak') {
    // N sessions held; every `reconnect` s each one is ended and rebuilt (the runtime's reconnect), as a real number does on a network blip.
    const n = o.sessions[0];
    for (let i = 0; i < n; i++) open.push(await newSession());
    const t0 = Date.now();
    const deadline = t0 + o.minutes * 60_000;
    let nextReconnect = t0 + o.reconnect * 1000;
    let reconnects = 0;
    const times = [];
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, o.interval * 1000));
      if (Date.now() >= nextReconnect) {
        for (let i = 0; i < open.length; i++) {
          open[i].end();
          open[i] = await newSession();
          reconnects++;
        }
        nextReconnect = Date.now() + o.reconnect * 1000;
      }
      const s = await sample();
      const t = (Date.now() - t0) / 1000;
      times.push(t);
      result.rows.push({ t: Math.round(t), ...s });
      process.stderr.write(
        `t=${Math.round(t)}s rss=${s.rssMb}MB heap=${s.heapUsedMb}MB timers=${s.timers} caches=${s.nodeCaches}\n`,
      );
    }
    const w = result.rows.filter((r) => r.t >= o.warmup * 60);
    const hours = w.map((r) => r.t / 3600);
    const rss = fitSlope(
      hours,
      w.map((r) => r.rssMb),
    );
    const heap = fitSlope(
      hours,
      w.map((r) => r.heapUsedMb),
    );
    result.sessions = n;
    result.reconnects = reconnects;
    result.rssSlopeMbPerH = rss;
    result.heapSlopeMbPerH = heap;
    result.rssGrowthPctOverWindow = Math.round(growthPct(w.map((r) => r.rssMb)) * 100) / 100;
    result.heapGrowthPctOverWindow = Math.round(growthPct(w.map((r) => r.heapUsedMb)) * 100) / 100;
    const mean = w.length ? w.reduce((a, r) => a + r.rssMb, 0) / w.length : NaN;
    // Extrapolated to 12 h from the slope's upper bound; a real 12 h run replaces this number with a measured one.
    result.rssGrowthPct12hUpper = Math.round(((rss.hi * 12) / mean) * 1000) / 10;
    result.rssGrowthPct12hPoint = Math.round(((rss.slope * 12) / mean) * 1000) / 10;
    endAll();
  } else {
    throw new Error(`unknown mode ${o.mode}`);
  }

  const cpu = process.cpuUsage(cpu0);
  result.cpuSeconds = Math.round(((cpu.user + cpu.system) / 1e6) * 10) / 10;
  mkdirSync(o.out, { recursive: true });
  const file = join(o.out, `${o.label}-${o.mode}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
  console.log(`written ${file}`);
  wss.close();
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
