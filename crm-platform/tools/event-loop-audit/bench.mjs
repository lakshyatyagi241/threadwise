#!/usr/bin/env node
// Reproducible micro-benchmark for the event-loop monitor itself (ELM-008, 048, 052).
//
//   node tools/event-loop-audit/bench.mjs [--seconds 15] [--concurrency 32] [--rounds 3]
//
// What it measures: (1) overhead - throughput and latency of an async endpoint with the monitor off vs on, alternating rounds;
// (2) detection - a deliberate 300 ms synchronous block injected under load: does the monitor see it, does request latency
// show it, and does the loop recover. The server is a bare http server in a child process; the load generator is this process.
// What it does NOT measure: the real API, the database, Redis, or any production traffic mix. Numbers are valid only for the
// machine and Node version recorded in the output, and must not be compared with numbers from another environment.
import { fork, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const SECONDS = arg('seconds', 15);
const CONC = arg('concurrency', 32);
const ROUNDS = arg('rounds', 3);
const require = createRequire(join(root, 'apps/api/package.json'));
const tsxCli = require.resolve('tsx/cli');

const agent = new http.Agent({ keepAlive: true, maxSockets: CONC + 4 });
const get = (port, path) =>
  new Promise((res, rej) => {
    const t0 = process.hrtime.bigint();
    http
      .get({ host: '127.0.0.1', port, path, agent }, (r) => {
        let b = '';
        r.on('data', (c) => (b += c));
        r.on('end', () =>
          res({ ms: Number(process.hrtime.bigint() - t0) / 1e6, body: b, status: r.statusCode }),
        );
      })
      .on('error', rej);
  });
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2);
};
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function startServer(port, monitored) {
  return new Promise((ok, fail) => {
    const child = fork(tsxCli, [join(here, 'bench-server.ts')], {
      env: { ...process.env, BENCH_PORT: String(port), BENCH_MONITOR: monitored ? '1' : '0' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.once('message', () => ok(child));
    child.once('error', fail);
    child.once('exit', (c) => fail(new Error(`bench server exited ${c}`)));
  });
}

async function load(port, seconds, onTick) {
  const lat = [];
  let errors = 0;
  const end = Date.now() + seconds * 1000;
  const ticker = onTick ? setInterval(onTick, 2000) : undefined;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (Date.now() < end) {
        try {
          lat.push((await get(port, '/fast')).ms);
        } catch {
          errors++;
        }
      }
    }),
  );
  if (ticker) clearInterval(ticker);
  return {
    requests: lat.length,
    errors,
    rps: +(lat.length / seconds).toFixed(1),
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    max: pct(lat, 100),
  };
}

const result = {
  generatedAt: new Date().toISOString(),
  environment: {
    commit: (() => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
      } catch {
        return null;
      }
    })(),
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memGb: +(totalmem() / 2 ** 30).toFixed(1),
    loadGenerator: 'in-process node:http keep-alive, closed loop',
    concurrency: CONC,
    secondsPerRound: SECONDS,
    rounds: ROUNDS,
    caveat:
      'Bare http server on the same machine as the load generator; shares CPU with it. Compare only runs from this same environment.',
  },
};

// (1) overhead
const rounds = { off: [], on: [] };
for (let r = 0; r < ROUNDS; r++) {
  for (const monitored of r % 2 === 0 ? [false, true] : [true, false]) {
    const port = 39000 + r * 2 + (monitored ? 1 : 0);
    const child = await startServer(port, monitored);
    await load(port, 2); // warm-up
    const stats = await load(port, SECONDS);
    rounds[monitored ? 'on' : 'off'].push(stats);
    child.removeAllListeners('exit');
    child.kill();
    console.log(`round ${r + 1} monitor=${monitored ? 'on ' : 'off'} ${JSON.stringify(stats)}`);
  }
}
const med = (k, f) => median(rounds[k].map((x) => x[f]));
result.overhead = {
  rounds,
  medianRps: { off: med('off', 'rps'), on: med('on', 'rps') },
  medianP99Ms: { off: med('off', 'p99'), on: med('on', 'p99') },
  rpsDeltaPercent: +(((med('on', 'rps') - med('off', 'rps')) / med('off', 'rps')) * 100).toFixed(2),
  note: 'Negative = slower with the monitor. Differences inside the run-to-run spread of the rounds are noise.',
};

// (2) detection and recovery under load
{
  const port = 39100;
  const child = await startServer(port, true);
  await load(port, 2);
  let injected = 0;
  const underLoad = await load(port, Math.max(10, SECONDS), () => {
    injected++;
    void get(port, '/block?ms=300').catch(() => undefined);
  });
  await new Promise((r) => setTimeout(r, 1500));
  const metrics = (await get(port, '/metrics')).body;
  const blockedWindows = [
    ...metrics.matchAll(
      /^crm_event_loop_blocked_windows_total\{[^}]*level="(\w+)"[^}]*\} (\S+)$/gm,
    ),
  ].map((m) => ({ level: m[1], windows: Number(m[2]) }));
  const quiet = await load(port, 4);
  await new Promise((r) => setTimeout(r, 1500));
  const after = (await get(port, '/metrics')).body;
  const maxOf = (text) =>
    Number(/^crm_event_loop_delay_max_seconds\{[^}]*\} (\S+)$/m.exec(text)?.[1] ?? NaN);
  child.removeAllListeners('exit');
  child.kill();
  result.detection = {
    injectedBlockMs: 300,
    injectedCount: injected,
    underLoad,
    blockedWindowsReported: blockedWindows,
    afterBlocksStop: { load: quiet, loopDelayMaxSeconds: maxOf(after) },
    reading:
      'Under load the blocked-window counters should be non-zero and request p99/max near the block length; after the blocks stop, request latency and the loop max delay should fall back (recovery).',
  };
}

const out = join(root, 'reports/event-loop');
mkdirSync(out, { recursive: true });
const file = join(out, 'bench-monitor.json');
writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`);
console.log(
  `\noverhead: rps off ${result.overhead.medianRps.off} on ${result.overhead.medianRps.on} (${result.overhead.rpsDeltaPercent}%)`,
);
console.log(`written ${file}`);
