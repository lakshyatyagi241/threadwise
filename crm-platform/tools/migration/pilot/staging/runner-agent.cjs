#!/usr/bin/env node
/**
 * The runner agent of the admin "Waboo migration" panel.
 *
 * Waboo's database only answers over the Geta VPN, so the migration pipeline cannot run inside WaDesk's API or worker. This script runs
 * on a machine that IS on the VPN and has the pipeline's own access (the jump host key, the staging SSH key): it asks the WaDesk API
 * for the job of a migration an operator started in the panel, runs `pipeline.cjs` for it, and reports the pipeline's progress back so
 * the panel shows it live. It starts nothing on its own: it only runs a job whose run is already RUNNING in the panel, with exactly
 * the three values of that run, each checked here again before a process is started.
 *
 *   WABOO_RUNNER_URL     https://desk.wabo.ai            (the WaDesk address; the API is under /v2)
 *   WABOO_RUNNER_TOKEN   the shared token, 32+ characters (the SAME value as WABOO_RUNNER_TOKEN on the API)
 *   WABOO_RUNNER_NAME    a label shown in the panel (default: this machine's name)
 *   WABOO_MIGRATE_TIMEOUT_MIN   hard limit of one run in minutes (default 90, same as the worker)
 *
 *   node tools/migration/pilot/staging/runner-agent.cjs            # runs until stopped (Ctrl+C)
 *   node tools/migration/pilot/staging/runner-agent.cjs --once     # takes at most one job, then exits (for a test)
 *
 * The token is read from the environment only: never a flag (it would show in the process list), never printed, never logged. Everything
 * the pipeline needs (its own environment file, SSH keys) is read by the pipeline itself, as when it is run by hand. Waboo is read-only.
 */
'use strict';
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HERE = __dirname;
const PIPELINE = path.join(HERE, 'pipeline.cjs');
const BASE = '/v2/platform/waboo-migration/runner';

// the same shapes the API enforces (packages/contracts/src/waboo-migration/constants.ts); checked again here before a process starts
const CLIENT_RE = /^[a-z0-9_-]{1,64}$/;
const DB_RE = /^[A-Za-z0-9_+]{1,128}$/;
const MODES = ['dry', 'load', 'catchup'];
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_TOKEN = 32;
const MAX_LINES = 50;
const MAX_LINE = 8 * 1024;
const MAX_REPORT_BYTES = 60 * 1024;

/** A job as the API hands it out -> a clean job, or null when anything about it is wrong (nothing is started for it). */
function validJob(j) {
  if (!j || typeof j !== 'object') return null;
  if (typeof j.runId !== 'string' || !UUID_RE.test(j.runId)) return null;
  if (typeof j.sourceClient !== 'string' || !CLIENT_RE.test(j.sourceClient)) return null;
  if (typeof j.sourceDb !== 'string' || !DB_RE.test(j.sourceDb)) return null;
  if (!MODES.includes(j.mode)) return null;
  return { runId: j.runId, sourceClient: j.sourceClient, sourceDb: j.sourceDb, mode: j.mode };
}

/**
 * The environment the pipeline gets: this process's, without the runner's own settings. The token only lets a caller claim jobs and write
 * events; the pipeline and everything it starts (cycle.cjs, ssh, the exporter) have no use for it, so it must not be in their environment
 * where a crash dump or a debug `env` would print it. Names are matched case-insensitively (Windows).
 */
function childEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    const u = k.toUpperCase();
    if (u === 'WABOO_RUNNER_TOKEN' || u === 'WABOO_RUNNER_URL' || u === 'WABOO_RUNNER_NAME')
      continue;
    out[k] = v;
  }
  return out;
}

/** `node pipeline.cjs --client c --db d --mode m`: an args array, never a shell string. */
function pipelineArgs(job) {
  return [PIPELINE, '--client', job.sourceClient, '--db', job.sourceDb, '--mode', job.mode];
}

