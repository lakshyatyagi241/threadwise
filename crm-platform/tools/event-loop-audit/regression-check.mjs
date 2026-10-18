#!/usr/bin/env node
// Event-loop regression gate (EL-B06, rule 1 of the standard): compares one load run against a baseline recorded on the SAME kind of
// machine, with the allowed drift taken from the spread between the recorded runs. It reads the output of
// tools/event-loop-audit/load/run-load.mjs (reports/event-loop/load-baseline.json); it starts nothing itself.
//
//   # once per machine class (the CI runner): three separate boots, then keep the file in the repo
//   for i in 1 2 3; do node tools/event-loop-audit/load/run-load.mjs --profiles=normal --seconds=90 --contacts=300 \
//        --settle-seconds=20 && cp reports/event-loop/load-baseline.json /tmp/run$i.json; done
//   node tools/event-loop-audit/regression-check.mjs --record --out=docs/performance/event-loop/ci-baseline.json /tmp/run1.json /tmp/run2.json /tmp/run3.json
//
//   # every check
//   node tools/event-loop-audit/load/run-load.mjs --profiles=normal --seconds=90 --contacts=300 --settle-seconds=20
//   node tools/event-loop-audit/regression-check.mjs --baseline=docs/performance/event-loop/ci-baseline.json reports/event-loop/load-baseline.json
//
//   node tools/event-loop-audit/regression-check.mjs --self-test      # no Docker: the rules against made-up runs
//
// Exit codes: 0 no regression found; 1 a regression (a metric above what the baseline allows); 2 the gate cannot decide (no baseline,
// a baseline from another kind of machine, a baseline too noisy to see a 300 ms block, an aborted run, or a failure on a host whose
// round trips are far from the baseline's, which may be the host and not the code). A 2 is never a pass.
//
// What it compares (profile `normal`, the API process):
//   apiLoopP99Ms           median over the reporting windows of the loop delay p99          sustained slowness
//   apiLoopMaxMs           median over the windows of the single worst delay                a typical window's worst stall
//   apiWindowsOver250Share share of windows whose worst delay passed 250 ms                 blocks, however rare per window
//   callerP95Ms            the load generator's own p95 for all routes                      what a caller sees; host-bound, see below
// Rule: allowed = median(baseline) + max(2 x (max - min of the baseline), relative floor x median, absolute floor). The spread term is
// the "tolerance from run-to-run spread"; the floors stop a baseline that happened to be tight from failing on the next ordinary run.
// callerP95Ms depends on how fast the host reaches Postgres and Redis (calibration swung 0.5 to 80 ms between runs of one laptop), so it
// is only judged when the run's round-trip calibration is close to the baseline's; otherwise it is reported as INCONCLUSIVE.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROFILE = 'normal';
export const MIN_RUNS = 3;
/** Smallest block the gate promises to see. A baseline whose allowance for the worst-delay metric is above this cannot gate it. */
export const DETECTS_BLOCK_MS = 300;

/** Per metric: how to read it from a run, its unit, the floors of the rule, and whether it depends on the host's round trips. */
export const METRICS = {
  apiLoopP99Ms: {
    unit: 'ms',
    read: (p) => p.api?.loopDelayMs?.p99?.median,
    rel: 0.5,
    abs: 20,
  },
  apiLoopMaxMs: {
    unit: 'ms',
    read: (p) => p.api?.loopDelayMs?.max?.median,
    rel: 1.0,
    abs: 60,
    mustSeeBlock: true,
  },
  apiWindowsOver250Share: {
    unit: 'share',
    read: (p) => p.api?.loopDelayMaxOverShare?.over250ms,
    rel: 0,
    abs: 0.15,
  },
  callerP95Ms: {
    unit: 'ms',
    read: (p) => p.client?.clientLatency?.p95Ms,
    rel: 1.0,
    abs: 150,
    hostBound: true,
  },
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? undefined : s[Math.floor(s.length / 2)];
};
const round = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);

