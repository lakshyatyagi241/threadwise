#!/usr/bin/env node
// Queue capacity benchmark harness (QCAP-021..060, 081..090). Real BullMQ workers against a real, throw-away Redis; synthetic jobs only.
//
//   node tools/queue-capacity/bench.mjs [--scenarios sweep,drain,profiles,isolation,fairness,provider,crash,redis,soak]
//        [--duration 1] [--soak-seconds 180] [--out reports/queue-capacity] [--redis-port 6390]
//
// What it measures: BullMQ + Redis + Node worker mechanics with sleep / busy-loop / pool-limited handlers. What it does NOT measure:
// the real processors, Postgres, Meta or any provider. Handlers stand in for those with the duration and failure shape given in the
// scenario, so a number here is a ceiling for the queue layer and a model input for sizing, never a production throughput claim.
// It starts its own redis-server (never REDIS_URL), sends nothing outside localhost, and removes its data directory on exit.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { cpus, platform, release, totalmem, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { findKnee, percentile, drainSeconds } from './lib/model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const SCENARIOS = opt('scenarios', 'sweep,drain,profiles,isolation,fairness,provider,crash,redis').split(',');
const DUR = Number(opt('duration', 1));
const SOAK_S = Number(opt('soak-seconds', 180));
const PORT = Number(opt('redis-port', 6390));
const OUT = resolve(root, opt('out', 'reports/queue-capacity'));
const ROLE = opt('role', 'main');

// bullmq / ioredis: this checkout's node_modules, else the main checkout's (a git worktree has none until `pnpm install`).
function resolveDeps() {
  const candidates = [join(root, 'apps/api/package.json')];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
    candidates.push(join(resolve(root, common, '..'), 'crm-platform/apps/api/package.json'));
  } catch {}
  for (const c of candidates) {
    try {
      const req = createRequire(c);
      req.resolve('bullmq');
      return { req, from: dirname(c) };
    } catch {}
  }
  throw new Error('bullmq not resolvable: run pnpm install');
}
const { req, from: depsFrom } = resolveDeps();
const { Queue, Worker } = req('bullmq');
const { Redis } = req('ioredis');
const bullmqVersion = req('bullmq/package.json').version;
const ioredisVersion = req('ioredis/package.json').version;

const conn = () => ({ host: '127.0.0.1', port: PORT, maxRetriesPerRequest: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 1) => (n == null || !Number.isFinite(n) ? n : +n.toFixed(d));

class Sem {
  constructor(n) { this.n = n; this.q = []; }
  async run(fn) {
    if (this.n > 0) this.n--; else await new Promise((r) => this.q.push(r));
    try { return await fn(); } finally { const next = this.q.shift(); if (next) next(); else this.n++; }
  }
}
const busy = (ms) => { const e = performance.now() + ms; while (performance.now() < e); };
function handlerFor(kind, ms, dbPool) {
  if (kind === 'cpu') return async () => busy(ms);
  if (kind === 'db') { const sem = new Sem(dbPool ?? 10); return () => sem.run(() => sleep(ms)); }
  return () => sleep(ms); // io / provider-bound wait
}

// ---------------------------------------------------------------- redis control
let redisProc = null;
let redisDir = null;
function startRedis({ aof = false, keepDir = false } = {}) {
  if (!keepDir || !redisDir) redisDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'qcap-redis-'));
  const args = ['--port', String(PORT), '--bind', '127.0.0.1', '--save', '', '--dir', redisDir, '--maxmemory-policy', 'noeviction', '--appendonly', aof ? 'yes' : 'no', '--appendfsync', 'everysec'];
  redisProc = spawn('redis-server', args, { stdio: 'ignore' });
  return waitRedis();
}
async function waitRedis() {
  for (let i = 0; i < 100; i++) {
    try { const r = new Redis({ ...conn(), maxRetriesPerRequest: 1, retryStrategy: () => null }); r.on('error', () => {}); await r.ping(); await r.quit(); return; } catch { await sleep(100); }
  }
  throw new Error('redis did not start');
}
function killRedis(sig = 'SIGKILL') { redisProc?.kill(sig); redisProc = null; }
async function redisInfo(r) {
  const info = await r.info();
  const g = (k) => Number((info.match(new RegExp(`^${k}:(\\d+)`, 'm')) ?? [])[1]);
  return { usedMemory: g('used_memory'), clients: g('connected_clients') };
}
async function redisLatency(r, n = 50) {
  const xs = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); await r.ping(); xs.push(performance.now() - t); }
  return { p50: round(percentile(xs, 50), 3), p99: round(percentile(xs, 99), 3) };
}

