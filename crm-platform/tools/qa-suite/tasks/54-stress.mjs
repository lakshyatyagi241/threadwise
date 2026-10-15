// #54 Stress testing: ramp load past the expected production peak until the controlled-degradation point is known, then check recovery. LOCAL targets only.
import { env, fail, login, pass, requireLocal, skip, warn, http } from '../lib/core.mjs';
import { fmt, stage } from '../lib/load.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/core.mjs';

const PEAK = Number(process.env.QA_PEAK_RPS ?? 20); // expected production peak (requests/second) for the mixed workload
const SECONDS = Number(process.env.QA_STAGE_SEC ?? 15);
const STEPS = (process.env.QA_STRESS_STEPS ?? '1,2,3,4,6,8').split(',').map(Number);
const P95_LIMIT = Number(process.env.QA_STRESS_P95_MS ?? 3000);
const ERR_LIMIT = Number(process.env.QA_STRESS_ERR ?? 0.02);

export default {
  id: 54,
  priority: 'P2',
  name: 'Stress testing',
  owner: 'Punya',
  target: '>=2x expected production peak until controlled degradation point is known',
  async run({ args }) {
    const bad = requireLocal(env.api);
    if (bad || !args.includes('--stress'))
      return {
        checks: [
          skip(
            'stress',
            'Ramp load to find the degradation point',
            bad ??
              'heavy by design: pass --stress (and set QA_PEAK_RPS to your expected production peak)',
          ),
        ],
        metrics: { 'peak rps assumed': PEAK },
        target: {
          met: null,
          text: 'Not run. Example: API_URL=http://localhost:3000 QA_EMAIL=... QA_PASSWORD=... QA_PEAK_RPS=30 pnpm qa 54 -- --stress',
        },
      };
    const s = await login();
    const mix = [
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/v2/auth/registration-config' },
      ...(s.token
        ? [
            { method: 'GET', path: '/v2/auth/session', token: s.token },
            { method: 'GET', path: '/v2/contacts?limit=20', token: s.token },
            { method: 'GET', path: '/v2/contacts?limit=20&search=a', token: s.token },
          ]
        : []),
    ];
    const build = (i) => mix[i % mix.length];
    const rows = [],
      checks = [];
    let degradedAt = null,
      crashedAt = null;
    for (const k of STEPS) {
      const r = await stage({ rps: PEAK * k, seconds: SECONDS, build });
      rows.push({ multiple: k, ...r });
      console.log(
        `    ${k}x (${PEAK * k} rps): p95 ${fmt(r.p95)}, ok ${r.ok}, shed ${r.shed}, errors ${r.bad}, dropped ${r.dropped}`,
      );
      if (r.errorRate > ERR_LIMIT || r.p95 > P95_LIMIT) {
        degradedAt = k;
        if (r.netErr / Math.max(r.sent, 1) > 0.5) crashedAt = k;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
    const recover = await stage({ rps: PEAK, seconds: Math.min(SECONDS, 10), build });
    const first = rows[0];
    const alive = (await http('GET', '/health')).status === 200;
    const reached = Math.max(
      ...rows.filter((r) => r.errorRate <= ERR_LIMIT && r.p95 <= P95_LIMIT).map((r) => r.multiple),
      0,
    );
    checks.push(
      reached >= 2
        ? pass(
            'stress-2x',
            `Sustained ${reached}x the expected peak (${PEAK * reached} rps) within p95 ${P95_LIMIT} ms and <${ERR_LIMIT * 100}% errors`,
          )
        : fail(
            'stress-2x',
            `Held only ${reached}x the expected peak`,
            `degraded at ${degradedAt ?? '?'}x. Target is 2x.`,
            [],
            'medium',
          ),
    );
    checks.push(
      degradedAt
        ? pass(
            'stress-point',
            `Degradation point found: ${degradedAt}x peak (${PEAK * degradedAt} rps)`,
          )
        : warn(
            'stress-point',
            'Degradation point not reached',
            `Held ${STEPS.at(-1)}x without degrading: raise QA_STRESS_STEPS to find the limit.`,
          ),
    );
    const lastBad = rows.at(-1);
    checks.push(
      lastBad.bad === 0 || lastBad.shed >= lastBad.bad
        ? pass(
            'stress-controlled',
            'Degradation is controlled: overload is answered with 429/503 (shedding), not 500s or dropped connections',
          )
        : fail(
            'stress-controlled',
            'Degradation is controlled',
            `at ${lastBad.multiple}x: ${lastBad.bad} errors (5xx other than 503, or network) vs ${lastBad.shed} shed. codes: ${JSON.stringify(lastBad.codes)}`,
            [],
            'high',
          ),
    );
    checks.push(
      crashedAt
        ? fail(
            'stress-crash',
            'The API did not crash or stop accepting connections',
            `>50% connection failures at ${crashedAt}x`,
          )
        : pass('stress-crash', 'The API kept accepting connections'),
    );
    checks.push(
      alive && recover.errorRate <= ERR_LIMIT && recover.p95 <= Math.max(first.p95 * 2, 500)
        ? pass(
            'stress-recovery',
            `Recovered after the ramp: p95 ${fmt(recover.p95)} at 1x (was ${fmt(first.p95)})`,
          )
        : fail(
            'stress-recovery',
            'Recovered after the ramp',
            `alive=${alive}, p95 ${fmt(recover.p95)} vs ${fmt(first.p95)} before, errors ${(recover.errorRate * 100).toFixed(1)}%`,
            [],
            'high',
          ),
    );
    mkdirSync(join(ROOT, 'reports/qa-suite'), { recursive: true });
    writeFileSync(
      join(ROOT, 'reports/qa-suite/stress-latest.json'),
      JSON.stringify({ peak: PEAK, seconds: SECONDS, rows, recover }, null, 2),
    );
    return {
      checks: [
        ...checks,
        {
          id: 'stress-table',
          title: 'Ramp results',
          status: 'pass',
          detail: '',
          evidence: rows.map(
            (r) =>
              `${r.multiple}x ${r.rps}rps: p50 ${fmt(r.p50)} p95 ${fmt(r.p95)} p99 ${fmt(r.p99)} ok ${r.ok} shed ${r.shed} err ${r.bad}`,
          ),
        },
      ],
      metrics: {
        'peak assumed rps': PEAK,
        'max sustained x': reached,
        'degraded at x': degradedAt ?? 'not reached',
      },
      target: {
        met: reached >= 2 && !!degradedAt,
        text: `Sustained ${reached}x, degradation point ${degradedAt ? degradedAt + 'x' : 'not found'}. Set QA_PEAK_RPS to the real expected peak: the multiples mean nothing against a guess.`,
      },
    };
  },
};