/** The agent's name: WABOO_RUNNER_NAME, else the machine name, cut to what the API accepts. */
function runnerName(env) {
  const raw = (env.WABOO_RUNNER_NAME || os.hostname() || 'runner')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 64);
  return NAME_RE.test(raw) ? raw : 'runner';
}

/** The last `max` characters. */
const tail = (s, max) => (s.length > max ? s.slice(s.length - max) : s);

/**
 * Cuts the pending stdout lines into reports the API accepts: at most MAX_LINES lines and MAX_REPORT_BYTES bytes each, and a line longer
 * than MAX_LINE is dropped (it is not a pipeline event; the API would refuse the whole report for it).
 */
function batches(lines) {
  const out = [];
  let cur = [];
  let bytes = 0;
  for (const l of lines) {
    if (l.length === 0 || l.length > MAX_LINE) continue;
    const b = Buffer.byteLength(l, 'utf8');
    if (cur.length >= MAX_LINES || bytes + b > MAX_REPORT_BYTES) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(l);
    bytes += b;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** Stops the pipeline and everything it started (cycle.cjs, ssh, the exporter). `child.kill()` alone leaves the grandchildren on Windows. */
function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, 10_000).unref();
  }
}

class Api {
  constructor(url, token, name) {
    this.base = url.replace(/\/+$/, '') + BASE;
    this.token = token;
    this.name = name;
  }
  async post(p, body) {
    const res = await fetch(this.base + p, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ runner: this.name, ...body }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401)
      throw Object.assign(
        new Error(
          'the API refused the runner token (WABOO_RUNNER_TOKEN differs, or is unset, on the API)',
        ),
        { fatal: true },
      );
    if (!res.ok) throw new Error(`the API answered ${res.status} for ${p}`);
    return res.json();
  }
  claim() {
    return this.post('/claim', {});
  }
  report(runId, lines, stderrTail) {
    return this.post(`/jobs/${runId}/report`, { lines, stderrTail });
  }
  finish(runId, exitCode, timedOut, stderrTail) {
    return this.post(`/jobs/${runId}/finish`, { exitCode, timedOut, stderrTail });
  }
}

