// QA #55/#52: a small background sampler. While a spike or throughput run goes, it records every few seconds what the system is doing:
// API uptime (a drop means a restart), API memory, Postgres connections, and the depth of the BullMQ queues in Redis.
//   API_PID=1234 node tools/perf/sample.mjs perf/results/samples-http.json --seconds 900 [--every 2]
// It uses only the command-line clients (psql, redis-cli) and skips a reading when one is missing. Stops at --seconds or on SIGINT/SIGTERM.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('--seconds', 600));
const EVERY = Number(arg('--every', 2));
const API = process.env.API_URL || 'http://localhost:3000';
const run = (cmd, args, opts = {}) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim(); } catch { return null; } };

export function parseRss(statusText) {
  const m = /VmRSS:\s+(\d+)\s+kB/.exec(statusText ?? '');
  return m ? Math.round(Number(m[1]) / 1024) : null;
}

async function reading(t0) {
  const s = { t: Math.round((Date.now() - t0) / 1000), uptime: null, rssMb: null, pgConns: null, queueDepth: null };
  try { s.uptime = (await (await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) })).json()).uptimeSeconds ?? null; } catch { s.uptime = null; }
  if (process.env.API_PID) { try { s.rssMb = parseRss(readFileSync(`/proc/${process.env.API_PID}/status`, 'utf8')); } catch { /* process gone */ } }
  const pg = run('psql', ['-U', process.env.PGUSER || 'crm', '-d', process.env.PGDATABASE || 'crm', '-tAc', "select count(*) from pg_stat_activity where datname = current_database()"]);
  if (pg !== null) s.pgConns = Number(pg);
  const keys = run('redis-cli', ['--scan', '--pattern', 'bull:*:wait']);
  if (keys !== null) {
    let depth = 0;
    for (const k of keys.split('\n').filter(Boolean)) depth += Number(run('redis-cli', ['llen', k]) ?? 0);
    s.queueDepth = depth;
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}` && out) {
  const samples = [];
  const t0 = Date.now();
  const flush = () => writeFileSync(out, JSON.stringify(samples, null, 1) + '\n');
  const stop = () => { flush(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  while ((Date.now() - t0) / 1000 < SECONDS) {
    samples.push(await reading(t0));
    if (samples.length % 10 === 0) flush();
    await new Promise((r) => setTimeout(r, EVERY * 1000));
  }
  flush();
}