/** The numbers a run contributes, or why it cannot be used. */
export function extract(run, profile = PROFILE) {
  if (!run || typeof run !== 'object') return { problem: 'not a load-baseline.json' };
  if (run.aborted) return { problem: `the run aborted: ${run.aborted}` };
  const p = run.profiles?.[profile];
  if (!p) return { problem: `no ${profile} profile in the run` };
  if (p.k6ExitCode !== undefined && p.k6ExitCode !== 0 && p.k6ExitCode !== 99)
    return { problem: `k6 exited ${p.k6ExitCode}` };
  const values = {};
  for (const [name, m] of Object.entries(METRICS)) {
    const v = m.read(p);
    if (Number.isFinite(v)) values[name] = v;
  }
  for (const name of Object.keys(METRICS)) {
    if (!METRICS[name].hostBound && values[name] === undefined)
      return { problem: `the run has no ${name} (an older run-load.mjs output?)` };
  }
  const cal = run.calibrationBefore ?? {};
  return {
    values,
    calibration: {
      pgP50: cal.postgresSelect1Ms?.p50,
      pgP99: cal.postgresSelect1Ms?.p99,
      redisP50: cal.redisPingMs?.p50,
      redisP99: cal.redisPingMs?.p99,
    },
    injected: run.environment?.injectedBlock,
    fingerprint: fingerprintOf(run),
    commit: run.environment?.commit,
  };
}

/** What has to match for two runs to be comparable at all. The CPU model is recorded but not required: runner pools mix them. */
export function fingerprintOf(run) {
  const e = run.environment ?? {};
  const node = /^v?(\d+)/.exec(e.node ?? '')?.[1];
  const cores = /(\d+) logical cores/.exec(e.cpu ?? '')?.[1];
  return {
    os: String(e.os ?? '').split(' ')[0],
    nodeMajor: node,
    cores: cores ? Number(cores) : undefined,
    cpu: e.cpu,
  };
}

/** Builds the baseline file from >= 3 separate runs. Throws with the reason when it should not be recorded. */
export function buildBaseline(runs, { profile = PROFILE, now = new Date() } = {}) {
  if (runs.length < MIN_RUNS) throw new Error(`need at least ${MIN_RUNS} runs, got ${runs.length}`);
  const parts = runs.map((r, i) => {
    const x = extract(r, profile);
    if (x.problem) throw new Error(`run ${i + 1}: ${x.problem}`);
    if (x.injected)
      throw new Error(`run ${i + 1} had a block injected: never record that as a baseline`);
    return x;
  });
  const fp0 = JSON.stringify({ ...parts[0].fingerprint, cpu: undefined });
  parts.forEach((x, i) => {
    if (JSON.stringify({ ...x.fingerprint, cpu: undefined }) !== fp0)
      throw new Error(`run ${i + 1} came from a different kind of machine than run 1`);
  });
  const metrics = {};
  for (const name of Object.keys(METRICS)) {
    const values = parts.map((x) => x.values[name]).filter((v) => Number.isFinite(v));
    if (values.length >= MIN_RUNS) metrics[name] = { values: values.map(round) };
  }
  return {
    schema: 1,
    recordedAt: now.toISOString(),
    profile,
    fingerprint: parts[0].fingerprint,
    commits: parts.map((x) => x.commit),
    runs: parts.length,
    metrics,
    calibration: parts.map((x) => x.calibration),
    rule: 'allowed = median + max(2 x (max - min), relative floor x median, absolute floor); floors in tools/event-loop-audit/regression-check.mjs',
    note: 'Valid only for runs on the same kind of machine (os, node major, logical cores). Separate boots, so the spread includes start-up differences but not days of drift.',
  };
}

/** The allowance for one metric from the recorded values. */
export function allowance(name, values) {
  const m = METRICS[name];
  const c = median(values);
  const spread = Math.max(...values) - Math.min(...values);
  const allowed = c + Math.max(2 * spread, m.rel * c, m.abs);
  return { center: c, spread, allowed };
}