const log = (m) => process.stderr.write(`[runner ${new Date().toISOString()}] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The pipeline of the job in progress, so a Ctrl+C can stop it (null while idle). */
let active = null;
let stopping = false;

/**
 * Runs one job's pipeline, reporting as it goes. Resolves when the pipeline has ended and the API has been told (or could not be).
 * Rejects only for a refused token, after the pipeline has been stopped.
 */
async function runJob(api, job, opts) {
  const flushMs = 3000;
  const heartbeatMs = 15_000;
  // the API marks a job abandoned after 5 silent minutes: once it has, nothing this machine does can reach the run, so stop the pipeline
  const unreachableMs = 6 * 60_000;

  const child = spawn(process.execPath, pipelineArgs(job), {
    cwd: HERE,
    env: childEnv(process.env),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32', // its own process group, so killTree reaches every child
  });

  let pending = [];
  let partial = '';
  let stderr = '';
  let timedOut = false;
  let stoppedByUs = false;
  let lastOk = Date.now();
  let lastSent = 0;
  let exitCode = null;
  let done = false;

  child.stdout.on('data', (d) => {
    partial += d.toString('utf8');
    const parts = partial.split('\n');
    partial = parts.pop();
    for (const l of parts) pending.push(l.trim());
  });
  child.stderr.on('data', (d) => {
    stderr = tail(stderr + d.toString('utf8'), 4096);
  });
  child.on('error', (e) => {
    stderr = tail(stderr + `could not start the pipeline: ${e.message}\n`, 4096);
    done = true;
  });
  child.on('close', (code) => {
    exitCode = code;
    done = true;
  });

  const stop = (why) => {
    if (stoppedByUs) return;
    stoppedByUs = true;
    log(`stopping the pipeline: ${why}`);
    killTree(child);
  };
  active = { stop };
  const timer = setTimeout(() => {
    timedOut = true;
    stop('the time limit passed');
  }, opts.timeoutMs);

  const flush = async (force) => {
    if (pending.length === 0 && !force && Date.now() - lastSent < heartbeatMs) return;
    const parts = batches(pending);
    pending = [];
    if (parts.length === 0) parts.push([]);
    let sent = 0;
    try {
      let answer = { cancel: false };
      for (const part of parts) {
        answer = await api.report(job.runId, part, stderr);
        sent++; // an acknowledged report is never sent again
      }
      lastOk = Date.now();
      lastSent = lastOk;
      if (answer.cancel) stop('the panel gave up on this run');
    } catch (e) {
      if (e.fatal) throw e;
      pending = parts.slice(sent).flat().concat(pending); // only what the API has not acknowledged goes again
      log(`could not report: ${e.message}`);
      if (Date.now() - lastOk > unreachableMs)
        stop(
          'the API has been unreachable for 6 minutes, so the panel has already given up on this run',
        );
    }
  };

  try {
    while (!done) {
      await sleep(flushMs);
      await flush(false);
    }
    if (partial.trim()) pending.push(partial.trim());
    // the last lines carry the report: a transient failure here must not lose them, so retry before telling the API the job ended
    for (let tries = 0; tries < 6; tries++) {
      await flush(true);
      if (pending.length === 0) break;
      await sleep(5000);
    }
  } catch (e) {
    stop('the API refused this agent');
    throw e;
  } finally {
    clearTimeout(timer);
    active = null;
  }
  try {
    await api.finish(
      job.runId,
      exitCode === null ? null : Math.max(-1, Math.min(255, exitCode)),
      timedOut,
      stderr,
    );
    log(
      `job ${job.runId} finished (exit ${exitCode}${timedOut ? ', timed out' : ''}${stoppedByUs ? ', stopped' : ''})`,
    );
  } catch (e) {
    log(`could not report the end of the job: ${e.message} (the panel will mark the run failed)`);
  }
}

async function main(argv, env) {
  const url = env.WABOO_RUNNER_URL;
  const token = env.WABOO_RUNNER_TOKEN;
  if (!url || !/^https?:\/\/[^/\s]+/i.test(url))
    throw new Error('WABOO_RUNNER_URL must be the WaDesk address, e.g. https://desk.wabo.ai');
  if (!token || token.length < MIN_TOKEN)
    throw new Error(
      `WABOO_RUNNER_TOKEN must be set (${MIN_TOKEN}+ characters, the same value as on the API)`,
    );
  const once = argv.includes('--once');
  const api = new Api(url, token, runnerName(env));
  const mins = Number(env.WABOO_MIGRATE_TIMEOUT_MIN);
  const timeoutMs = (Number.isFinite(mins) && mins > 0 ? mins : 90) * 60_000;
  const onSignal = () => {
    stopping = true;
    if (active) active.stop('this agent was asked to stop');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  log(`runner "${api.name}" started; asking ${url} for work every 5 seconds`);
  let warned = false;
  while (!stopping) {
    let job = null;
    try {
      const a = await api.claim();
      job = a && a.job ? validJob(a.job) : null;
      if (a && a.job && !job)
        log(
          'the API handed out a job with values this agent refuses; ignoring it (the panel will time it out)',
        );
      warned = false;
    } catch (e) {
      if (e.fatal) throw e;
      if (!warned) log(`cannot reach the API: ${e.message}; retrying`);
      warned = true;
    }
    if (job) {
      log(`job ${job.runId}: ${job.mode} of ${job.sourceDb}`);
      await runJob(api, job, { timeoutMs });
      if (once) return;
      continue;
    }
    await sleep(5000);
  }
  log('stopped');
}

module.exports = {
  childEnv,
  validJob,
  pipelineArgs,
  runnerName,
  batches,
  tail,
  MAX_LINES,
  MAX_LINE,
  MAX_REPORT_BYTES,
};

if (require.main === module) {
  main(process.argv.slice(2), process.env).catch((e) => {
    process.stderr.write(`runner agent stopped: ${e.message}\n`);
    process.exit(1);
  });
}