// ---------------------------------------------------------------- measurement primitives
function startSampler(queues, r) {
  const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
  const cpu0 = process.cpuUsage(); const t0 = performance.now();
  const series = []; let rssMax = 0; let heapMax = 0; let clientsMax = 0; let memMax = 0; let stop = false; let latMax = 0;
  const loop = (async () => {
    while (!stop) {
      const mu = process.memoryUsage(); rssMax = Math.max(rssMax, mu.rss); heapMax = Math.max(heapMax, mu.heapUsed);
      const info = await redisInfo(r); clientsMax = Math.max(clientsMax, info.clients); memMax = Math.max(memMax, info.usedMemory);
      const t = performance.now(); await r.ping(); latMax = Math.max(latMax, performance.now() - t);
      let backlog = 0; let oldest = 0;
      for (const q of queues) {
        const c = await q.getJobCounts('waiting', 'delayed', 'active', 'prioritized');
        backlog += c.waiting + c.delayed + (c.prioritized ?? 0);
        if (c.waiting) {
          const a = await q.getJobs(['waiting'], 0, 0, true); const b = await q.getJobs(['waiting'], 0, 0, false);
          const ts = [...a, ...b].filter(Boolean).map((j) => j.timestamp); if (ts.length) oldest = Math.max(oldest, Date.now() - Math.min(...ts));
        }
      }
      series.push({ t: round((performance.now() - t0) / 1000), backlog, oldestWaitingMs: oldest, rss: mu.rss, heap: mu.heapUsed, redisMem: info.usedMemory });
      await sleep(400);
    }
  })();
  return async () => {
    stop = true; await loop; h.disable();
    const cpu = process.cpuUsage(cpu0); const wall = (performance.now() - t0) * 1000;
    return {
      series,
      resources: {
        cpuPct: round(((cpu.user + cpu.system) / wall) * 100), rssMaxMB: round(rssMax / 1048576), heapMaxMB: round(heapMax / 1048576),
        eventLoopLagP99Ms: round(h.percentile(99) / 1e6, 2), eventLoopLagMaxMs: round(h.max / 1e6, 1),
        redisMemMaxMB: round(memMax / 1048576, 2), redisClientsMax: clientsMax, redisPingMaxMs: round(latMax, 2),
        peakBacklog: Math.max(0, ...series.map((s) => s.backlog)), oldestWaitingMaxMs: Math.max(0, ...series.map((s) => s.oldestWaitingMs)),
      },
    };
  };
}

function attach(worker) {
  const m = { samples: [], failed: 0, stalled: 0, errors: {} };
  worker.on('completed', (job) => m.samples.push({ wait: job.processedOn - job.timestamp - (job.opts.delay ?? 0), proc: job.finishedOn - job.processedOn, done: job.finishedOn, tag: job.data?.tag, attempts: job.attemptsMade }));
  worker.on('failed', (job, err) => { m.failed++; m.errors[err?.message?.slice(0, 40)] = (m.errors[err?.message?.slice(0, 40)] ?? 0) + 1; });
  worker.on('stalled', () => m.stalled++);
  worker.on('error', () => {});
  return m;
}
const summarize = (samples, filter) => {
  const s = filter ? samples.filter(filter) : samples;
  const w = s.map((x) => x.wait); const p = s.map((x) => x.proc);
  return { n: s.length, waitP50Ms: round(percentile(w, 50)), waitP95Ms: round(percentile(w, 95)), waitP99Ms: round(percentile(w, 99)), procP50Ms: round(percentile(p, 50)), procP95Ms: round(percentile(p, 95)), procP99Ms: round(percentile(p, 99)) };
};
const JOB_OPTS = { removeOnComplete: false, removeOnFail: false, attempts: 1 };
let uniq = 0;
const qname = (p) => `qcap-${p}-${process.pid}-${uniq++}`;

async function produce(queue, ratePerSec, seconds, mk = () => ({}), opts = JOB_OPTS) {
  let added = 0; let carry = 0; const tick = 50; const end = performance.now() + seconds * 1000; let next = performance.now();
  while (performance.now() < end) {
    carry += (ratePerSec * tick) / 1000; const n = Math.floor(carry); carry -= n;
    if (n > 0) { await queue.addBulk(Array.from({ length: n }, () => ({ name: 'j', data: mk(added++), opts }))); }
    next += tick; const d = next - performance.now(); if (d > 0) await sleep(d); else next = performance.now();
  }
  return added;
}
async function waitDrained(queues, timeoutMs) {
  const t0 = performance.now();
  for (;;) {
    let left = 0;
    for (const q of queues) { const c = await q.getJobCounts('waiting', 'active', 'delayed', 'prioritized'); left += c.waiting + c.active + c.delayed + (c.prioritized ?? 0); }
    if (left === 0) return { drained: true, seconds: round((performance.now() - t0) / 1000, 2) };
    if (performance.now() - t0 > timeoutMs) return { drained: false, seconds: round((performance.now() - t0) / 1000, 2), left };
    await sleep(100);
  }
}
async function accounting(queue, added) {
  const c = await queue.getJobCounts('completed', 'failed', 'waiting', 'active', 'delayed', 'prioritized');
  const accounted = c.completed + c.failed + c.waiting + c.active + c.delayed + (c.prioritized ?? 0);
  return { added, ...c, accounted, lost: added - accounted };
}
async function cleanup(queues, workers) {
  for (const w of workers) await w.close();
  for (const q of queues) { await q.obliterate({ force: true }).catch(() => {}); await q.close(); }
}

