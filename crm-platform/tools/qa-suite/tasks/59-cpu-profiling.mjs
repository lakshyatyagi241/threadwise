// #59 CPU profiling: latency baseline (p50/p95/p99) per endpoint with a regression budget, and an optional V8 CPU profile of the API under that load.
import { ROOT, env, fail, http, login, pass, requireLocal, skip, warn } from '../lib/core.mjs';
import { fmt, stage } from '../lib/load.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = join(ROOT, 'tools/qa-suite/data/perf-baseline.json');
const BUDGET = Number(process.env.QA_PERF_BUDGET ?? 0.2); // p95 may grow 20% over the baseline
const RPS = Number(process.env.QA_PROFILE_RPS ?? 20),
  SECONDS = Number(process.env.QA_PROFILE_SEC ?? 20);

/** Aggregates self time per function from a .cpuprofile (V8 format). Pure. */
export function topSelfTime(profile, n = 15) {
  const dt = profile.timeDeltas,
    self = new Map(),
    byId = new Map(profile.nodes.map((x) => [x.id, x]));
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
  const agg = new Map();
  for (const [id, us] of self) {
    const f = byId.get(id).callFrame,
      k = `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*node_modules\//, 'node_modules/').replace(/^file:\/\//, '')}:${f.lineNumber + 1}`;
    agg.set(k, (agg.get(k) ?? 0) + us);
  }
  const total = [...agg.values()].reduce((a, b) => a + b, 0) || 1;
  return [...agg]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, us]) => `${((us / total) * 100).toFixed(1)}%  ${(us / 1000).toFixed(0)}ms  ${k}`);
}

export default {
  id: 59,
  priority: 'P2',
  name: 'CPU profiling',
  owner: 'Punya',
  target: 'Baseline + p50/p95/p99 + regression budget stored as CI artifact',
  async run({ args }) {
    const bad = requireLocal(env.api);
    const spawnIdx = args.indexOf('--spawn');
    if (bad && spawnIdx < 0)
      return {
        checks: [skip('perf', 'Latency baseline and CPU profile', bad)],
        metrics: {},
        target: {
          met: null,
          text: 'Start the API (or pass --spawn "<start command>") and set API_URL=http://localhost:3000.',
        },
      };
    let child = null;
    const profDir = join(ROOT, 'reports/qa-suite/cpuprofile');
    if (spawnIdx >= 0) {
      mkdirSync(profDir, { recursive: true });
      child = spawn(args[spawnIdx + 1], {
        shell: true,
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --cpu-prof --cpu-prof-dir=${profDir}`,
        },
        stdio: 'ignore',
        detached: true,
      });
      for (let i = 0; i < 60 && (await http('GET', '/health')).status !== 200; i++)
        await new Promise((r) => setTimeout(r, 1000));
    }
    const s = await login();
    const targets = [
      ['GET /health', { method: 'GET', path: '/health' }],
      ['GET /v2/auth/registration-config', { method: 'GET', path: '/v2/auth/registration-config' }],
      ...(s.token
        ? [
            ['GET /v2/auth/session', { method: 'GET', path: '/v2/auth/session', token: s.token }],
            [
              'GET /v2/contacts?limit=20',
              { method: 'GET', path: '/v2/contacts?limit=20', token: s.token },
            ],
          ]
        : []),
    ];
    const now = {};
    const checks = [];
    for (const [name, req] of targets) {
      const r = await stage({ rps: RPS, seconds: SECONDS, build: () => req });
      now[name] = { p50: r.p50, p95: r.p95, p99: r.p99, errorRate: r.errorRate, rps: r.actualRps };
    }
    const saved = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
    if (args.includes('--save-baseline')) {
      writeFileSync(
        BASELINE,
        JSON.stringify(
          {
            savedAt: new Date().toISOString(),
            rps: RPS,
            seconds: SECONDS,
            budget: BUDGET,
            endpoints: now,
          },
          null,
          2,
        ) + '\n',
      );
      checks.push(pass('perf-saved', 'Baseline saved to tools/qa-suite/data/perf-baseline.json'));
    }
    if (!saved && !args.includes('--save-baseline'))
      checks.push(
        warn(
          'perf-baseline',
          'A baseline exists to compare against',
          'Run once with --save-baseline on a known-good build and commit the file.',
        ),
      );
    for (const [name, v] of Object.entries(now)) {
      const b = saved?.endpoints?.[name];
      checks.push(
        v.errorRate > 0.01
          ? fail(
              `perf-err-${name}`,
              `${name}: errors under load`,
              `${(v.errorRate * 100).toFixed(1)}%`,
              [],
              'high',
            )
          : b
            ? v.p95 <= b.p95 * (1 + BUDGET) + 5
              ? pass(
                  `perf-${name}`,
                  `${name}: p95 ${fmt(v.p95)} within budget (baseline ${fmt(b.p95)} +${BUDGET * 100}%)`,
                  `p50 ${fmt(v.p50)} p99 ${fmt(v.p99)}`,
                )
              : fail(
                  `perf-${name}`,
                  `${name}: p95 regressed`,
                  `${fmt(v.p95)} vs baseline ${fmt(b.p95)} (+${Math.round((v.p95 / b.p95 - 1) * 100)}%, budget ${BUDGET * 100}%)`,
                  [],
                  'high',
                )
            : pass(
                `perf-${name}`,
                `${name}: p50 ${fmt(v.p50)} p95 ${fmt(v.p95)} p99 ${fmt(v.p99)}`,
                'no baseline to compare',
              ),
      );
    }
    mkdirSync(join(ROOT, 'reports/qa-suite'), { recursive: true });
    writeFileSync(
      join(ROOT, 'reports/qa-suite/perf-latest.json'),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          rps: RPS,
          seconds: SECONDS,
          budget: BUDGET,
          endpoints: now,
        },
        null,
        2,
      ),
    );
    checks.push(
      pass(
        'perf-artifact',
        'Run stored as reports/qa-suite/perf-latest.json (upload as the CI artifact)',
      ),
    );

    if (child) {
      process.kill(-child.pid, 'SIGINT');
      await new Promise((r) => setTimeout(r, 4000)); // V8 writes the profile on a clean exit
      const f = existsSync(profDir)
        ? readdirSync(profDir)
            .filter((x) => x.endsWith('.cpuprofile'))
            .sort()
            .pop()
        : null;
      if (f)
        checks.push({
          id: 'perf-cpuprofile',
          title: `CPU profile captured (${f}): top self-time functions`,
          status: 'pass',
          detail: 'Open the file in Chrome DevTools > Performance, or speedscope.app',
          evidence: topSelfTime(JSON.parse(readFileSync(join(profDir, f), 'utf8'))),
        });
      else
        checks.push(
          fail(
            'perf-cpuprofile',
            'CPU profile captured',
            'the API exited without writing a .cpuprofile: it must exit cleanly on SIGINT',
            [],
            'medium',
          ),
        );
    } else
      checks.push(
        skip(
          'perf-cpuprofile',
          'V8 CPU profile of the API under load',
          'pass --spawn "<command that starts the API>" (it is started with --cpu-prof and stopped cleanly)',
        ),
      );
    return {
      checks,
      metrics: Object.fromEntries(Object.entries(now).map(([k, v]) => [`p95 ${k}`, fmt(v.p95)])),
      target: {
        met: saved ? checks.every((c) => c.status !== 'fail') : null,
        text: saved ? `Compared with the baseline of ${saved.savedAt}.` : 'No baseline yet.',
      },
    };
  },
};