function comparableRoundTrips(base, run) {
  // Same order of magnitude of host-to-container round trips as when the baseline was recorded.
  const reasons = [];
  for (const [k, label] of [
    ['pgP50', 'Postgres SELECT 1 p50'],
    ['redisP50', 'Redis PING p50'],
  ]) {
    const b = base.calibration.map((c) => c[k]).filter(Number.isFinite);
    const v = run.calibration[k];
    if (b.length === 0 || !Number.isFinite(v)) {
      reasons.push(`${label} missing`);
      continue;
    }
    if (v > Math.max(...b) * 2 + 1 || v < Math.min(...b) / 2 - 1)
      reasons.push(
        `${label} ${v} ms against ${Math.min(...b)} to ${Math.max(...b)} ms when recorded`,
      );
  }
  return reasons;
}

/**
 * Compares a run with a baseline file. Returns { exit, verdict, lines, metrics }. `exit` is 0, 1 or 2 (see the header).
 */
export function compare(baseline, run, { profile = PROFILE } = {}) {
  const lines = [];
  const say = (s) => lines.push(s);
  const stop = (why) => ({
    exit: 2,
    verdict: 'CANNOT DECIDE',
    reason: why,
    lines: [...lines, `CANNOT DECIDE: ${why}`],
    metrics: {},
  });
  if (!baseline || baseline.schema !== 1)
    return stop('no usable baseline file for this machine class (record one, see the header)');
  if (baseline.profile !== profile)
    return stop(`the baseline is for profile ${baseline.profile}, the check asked for ${profile}`);
  const x = extract(run, profile);
  if (x.problem) return stop(x.problem);
  for (const k of ['os', 'nodeMajor', 'cores']) {
    if (baseline.fingerprint?.[k] !== x.fingerprint[k])
      return stop(
        `the baseline came from a different kind of machine (${k}: ${baseline.fingerprint?.[k]} against ${x.fingerprint[k]}); record a baseline here`,
      );
  }
  const results = {};
  let failed = false;
  let blind = false;
  for (const [name, m] of Object.entries(METRICS)) {
    const rec = baseline.metrics[name];
    const value = x.values[name];
    if (!rec || value === undefined) {
      if (m.hostBound) {
        results[name] = { status: 'INCONCLUSIVE', why: 'no value to compare' };
        say(`INCONCLUSIVE  ${name}: no value to compare`);
        continue;
      }
      return stop(`${name} is missing from the baseline or the run`);
    }
    const a = allowance(name, rec.values);
    const u = m.unit === 'share' ? '' : ` ${m.unit}`;
    const detail = `baseline median ${round(a.center)}${u}, spread ${round(a.spread)}${u}, allowed up to ${round(a.allowed)}${u}`;
    if (m.mustSeeBlock && a.allowed >= DETECTS_BLOCK_MS) {
      blind = true;
      say(
        `BLIND         ${name}: the baseline is so noisy that it allows ${round(a.allowed)} ms, which hides a ${DETECTS_BLOCK_MS} ms block (${detail})`,
      );
    }
    if (m.hostBound) {
      // A baseline whose own runs disagree by more than their median says nothing: an allowance that wide (seen: 11.8 s for a p95
      // that was 0.8 to 6.1 s across three runs) would pass anything. Not judged, and said so.
      if (a.spread > a.center) {
        results[name] = {
          status: 'INCONCLUSIVE',
          value,
          allowed: a.allowed,
          why: 'baseline spread wider than its median',
        };
        say(
          `INCONCLUSIVE  ${name} ${round(value)}${u}: not judged, the recorded runs disagree by more than their median (${detail})`,
        );
        continue;
      }
      const why = comparableRoundTrips(baseline, x);
      if (why.length) {
        results[name] = { status: 'INCONCLUSIVE', value, allowed: a.allowed, why: why.join('; ') };
        say(
          `INCONCLUSIVE  ${name} ${round(value)}${u}: not comparable, host round trips differ (${why.join('; ')})`,
        );
        continue;
      }
    }
    const over = value > a.allowed;
    if (over) failed = true;
    results[name] = { status: over ? 'FAIL' : 'PASS', value, ...a };
    say(`${over ? 'FAIL         ' : 'PASS         '} ${name} ${round(value)}${u} (${detail})`);
  }
  if (failed) {
    // A starved host (CPU taken by other work, slow container forwarding) lifts the loop numbers by itself: a run on a machine whose
    // round trips are far from the baseline's cannot say whether the code or the host got slower. Never a pass, never a blame.
    const hostWhy = comparableRoundTrips(baseline, x);
    if (hostWhy.length)
      return {
        ...stop(
          `a metric is above its allowance, but this host's round trips differ from the baseline's (${hostWhy.join('; ')}), so it may be the host; run it again on a quiet machine`,
        ),
        metrics: results,
      };
    return {
      exit: 1,
      verdict: 'REGRESSION',
      lines: [...lines, 'REGRESSION: at least one metric is above what the baseline allows'],
      metrics: results,
    };
  }
  if (blind)
    return stop(
      `a baseline this noisy cannot see a ${DETECTS_BLOCK_MS} ms block; re-record it on a quieter runner`,
    );
  const open = Object.entries(results)
    .filter(([, r]) => r.status === 'INCONCLUSIVE')
    .map(([k]) => k);
  return {
    exit: 0,
    verdict: 'NO REGRESSION FOUND',
    lines: [
      ...lines,
      `NO REGRESSION FOUND${open.length ? ` (not judged: ${open.join(', ')})` : ''}`,
    ],
    metrics: results,
  };
}

