#!/usr/bin/env node
/**
 * Security fuzz runner (QA sheet 3, item 38). Runs the seeded fuzz suite in apps/api/test/fuzz and reports.
 *
 *   node tools/quality/fuzz.mjs                          the full profile (>= 1,000,000 inputs) plus the HTTP layer
 *   node tools/quality/fuzz.mjs --profile ci --no-http   the small profile that `pnpm test` also runs
 *   node tools/quality/fuzz.mjs --seed 123456            replay a run (same seed, same inputs)
 *   node tools/quality/fuzz.mjs --seed 123456 --target 'schema:analyticsDaysSchema' --iter 2     replay ONE input
 *
 * Options: --profile smoke|ci|full  --seed N  --shards N  --total N  --http-requests N  --no-http  --stall-ms N  --out FILE
 * Exit code 1 on any failure, hang, crashed shard, or (full profile) fewer than 1,000,000 inputs executed.
 *
 * The inputs are a pure function of (seed, target, iteration), so shards split by target and the result does not depend on how many
 * there are. The HTTP phase needs Docker (the e2e harness starts its own throwaway Postgres and Redis and removes them).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const api = join(root, 'apps/api');
const SHEET_TARGET = 1_000_000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const profile = opt('profile', 'full');
const seed =
  opt('seed') !== undefined
    ? Number(opt('seed')) >>> 0
    : Math.floor(Math.random() * 0xffffffff) >>> 0;
const replayTarget = opt('target');
const replayIter = opt('iter');
const shards = replayTarget ? 1 : Math.max(1, Number(opt('shards', Math.min(4, cpus().length))));
const stallMs = Number(opt('stall-ms', 120_000));
const withHttp = !flag('no-http') && !replayTarget && profile === 'full';
const httpRequests = opt('http-requests', '9000');
const work = join(tmpdir(), `fuzz-${seed}-${Date.now()}`);
mkdirSync(work, { recursive: true });

console.log(
  `FUZZ seed=${seed} profile=${profile} shards=${shards} http=${withHttp ? httpRequests : 'off'}`,
);
console.log(`replay: node tools/quality/fuzz.mjs --seed ${seed} --profile ${profile}`);

const vitest = join(api, 'node_modules/.bin/vitest');
if (!existsSync(vitest)) {
  console.error(
    'vitest is not installed: run `pnpm install` and build the workspace packages first',
  );
  process.exit(2);
}

/** Runs one vitest process; resolves with its exit code and the tail of its output. A stalled progress file kills it. */
function runVitest(file, env, progressFile, label) {
  return new Promise((done) => {
    const child = spawn(vitest, ['run', file], {
      cwd: api,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const keep = (b) => {
      tail = (tail + b.toString()).slice(-6000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let hung = null;
    const timer = progressFile
      ? setInterval(() => {
          try {
            if (Date.now() - statSync(progressFile).mtimeMs > stallMs) {
              const [idx, name, iter] = readFileSync(progressFile, 'utf8').trim().split('|');
              hung = { target: name, iterNear: Number(iter), idx };
              child.kill('SIGKILL');
            }
          } catch {
            // the file does not exist yet
          }
        }, 5000)
      : null;
    child.on('exit', (code) => {
      if (timer) clearInterval(timer);
      done({ label, code, tail, hung });
    });
  });
}

const started = Date.now();
const jobs = [];
const reports = [];
for (let k = 0; k < shards; k += 1) {
  const report = join(work, `shard-${k}.json`);
  reports.push(report);
  jobs.push(
    runVitest(
      'test/fuzz/fuzz.spec.ts',
      {
        FUZZ_SEED: String(seed),
        FUZZ_PROFILE: profile,
        FUZZ_SHARD: `${k}/${shards}`,
        FUZZ_REPORT: report,
        FUZZ_PROGRESS: join(work, `progress-${k}.txt`),
        ...(opt('total') ? { FUZZ_TOTAL: opt('total') } : {}),
        ...(replayTarget ? { FUZZ_TARGET: replayTarget } : {}),
        ...(replayIter !== undefined ? { FUZZ_ITER: replayIter } : {}),
      },
      join(work, `progress-${k}.txt`),
      `shard ${k + 1}/${shards}`,
    ),
  );
}
const httpReport = join(work, 'http.json');
if (withHttp) {
  jobs.push(
    runVitest(
      'test/fuzz/http.fuzz.spec.ts',
      {
        FUZZ_SEED: String(seed),
        FUZZ_HTTP_REQUESTS: httpRequests,
        FUZZ_HTTP_REPORT: httpReport,
        TESTCONTAINERS_RYUK_DISABLED: 'true',
      },
      null,
      'http',
    ),
  );
}

const results = await Promise.all(jobs);
const wall = (Date.now() - started) / 1000;

let executed = 0;
const failures = [];
const problems = [];
const perGroup = {};
let slowest = [];
for (const [k, file] of reports.entries()) {
  const res = results[k];
  if (res.hung)
    problems.push(
      `${res.label} HUNG near ${res.hung.target} iteration ${res.hung.iterNear} (no progress for ${stallMs / 1000}s). Replay: node tools/quality/fuzz.mjs --seed ${seed} --target '${res.hung.target}' --iter ${res.hung.iterNear} (scan the 128 iterations after it)`,
    );
  if (!existsSync(file)) {
    if (!res.hung)
      problems.push(
        `${res.label} produced no report (exit ${res.code}). Output tail:\n${res.tail}`,
      );
    continue;
  }
  const r = JSON.parse(readFileSync(file, 'utf8'));
  executed += r.executed;
  failures.push(...r.failures);
  slowest = slowest.concat(r.slowest);
  for (const [g, v] of Object.entries(r.perGroup)) {
    perGroup[g] ??= { targets: 0, inputs: 0 };
    perGroup[g].targets += v.targets;
    perGroup[g].inputs += v.inputs;
  }
}
slowest.sort((a, b) => b.ms - a.ms);

let http = null;
if (withHttp) {
  const res = results[results.length - 1];
  if (existsSync(httpReport)) {
    http = JSON.parse(readFileSync(httpReport, 'utf8'));
  } else {
    problems.push(
      `http phase produced no report (exit ${res.code}); Docker needed. Output tail:\n${res.tail}`,
    );
  }
}

console.log('\n==== fuzz result ====');
console.log(`seed ${seed}   profile ${profile}   shards ${shards}`);
console.log(
  `pure inputs executed: ${executed.toLocaleString('en-US')}   wall time ${wall.toFixed(1)} s   throughput ${Math.round(executed / wall).toLocaleString('en-US')} inputs/s (all shards, HTTP phase included in the wall time)`,
);
for (const [g, v] of Object.entries(perGroup))
  console.log(
    `  ${g.padEnd(18)} ${String(v.targets).padStart(5)} targets ${v.inputs.toLocaleString('en-US').padStart(12)} inputs`,
  );
if (http) {
  console.log(
    `http requests sent: ${http.sent} on ${http.routes} routes in ${(http.durationMs / 1000).toFixed(1)} s   statuses ${JSON.stringify(http.statuses)}   egress attempts blocked: ${JSON.stringify(http.egressBlocked)}`,
  );
}
const total = executed + (http?.sent ?? 0);
console.log(`TOTAL inputs executed: ${total.toLocaleString('en-US')}`);
if (slowest.length > 0)
  console.log(
    `slowest single inputs: ${slowest
      .slice(0, 3)
      .map((s) => `${s.target}#${s.iter} ${s.ms}ms`)
      .join(', ')}`,
  );

for (const f of failures) {
  console.log(
    `\nFAIL ${f.target} [${f.kind}] x${f.count}: ${f.message}\n  input:   ${f.input}\n  minimal: ${f.minimal ?? '(not shrunk)'}\n  replay:  ${f.replay}`,
  );
}
for (const f of http?.failures ?? []) {
  console.log(
    `\nFAIL (http) ${f.route} [${f.kind} ${f.status}] x${f.count}: ${f.detail}\n  request: ${f.request}\n  replay:  node tools/quality/fuzz.mjs --seed ${seed} (request #${f.iter})`,
  );
}
for (const p of problems) console.log(`\nPROBLEM ${p}`);

const short = profile === 'full' && executed < SHEET_TARGET;
if (short)
  problems.push(
    `only ${executed} pure inputs executed; the full profile must reach ${SHEET_TARGET}`,
  );
console.log(
  `\nsheet target (>= ${SHEET_TARGET.toLocaleString('en-US')} inputs per run): ${profile === 'full' ? (executed >= SHEET_TARGET ? 'MET' : 'NOT MET') : 'not checked (profile is not full)'}`,
);

const out = opt('out');
const summary = {
  seed,
  profile,
  shards,
  executed,
  httpSent: http?.sent ?? 0,
  total,
  wallSeconds: wall,
  failures,
  httpFailures: http?.failures ?? [],
  problems,
  perGroup,
};
if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(
  failures.length + (http?.failures.length ?? 0) + problems.length === 0
    ? '\nFUZZ PASSED'
    : '\nFUZZ FAILED',
);
process.exit(failures.length + (http?.failures.length ?? 0) + problems.length === 0 ? 0 : 1);