// ---------------------------------------------------------------- scenarios
const results = {};
const checks = [];
const check = (id, name, ok, detail) => { checks.push({ id, name, ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ` (${detail})` : ''}`); };

// QCAP-021/022/024: jobs/s vs concurrency per job shape.
async function sweep(r) {
  console.log('sweep');
  const shapes = [
    { kind: 'io', ms: 20, label: 'io-20ms (provider/HTTP wait)', n: (c) => Math.max(300, c * 150), levels: [1, 2, 5, 10, 20, 50, 100] },
    { kind: 'db', ms: 5, dbPool: 10, label: 'db-5ms (pool of 10)', n: (c) => Math.max(300, c * 100), levels: [1, 2, 5, 10, 20, 50] },
    { kind: 'cpu', ms: 3, label: 'cpu-3ms (sync work)', n: () => 1500, levels: [1, 2, 5, 10, 20] },
  ];
  const out = [];
  for (const s of shapes) {
    const points = [];
    for (const c of s.levels) {
      const name = qname('sweep'); const q = new Queue(name, { connection: conn() });
      const n = s.n(c); const stop = startSampler([q], r);
      await q.addBulk(Array.from({ length: n }, (_, i) => ({ name: 'j', data: { i }, opts: JOB_OPTS })));
      const w = new Worker(name, handlerFor(s.kind, s.ms, s.dbPool), { connection: conn(), concurrency: c }); const m = attach(w);
      const t0 = performance.now(); const d = await waitDrained([q], 120_000); const secs = (performance.now() - t0) / 1000;
      const { resources } = await stop(); const acc = await accounting(q, n);
      points.push({ concurrency: c, jobs: n, throughput: round(n / secs, 1), failRate: n ? m.failed / n : 0, ...summarize(m.samples), ...resources, lost: acc.lost, drained: d.drained });
      await cleanup([q], [w]);
      console.log(`  ${s.label} c=${c}: ${round(n / secs, 0)} jobs/s cpu=${resources.cpuPct}% lag99=${resources.eventLoopLagP99Ms}ms`);
    }
    const knee = findKnee(points);
    out.push({ shape: s.label, kind: s.kind, handlerMs: s.ms, points, ...knee, theoreticalAtKnee: knee.knee ? round((knee.knee / s.ms) * 1000) : null });
    check('QCAP-024', `knee found for ${s.label}`, knee.knee !== null, `knee=${knee.knee}${knee.atRangeEdge ? ' (AT EDGE of swept range: true knee is higher or producer-bound)' : ''} safeDefault=${knee.safeDefault} peak=${round(knee.peakThroughput, 0)}/s`);
    check('QCAP-040', `no lost jobs in ${s.label} sweep`, points.every((p) => p.lost === 0 && p.drained));
  }
  results.sweep = out;
}

// QCAP-017/018/039: backlog growth then drain, predicted vs measured.
async function drain(r) {
  console.log('drain');
  const c = 10; const ms = 20; const mu = (c / ms) * 1000 * 0.9; // 10% under the ideal so the estimate is tested, not assumed
  const name = qname('drain'); const q = new Queue(name, { connection: conn() });
  const w = new Worker(name, handlerFor('io', ms), { connection: conn(), concurrency: c }); const m = attach(w);
  const stop = startSampler([q], r);
  // measure mu first with a 3 s saturated burst
  const probe = 1500; await q.addBulk(Array.from({ length: probe }, (_, i) => ({ name: 'j', data: { i }, opts: JOB_OPTS })));
  const p0 = performance.now(); await waitDrained([q], 60_000); const muMeasured = probe / ((performance.now() - p0) / 1000);
  const lambdaHigh = muMeasured * 1.5; const lambdaLow = muMeasured * 0.5; const growS = 8 * DUR;
  const added1 = await produce(q, lambdaHigh, growS);
  const backlogAtSwitch = (await q.getJobCounts('waiting', 'delayed')).waiting;
  const predictedGrowth = (lambdaHigh - muMeasured) * growS;
  const predicted = drainSeconds(backlogAtSwitch, lambdaLow, muMeasured);
  const dr0 = performance.now(); const prodP = produce(q, lambdaLow, predicted + 2);
  // drain ends when backlog hits 0 while the low arrivals continue
  let measured = null; while (performance.now() - dr0 < (predicted + 30) * 1000) { const cnt = await q.getJobCounts('waiting'); if (cnt.waiting <= 2) { measured = (performance.now() - dr0) / 1000; break; } await sleep(100); }
  await prodP; await waitDrained([q], 60_000);
  const { resources } = await stop();
  const total = (await q.getJobCounts('completed', 'failed', 'waiting', 'active', 'delayed'));
  const err = measured ? Math.abs(measured - predicted) / predicted : null;
  results.drain = { idealCapacity: round(mu, 0), muMeasured: round(muMeasured, 0), lambdaHigh: round(lambdaHigh, 0), lambdaLow: round(lambdaLow, 0), growSeconds: growS, backlogAtSwitch, predictedBacklogGrowth: round(predictedGrowth, 0), predictedDrainSeconds: round(predicted, 1), measuredDrainSeconds: round(measured, 1), relativeError: round(err, 3), finalCounts: total, ...summarize(m.samples), ...resources };
  check('QCAP-018', 'drain forecast within 30% of measured', err !== null && err < 0.3, `predicted ${round(predicted, 1)}s measured ${round(measured, 1)}s`);
  check('QCAP-040', 'every drain-scenario job accounted for', total.failed === 0 && total.waiting + total.active + total.delayed === 0);
  await cleanup([q], [w]);
}

// QCAP-031..039: baseline .15, 50%, 100%, 130%, 200%, 300% of expected peak. Expected peak = 70% of measured capacity.
async function profiles(r) {
  console.log('profiles');
  const c = 10; const ms = 20;
  const name0 = qname('cap'); const q0 = new Queue(name0, { connection: conn() }); const w0 = new Worker(name0, handlerFor('io', ms), { connection: conn(), concurrency: c });
  await q0.addBulk(Array.from({ length: 2000 }, () => ({ name: 'j', data: {}, opts: JOB_OPTS }))); const t0 = performance.now(); await waitDrained([q0], 60_000);
  const mu = 2000 / ((performance.now() - t0) / 1000); await cleanup([q0], [w0]);
  const peak = mu * 0.7;
  const plan = [['baseline-15%', 0.15, 6], ['moderate-50%', 0.5, 8], ['expected-peak-100%', 1, 10], ['headroom-130%', 1.3, 8], ['stress-200%', 2, 6], ['spike-300%', 3, 3]];
  const out = [];
  for (const [label, frac, secs] of plan) {
    const name = qname('prof'); const q = new Queue(name, { connection: conn() }); const w = new Worker(name, handlerFor('io', ms), { connection: conn(), concurrency: c }); const m = attach(w);
    const stop = startSampler([q], r); const lambda = peak * frac; const s = secs * DUR;
    const added = await produce(q, lambda, s); const atEnd = await q.getJobCounts('waiting', 'active');
    const completedAtEnd = (await q.getJobCounts('completed')).completed;
    const d = await waitDrained([q], 120_000);
    const { resources } = await stop(); const acc = await accounting(q, added);
    const predictedDrain = drainSeconds(atEnd.waiting, 0, mu);
    out.push({ profile: label, arrivalRate: round(lambda, 0), expectedPeak: round(peak, 0), measuredCapacity: round(mu, 0), seconds: s, jobs: added, completedWhileLoaded: completedAtEnd, backlogAtEndOfLoad: atEnd.waiting, drainSeconds: d.seconds, predictedDrainSeconds: round(predictedDrain, 1), workerUtilizationPct: round(Math.min(1, lambda / mu) * 100, 0), ...summarize(m.samples), ...resources, accounting: acc });
    console.log(`  ${label}: λ=${round(lambda, 0)}/s waitP95=${summarize(m.samples).waitP95Ms}ms backlogEnd=${atEnd.waiting} drain=${d.seconds}s lost=${acc.lost}`);
    check('QCAP-040', `${label}: all accepted jobs reconciled`, acc.lost === 0 && acc.failed === 0 && d.drained);
    await cleanup([q], [w]);
  }
  results.profiles = { capacityJobsPerSec: round(mu, 0), expectedPeakJobsPerSec: round(peak, 0), basis: 'expected peak is a synthetic 70% of measured capacity (no production traffic data); replace with forecast', runs: out };
  const peakRun = out.find((o) => o.profile.startsWith('expected-peak')); const head = out.find((o) => o.profile.startsWith('headroom')); const spike = out.find((o) => o.profile.startsWith('spike'));
  check('QCAP-033', 'expected peak: queue wait p95 < 250 ms', peakRun.waitP95Ms < 250, `${peakRun.waitP95Ms} ms`);
  check('QCAP-034', '130% headroom: queue wait p95 < 1000 ms', head.waitP95Ms < 1000, `${head.waitP95Ms} ms`);
  check('QCAP-036', '300% spike: backlog bounded and drains', spike.drainSeconds < 900, `drained in ${spike.drainSeconds}s vs forecast ${spike.predictedDrainSeconds}s`);
}

// QCAP-065/079: critical vs bulk. Same total slots (12) in every variant.
async function isolation(r) {
  console.log('isolation');
  const variants = [];
  const crit = async (q, secs, tag = 'crit') => produce(q, 100, secs, () => ({ tag }));
  // A: shared queue, FIFO, 12 slots. Bulk preloaded first.
  { const name = qname('shared'); const q = new Queue(name, { connection: conn() });
    await q.addBulk(Array.from({ length: 3000 }, () => ({ name: 'j', data: { tag: 'bulk' }, opts: JOB_OPTS })));
    const w = new Worker(name, async (job) => sleep(job.data.tag === 'bulk' ? 20 : 5), { connection: conn(), concurrency: 12 }); const m = attach(w);
    await crit(q, 8 * DUR); await waitDrained([q], 120_000);
    variants.push({ variant: 'A shared FIFO queue (12 slots)', critical: summarize(m.samples, (x) => x.tag === 'crit'), bulk: summarize(m.samples, (x) => x.tag === 'bulk') }); await cleanup([q], [w]); }
  // B: separate queues, 8+4 slots, io bulk.
  { const qc = new Queue(qname('crit'), { connection: conn() }); const qb = new Queue(qname('bulk'), { connection: conn() });
    await qb.addBulk(Array.from({ length: 3000 }, () => ({ name: 'j', data: { tag: 'bulk' }, opts: JOB_OPTS })));
    const wc = new Worker(qc.name, async () => sleep(5), { connection: conn(), concurrency: 8 }); const wb = new Worker(qb.name, async () => sleep(20), { connection: conn(), concurrency: 4 });
    const mc = attach(wc); const mb = attach(wb); const stop = startSampler([qc, qb], r);
    await produce(qc, 100, 8 * DUR, () => ({ tag: 'crit' })); const { resources } = await stop();
    variants.push({ variant: 'B separate queues, 8+4 slots, same process', critical: summarize(mc.samples), bulk: summarize(mb.samples), ...resources }); await cleanup([qc, qb], [wc, wb]); }
  // C: separate queues, CPU-heavy bulk (40 ms sync) in the SAME process as the critical worker.
  { const qc = new Queue(qname('crit'), { connection: conn() }); const qb = new Queue(qname('bulk'), { connection: conn() });
    await qb.addBulk(Array.from({ length: 400 }, () => ({ name: 'j', data: { tag: 'bulk' }, opts: JOB_OPTS })));
    const wc = new Worker(qc.name, async () => sleep(5), { connection: conn(), concurrency: 8 }); const wb = new Worker(qb.name, async () => busy(40), { connection: conn(), concurrency: 4 });
    const mc = attach(wc); const stop = startSampler([qc], r);
    await produce(qc, 100, 8 * DUR, () => ({ tag: 'crit' })); const { resources } = await stop();
    variants.push({ variant: 'C separate queues, CPU-heavy bulk (40 ms sync) in SAME process', critical: summarize(mc.samples), ...resources }); await cleanup([qc, qb], [wc, wb]); }
  // D: same CPU-heavy bulk in its own worker process.
  { const qc = new Queue(qname('crit'), { connection: conn() }); const qb = new Queue(qname('bulk'), { connection: conn() });
    await qb.addBulk(Array.from({ length: 400 }, () => ({ name: 'j', data: { tag: 'bulk' }, opts: JOB_OPTS })));
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', 'worker', '--queue', qb.name, '--kind', 'cpu', '--ms', '40', '--conc', '4', '--redis-port', String(PORT)], { stdio: 'ignore' });
    const wc = new Worker(qc.name, async () => sleep(5), { connection: conn(), concurrency: 8 }); const mc = attach(wc); const stop = startSampler([qc], r);
    await produce(qc, 100, 8 * DUR, () => ({ tag: 'crit' })); const { resources } = await stop(); child.kill('SIGKILL');
    variants.push({ variant: 'D separate queues, CPU-heavy bulk in its OWN worker process', critical: summarize(mc.samples), ...resources }); await cleanup([qc, qb], [wc]); }
  results.isolation = variants;
  const [A, B, C, D] = variants;
  check('QCAP-065', 'shared FIFO queue starves critical work (documents why queues are split)', A.critical.waitP95Ms > 1000, `p95 ${A.critical.waitP95Ms} ms`);
  check('QCAP-065', 'separate queues keep critical wait p95 < 250 ms under a bulk flood', B.critical.waitP95Ms < 250, `p95 ${B.critical.waitP95Ms} ms`);
  check('QCAP-065', 'RISK DEMONSTRATED: CPU-heavy bulk in the same process delays critical work (queues alone do not isolate CPU)', C.critical.waitP95Ms > 250, `p95 ${C.critical.waitP95Ms} ms, loop lag p99 ${C.eventLoopLagP99Ms} ms vs ${D.critical.waitP95Ms} ms with its own process`);
  check('QCAP-006', 'own process for CPU-heavy bulk keeps critical wait p95 < 250 ms', D.critical.waitP95Ms < 250, `p95 ${D.critical.waitP95Ms} ms`);
}

// QCAP-064/066/068: one noisy tenant, FIFO vs a per-tenant admission cap in front of the queue.
async function fairness(r) {
  console.log('fairness');
  const out = [];
  for (const mode of ['fifo', 'admission-cap-300']) {
    const name = qname('fair'); const q = new Queue(name, { connection: conn() });
    const w = new Worker(name, async () => sleep(10), { connection: conn(), concurrency: 10 }); const m = attach(w);
    const A = 6000; const staged = Array.from({ length: A }, () => ({ name: 'j', data: { tag: 'A' }, opts: JOB_OPTS })); let aInQueue = 0;
    const t0 = performance.now(); let feeding = true;
    const feeder = (async () => {
      if (mode === 'fifo') { await q.addBulk(staged); return; }
      while (staged.length) { const c = await q.getJobCounts('waiting', 'active'); const inQ = c.waiting + c.active; const room = Math.max(0, 300 - inQ); if (room) await q.addBulk(staged.splice(0, room)); await sleep(30); }
      feeding = false;
    })();
    await sleep(200); await produce(q, 50, 6 * DUR, () => ({ tag: 'B' })); await feeder; const d = await waitDrained([q], 120_000);
    const aDone = Math.max(...m.samples.filter((x) => x.tag === 'A').map((x) => x.done)); out.push({ mode, tenantB: summarize(m.samples, (x) => x.tag === 'B'), tenantA: summarize(m.samples, (x) => x.tag === 'A'), tenantACompletionSeconds: round((aDone - (Date.now() - (performance.now() - t0))) / 1000, 1), drained: d.drained });
    await cleanup([q], [w]);
  }
  results.fairness = out;
  check('QCAP-066', 'FIFO: small tenant is delayed by the noisy tenant (baseline)', out[0].tenantB.waitP95Ms > 1000, `p95 ${out[0].tenantB.waitP95Ms} ms`);
  check('QCAP-064', 'admission cap keeps the small tenant wait p95 < 1000 ms', out[1].tenantB.waitP95Ms < 1000, `p95 ${out[1].tenantB.waitP95Ms} ms`);
  check('QCAP-068', 'admission cap does not starve the noisy tenant (still completes)', out[1].tenantA.n === 6000);
}

// QCAP-055..058: provider ceiling 100 req/s; 429 storm with retries vs a worker limiter below the ceiling.
async function provider() {
  console.log('provider');
  const out = [];
  for (const mode of ['no-limiter c=50', 'limiter 90/s c=50']) {
    const name = qname('prov'); const q = new Queue(name, { connection: conn() });
    let tokens = 100; let calls = 0; let rejected = 0; const refill = setInterval(() => { tokens = Math.min(100, tokens + 10); }, 100);
    const handler = async () => { calls++; await sleep(15); if (tokens <= 0) { rejected++; throw new Error('429 provider rate limit'); } tokens--; };
    const n = 2000; await q.addBulk(Array.from({ length: n }, () => ({ name: 'j', data: {}, opts: { ...JOB_OPTS, attempts: 5, backoff: { type: 'exponential', delay: 100 } } })));
    const w = new Worker(name, handler, { connection: conn(), concurrency: 50, ...(mode.startsWith('limiter') ? { limiter: { max: 90, duration: 1000 } } : {}) }); const m = attach(w);
    const t0 = performance.now(); const d = await waitDrained([q], 180_000); const secs = (performance.now() - t0) / 1000; clearInterval(refill);
    const acc = await accounting(q, n);
    out.push({ mode, jobs: n, providerCeilingPerSec: 100, seconds: round(secs, 1), effectiveJobsPerSec: round(acc.completed / secs, 1), providerCalls: calls, rejected429: rejected, callAmplification: round(calls / n, 2), exhaustedFailed: acc.failed, completed: acc.completed, lost: acc.lost, drained: d.drained });
    await cleanup([q], [w]);
  }
  results.provider = out;
  check('QCAP-058', 'limiter below the ceiling removes the 429 storm', out[1].rejected429 < out[0].rejected429 / 5 || out[0].rejected429 === 0, `${out[0].rejected429} -> ${out[1].rejected429} rejected`);
  check('QCAP-056', 'limited run completes every job', out[1].completed === 2000 && out[1].lost === 0, `completed ${out[1].completed}`);
  check('QCAP-057', 'unlimited run loses no accepted job to 429 (accounted completed or failed)', out[0].lost === 0, `failed ${out[0].exhaustedFailed}`);
}

// QCAP-081/082/090: kill -9 a worker mid-job; at-least-once, guarded effect once, and what maxStalledCount does.
async function crash(r) {
  console.log('crash');
  const out = [];
  for (const kills of [1, 2]) {
    const name = qname('crash'); const q = new Queue(name, { connection: conn() }); const n = 200; await r.del('execs');
    await q.addBulk(Array.from({ length: n }, (_, i) => ({ name: 'j', data: { i }, opts: JOB_OPTS })));
    const spawnChild = () => spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', 'worker', '--queue', name, '--kind', 'effect', '--ms', '1500', '--conc', '10', '--lock', '2000', '--redis-port', String(PORT)], { stdio: 'ignore' });
    for (let k = 0; k < kills; k++) { const c = spawnChild(); await sleep(900); c.kill('SIGKILL'); await sleep(200); }
    const w = new Worker(name, async (job) => { await r.incr('execs'); await r.set(`eff:${name}:${job.data.i}`, '1', 'NX'); await sleep(50); }, { connection: conn(), concurrency: 10, stalledInterval: 1000, lockDuration: 2000 }); const m = attach(w);
    const t0 = performance.now(); const d = await waitDrained([q], 90_000); const acc = await accounting(q, n);
    const failedJobs = await q.getFailed(0, 5); const stallFailed = (await q.getFailed(0, 500)).filter((j) => /stalled/i.test(j.failedReason ?? '')).length;
    out.push({ kills, jobs: n, recoverySeconds: round((performance.now() - t0) / 1000, 1), completed: acc.completed, failed: acc.failed, failedByStallLimit: stallFailed, lost: acc.lost, stalledEventsInRecoveryWorker: m.stalled, drained: d.drained, sampleFailReason: failedJobs[0]?.failedReason });
    check('QCAP-081', `${kills} worker kill(s): every accepted job reconciled (completed or failed, none missing)`, acc.lost === 0 && d.drained, `completed ${acc.completed} failed ${acc.failed}`);
    if (kills === 2) check('QCAP-081', 'repeated kills: no job silently fails on the stall limit', stallFailed === 0, `${stallFailed} jobs failed with "stalled more than allowable limit" (BullMQ maxStalledCount default 1)`);
    await cleanup([q], [w]);
  }
  results.crash = out;
}

// QCAP-044/047/050/084: kill -9 Redis with a backlog. Persistence policy decides what survives.
async function redisRestart() {
  console.log('redis');
  const out = [];
  for (const aof of [false, true]) {
    killRedis(); await sleep(300); await startRedis({ aof });
    let r = new Redis(conn()); const name = qname('rr'); let q = new Queue(name, { connection: conn() }); q.on('error', () => {}); const n = 5000;
    for (let i = 0; i < n; i += 1000) await q.addBulk(Array.from({ length: 1000 }, (_, k) => ({ name: 'j', data: { i: i + k }, opts: JOB_OPTS })));
    await sleep(1200); // one appendfsync everysec window
    await q.close(); r.disconnect(); killRedis('SIGKILL'); await sleep(300); await startRedis({ aof, keepDir: true });
    r = new Redis(conn()); q = new Queue(name, { connection: conn() }); const c = await q.getJobCounts('waiting');
    const w = new Worker(name, async () => {}, { connection: conn(), concurrency: 20 }); const d = await waitDrained([q], 60_000);
    out.push({ persistence: aof ? 'appendonly yes, everysec' : 'no persistence', accepted: n, survivedRestart: c.waiting, lost: n - c.waiting, drainedAfterRestart: d.drained });
    await cleanup([q], [w]); r.disconnect();
  }
  results.redisRestart = out;
  check('QCAP-044', 'AOF everysec keeps the accepted backlog across kill -9 (after the fsync window)', out[1].lost === 0, `lost ${out[1].lost}/5000`);
  check('QCAP-050', 'no-persistence Redis loses the accepted backlog on restart (documents why prod needs AOF)', out[0].lost > 0, `lost ${out[0].lost}/5000`);
}

// QCAP-037: short soak. NOT the 12 h / 24 h standard; records trend only.
async function soak(r) {
  console.log(`soak ${SOAK_S}s`);
  const name = qname('soak'); const q = new Queue(name, { connection: conn() }); const w = new Worker(name, handlerFor('io', 20), { connection: conn(), concurrency: 10 }); const m = attach(w);
  const stop = startSampler([q], r); const lambda = 350; const added = await produce(q, lambda, SOAK_S, () => ({}), { removeOnComplete: { count: 1000, age: 3600 }, removeOnFail: { count: 1000 }, attempts: 1 });
  await waitDrained([q], 60_000); const { series, resources } = await stop(); const done = (await q.getJobCounts('completed', 'failed'));
  const half = series.slice(Math.floor(series.length / 2)); const slope = (key) => { const n = half.length; if (n < 3) return null; const xs = half.map((s) => s.t); const ys = half.map((s) => s[key]); const mx = xs.reduce((a, b) => a + b) / n; const my = ys.reduce((a, b) => a + b) / n; return ys.reduce((a, y, i) => a + (xs[i] - mx) * (y - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); };
  results.soak = { seconds: SOAK_S, lambda, jobs: added, ...summarize(m.samples), ...resources, rssSlopeMBPerMin: round((slope('rss') ?? 0) * 60 / 1048576, 2), heapSlopeMBPerMin: round((slope('heap') ?? 0) * 60 / 1048576, 2), redisMemSlopeMBPerMin: round((slope('redisMem') ?? 0) * 60 / 1048576, 3), completedKept: done.completed, failed: m.failed, note: 'short soak only; the 12 h and 24 h runs of the standard are NOT done' };
  check('QCAP-037', 'soak: no failures, no growing backlog', m.failed === 0 && resources.peakBacklog < 200, `peak backlog ${resources.peakBacklog}`);
  check('QCAP-026', 'soak: heap/RSS flat (<5 MB/min growth in second half)', Math.abs(results.soak.rssSlopeMBPerMin) < 5, `rss ${results.soak.rssSlopeMBPerMin} MB/min`);
  await cleanup([q], [w]);
}

// ---------------------------------------------------------------- worker role (child process)
async function workerRole() {
  const queue = opt('queue'); const kind = opt('kind', 'io'); const ms = Number(opt('ms', 20)); const conc = Number(opt('conc', 4));
  let h = handlerFor(kind, ms);
  if (kind === 'effect') { const r = new Redis(conn()); h = async (job) => { await r.incr('execs'); await r.set(`eff:${queue}:${job.data.i}`, '1', 'NX'); await sleep(ms); }; }
  new Worker(queue, h, { connection: conn(), concurrency: conc, lockDuration: Number(opt('lock', 30_000)), stalledInterval: 1000 }).on('error', () => {});
  setInterval(() => {}, 1 << 30);
}

// ---------------------------------------------------------------- main
function gitSha() { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return 'unknown'; } }
async function main() {
  mkdirSync(OUT, { recursive: true });
  await startRedis();
  const r = new Redis(conn());
  const redisVersion = (await r.info('server')).match(/redis_version:(\S+)/)?.[1];
  const started = new Date().toISOString();
  const idleLatency = await redisLatency(r);
  try {
    for (const s of SCENARIOS) {
      if (s === 'sweep') await sweep(r); else if (s === 'drain') await drain(r); else if (s === 'profiles') await profiles(r);
      else if (s === 'isolation') await isolation(r); else if (s === 'fairness') await fairness(r); else if (s === 'provider') await provider();
      else if (s === 'crash') await crash(r); else if (s === 'redis') await redisRestart(); else if (s === 'soak') await soak(r);
      else console.log(`unknown scenario ${s}`);
    }
  } finally {
    killRedis();
    if (redisDir) rmSync(redisDir, { recursive: true, force: true });
  }
  const envelope = {
    generatedAt: new Date().toISOString(), startedAt: started, commit: gitSha(), bullmq: bullmqVersion, ioredis: ioredisVersion, redis: redisVersion, node: process.version,
    host: { platform: platform(), release: release(), cpus: cpus().length, cpuModel: cpus()[0]?.model, memGB: round(totalmem() / 2 ** 30) },
    redisConfig: { appendonly: 'no (main scenarios)', maxmemoryPolicy: 'noeviction', singleInstance: true }, depsFrom,
    scenarios: SCENARIOS, durationMultiplier: DUR, idleRedisPingMs: idleLatency,
    caveat: 'Synthetic handlers on one machine that also hosts producer, workers and Redis. Numbers are relative, queue-layer ceilings, not production capacity.',
    reproduce: `node tools/queue-capacity/bench.mjs --scenarios ${SCENARIOS.join(',')} --duration ${DUR}${SCENARIOS.includes('soak') ? ` --soak-seconds ${SOAK_S}` : ''}`,
  };
  const pass = checks.filter((c) => c.ok).length;
  const report = { ...envelope, summary: { checks: checks.length, passed: pass, failed: checks.length - pass }, checks, results };
  writeFileSync(join(OUT, 'queue-capacity-bench.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${pass}/${checks.length} checks passed -> ${join(OUT, 'queue-capacity-bench.json')}`);
  process.exit(checks.length - pass ? 1 : 0);
}

if (ROLE === 'worker') workerRole(); else main().catch((e) => { console.error(e); killRedis(); process.exit(2); });