// ---- self-test: the rules against made-up runs, no Docker ------------------------------------------------------------------------
function synthetic({
  p99 = 25,
  max = 35,
  over250 = 0.04,
  p95 = 480,
  rtt = 2,
  cores = 4,
  injected,
} = {}) {
  return {
    environment: {
      node: 'v22.17.0',
      os: 'linux 6.5',
      cpu: `x, ${cores} logical cores, 16 GB`,
      commit: 'abc',
      injectedBlock: injected,
    },
    calibrationBefore: {
      postgresSelect1Ms: { p50: rtt, p99: rtt * 3 },
      redisPingMs: { p50: rtt, p99: rtt * 3 },
    },
    profiles: {
      normal: {
        api: {
          loopDelayMs: { p99: { median: p99 }, max: { median: max } },
          loopDelayMaxOverShare: { over250ms: over250 },
        },
        client: { clientLatency: { p95Ms: p95 } },
      },
    },
  };
}
export function selfTest() {
  const out = [];
  let bad = 0;
  const t = (name, ok) => {
    if (!ok) bad += 1;
    out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  };
  const base = buildBaseline([
    synthetic({ p99: 24, max: 33 }),
    synthetic({ p99: 27, max: 38, over250: 0.06 }),
    synthetic({ p99: 25, max: 35 }),
  ]);
  t(
    'records a baseline from three runs',
    base.runs === 3 && base.metrics.apiLoopMaxMs.values.length === 3,
  );
  t(
    'the runs that made the baseline pass it',
    compare(base, synthetic({ p99: 25, max: 35 })).exit === 0,
  );
  t(
    'an ordinary run a little above the median passes',
    compare(base, synthetic({ p99: 33, max: 60, over250: 0.1, p95: 700 })).exit === 0,
  );
  const blocked = compare(base, synthetic({ p99: 30, max: 305, over250: 0.95 }));
  t(
    'FAILS on a 300 ms block in most windows (worst delay and share of windows)',
    blocked.exit === 1 &&
      blocked.metrics.apiLoopMaxMs.status === 'FAIL' &&
      blocked.metrics.apiWindowsOver250Share.status === 'FAIL',
  );
  t(
    'FAILS on sustained slowness (p99 tripled)',
    compare(base, synthetic({ p99: 90, max: 120 })).metrics.apiLoopP99Ms.status === 'FAIL',
  );
  const slowHost = compare(base, synthetic({ p95: 5000, rtt: 60 }));
  t(
    'a slow host makes the caller p95 inconclusive, not a failure and not a pass',
    slowHost.exit === 0 && slowHost.metrics.callerP95Ms.status === 'INCONCLUSIVE',
  );
  const starved = compare(base, synthetic({ max: 320, over250: 1, rtt: 120 }));
  t(
    'a failure on a host whose round trips are far from the baseline is exit 2 (it may be the host), not a regression',
    starved.exit === 2 && /may be the host/.test(starved.lines.join('\n')),
  );
  t(
    'the same failure on a comparable host is exit 1',
    compare(base, synthetic({ max: 320, over250: 1, rtt: 3 })).exit === 1,
  );
  t(
    'a slow caller p95 on a comparable host FAILS',
    compare(base, synthetic({ p95: 3000 })).metrics.callerP95Ms.status === 'FAIL',
  );
  const scattered = buildBaseline([
    synthetic({ p95: 6000 }),
    synthetic({ p95: 800 }),
    synthetic({ p95: 1200 }),
  ]);
  const sc = compare(scattered, synthetic({ p95: 9000 }));
  t(
    'a caller p95 whose recorded runs disagree by more than their median is not judged',
    sc.exit === 0 && sc.metrics.callerP95Ms.status === 'INCONCLUSIVE',
  );
  t('no baseline is exit 2, not a pass', compare(undefined, synthetic()).exit === 2);
  t(
    'a baseline from a machine with other cores is exit 2',
    compare(base, synthetic({ cores: 8 })).exit === 2,
  );
  t('an aborted run is exit 2', compare(base, { ...synthetic(), aborted: 'boom' }).exit === 2);
  t(
    'a run from an older run-load (no worst-delay share) is exit 2',
    compare(
      base,
      (() => {
        const r = synthetic();
        delete r.profiles.normal.api.loopDelayMaxOverShare;
        return r;
      })(),
    ).exit === 2,
  );
  const noisy = buildBaseline([
    synthetic({ max: 30 }),
    synthetic({ max: 200 }),
    synthetic({ max: 90 }),
  ]);
  t(
    'a baseline too noisy to see a 300 ms block is exit 2',
    compare(noisy, synthetic({ max: 40 })).exit === 2,
  );
  let refused = false;
  try {
    buildBaseline([synthetic(), synthetic(), synthetic({ injected: { ms: 300 } })]);
  } catch {
    refused = true;
  }
  t('refuses to record a run that had a block injected', refused);
  refused = false;
  try {
    buildBaseline([synthetic(), synthetic()]);
  } catch {
    refused = true;
  }
  t('refuses fewer than three runs', refused);
  refused = false;
  try {
    buildBaseline([synthetic(), synthetic(), synthetic({ cores: 8 })]);
  } catch {
    refused = true;
  }
  t('refuses runs from different kinds of machine', refused);
  return { bad, out };
}

