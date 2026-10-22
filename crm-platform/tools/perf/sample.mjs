// QA #55/#52: a small background sampler. While a spike or throughput run goes, it records every few seconds what the system is doing:
// API uptime (a drop means a restart), API memory, Postgres connections, and the depth of the BullMQ queues in Redis.
//   API_PID=1234 node tools/perf/sample.mjs perf/results/samples-http.json --seconds 900 [--every 2]
// It uses only the command-line clients (psql, redis-cli) and skips a reading when one is missing. Stops at --seconds or on SIGINT/SIGTERM.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SECONDS = Number(arg('--seconds', 600));
const EVERY = Number(arg('--every', 2));
const API = process.env.API_URL || 'http://localhost:3000';
const cpuCount = () =>
  (readFileSync('/proc/cpuinfo', 'utf8').match(/^processor/gm) ?? []).length || 1;
const run = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
};

export function parseRss(statusText) {
  const m = /VmRSS:\s+(\d+)\s+kB/.exec(statusText ?? '');
  return m ? Math.round(Number(m[1]) / 1024) : null;
}

/** Busy and total CPU ticks of the whole machine, from the first line of /proc/stat. */
export function parseCpu(statText) {
  const m = /^cpu\s+(.+)$/m.exec(statText ?? '');
  if (!m) return null;
  const v = m[1].trim().split(/\s+/).map(Number);
  const total = v.reduce((a, b) => a + b, 0);
  const idle = (v[3] ?? 0) + (v[4] ?? 0);
  return { busy: total - idle, total };
}

/** utime + stime of one process, from /proc/<pid>/stat (the name in field 2 may hold spaces, so count from the last bracket). */
export function parseProcTicks(statText) {
  const i = (statText ?? '').lastIndexOf(')');
  if (i < 0) return null;
  const f = statText.slice(i + 2).split(' ');
  return Number(f[11]) + Number(f[12]);
}

let prevCpu = null;
let prevProc = null;

async function reading(t0) {
  const s = {
    t: Math.round((Date.now() - t0) / 1000),
    at: Date.now(),
    uptime: null,
    rssMb: null,
    pgConns: null,
    queueDepth: null,
    systemCpuPct: null,
    apiCpuPct: null,
  };
  try {
    const cpu = parseCpu(readFileSync('/proc/stat', 'utf8'));
    const proc = process.env.API_PID
      ? parseProcTicks(readFileSync(`/proc/${process.env.API_PID}/stat`, 'utf8'))
      : null;
    if (cpu && prevCpu) {
      const dt = cpu.total - prevCpu.total;
      if (dt > 0) {
        s.systemCpuPct = Math.round((100 * (cpu.busy - prevCpu.busy)) / dt);
        // Against ONE core: 100 means the API process used a whole core (it is a single thread of JavaScript plus helpers).
        if (proc != null && prevProc != null)
          s.apiCpuPct = Math.round((100 * (proc - prevProc) * cpuCount()) / dt);
      }
    }
    prevCpu = cpu;
    prevProc = proc;
  } catch {
    /* no /proc on this system */
  }
  try {
    s.uptime =
      (await (await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) })).json())
        .uptimeSeconds ?? null;
  } catch {
    s.uptime = null;
  }
  if (process.env.API_PID) {
    try {
      s.rssMb = parseRss(readFileSync(`/proc/${process.env.API_PID}/status`, 'utf8'));
    } catch {
      /* process gone */
    }
  }
  const pg = run('psql', [
    '-U',
    process.env.PGUSER || 'crm',
    '-d',
    process.env.PGDATABASE || 'crm',
    '-tAc',
    'select count(*) from pg_stat_activity where datname = current_database()',
  ]);
  if (pg !== null) s.pgConns = Number(pg);
  const keys = run('redis-cli', ['--scan', '--pattern', 'bull:*:wait']);
  if (keys !== null) {
    let depth = 0;
    for (const k of keys.split('\n').filter(Boolean))
      depth += Number(run('redis-cli', ['llen', k]) ?? 0);
    s.queueDepth = depth;
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}` && out) {
  const samples = [];
  const t0 = Date.now();
  const flush = () => writeFileSync(out, JSON.stringify(samples, null, 1) + '\n');
  const stop = () => {
    flush();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  while ((Date.now() - t0) / 1000 < SECONDS) {
    samples.push(await reading(t0));
    if (samples.length % 10 === 0) flush();
    await new Promise((r) => setTimeout(r, EVERY * 1000));
  }
  flush();
}