// ---- CLI -------------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const files = args.filter((a) => !a.startsWith('--'));
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  if (args.includes('--self-test')) {
    const { bad, out } = selfTest();
    console.log(out.join('\n'));
    console.log(bad ? `\n${bad} self-test check(s) failed` : '\nall self-test checks passed');
    process.exit(bad ? 1 : 0);
  } else if (args.includes('--record')) {
    const outFile = opt('out');
    if (!outFile) {
      console.error('--record needs --out=<file> and the run files');
      process.exit(2);
    }
    try {
      const b = buildBaseline(files.map(read), { profile: opt('profile') ?? PROFILE });
      writeFileSync(outFile, `${JSON.stringify(b, null, 2)}\n`);
      console.log(`recorded ${b.runs} runs into ${outFile}`);
      for (const [n, m] of Object.entries(b.metrics)) {
        const a = allowance(n, m.values);
        console.log(`  ${n}: values ${m.values.join(', ')} -> allowed up to ${round(a.allowed)}`);
      }
    } catch (e) {
      console.error(`not recorded: ${e.message}`);
      process.exit(2);
    }
  } else {
    const baselineFile = opt('baseline');
    let baseline;
    try {
      baseline = baselineFile ? read(baselineFile) : undefined;
    } catch {
      baseline = undefined;
    }
    let run;
    try {
      run = files[0] ? read(files[0]) : undefined;
    } catch (e) {
      console.error(`cannot read the run: ${e.message}`);
      process.exit(2);
    }
    const r = compare(baseline, run, { profile: opt('profile') ?? PROFILE });
    console.log(r.lines.join('\n'));
    if (args.includes('--json')) console.log(JSON.stringify(r.metrics, null, 1));
    process.exit(r.exit);
  }
}
