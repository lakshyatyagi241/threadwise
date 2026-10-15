// #11 Regression suite: how many automated checks exist and (with --run-unit) whether any fail.
import { ROOT, expectNone, fail, pass, read, skip, sh, walk, warn } from '../lib/core.mjs';
import { matrixShape } from './10-playwright-ui.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const TEST_RE = /^\s*(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent))?\s*\(/gm;
const EACH_RE = /(?:it|test)\.each\s*\(/g;

export default {
  id: 11,
  priority: 'P1',
  name: 'Regression suite',
  owner: 'Punya',
  target: '>=10,000 automated checks; zero P0/P1 regression',
  async run({ args }) {
    const groups = {
      'api unit/integration/e2e': 'apps/api',
      'web unit': 'apps/web/src',
      packages: 'packages',
      mobile: 'apps/mobile',
    };
    const counts = {};
    let eachTables = 0,
      skipped = 0;
    for (const [label, dir] of Object.entries(groups)) {
      let n = 0;
      for (const f of walk(
        join(ROOT, dir),
        (p) =>
          (/\.(test|spec)\.(ts|tsx|mjs|js)$/.test(p) && !p.includes('/e2e/')) ||
          (/\.spec\.ts$/.test(p) && p.includes('apps/api/test/e2e')),
      )) {
        const t = read(f);
        n += (t.match(TEST_RE) ?? []).length;
        eachTables += (t.match(EACH_RE) ?? []).length;
        skipped += (t.match(/\b(?:it|test)\.(?:skip|todo)\s*\(/g) ?? []).length;
      }
      counts[label] = n;
    }
    let node = 0;
    for (const f of walk(join(ROOT, 'tools'), (p) => /\.test\.mjs$/.test(p)))
      node += (read(f).match(/^\s*(?:test|it)\s*\(/gm) ?? []).length;
    counts['tools (node:test)'] = node;
    const mx = matrixShape();
    const pw = (() => {
      let n = 0;
      for (const f of walk(
        join(ROOT, 'apps/web/e2e'),
        (p) => p.endsWith('.spec.ts') && !p.includes('_matrix'),
      ))
        n += (read(f).match(/^\s*(?:test|it)\s*\(/gm) ?? []).length;
      return n;
    })();
    counts['playwright (hand-written)'] = pw;
    counts['playwright (route matrix)'] = mx.scenarios;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const checks = [
      total >= 10000
        ? pass('reg-count', `${total} automated checks (target 10,000)`)
        : fail(
            'reg-count',
            `${total} automated checks, target 10,000`,
            `Static count of test declarations; ${eachTables} it.each/test.each tables expand to more rows at run time, so the true number is higher. Run --run-unit for the exact figure.`,
            [],
            'medium',
          ),
      {
        id: 'reg-breakdown',
        title: 'Where the checks live',
        status: 'pass',
        detail: '',
        evidence: Object.entries(counts).map(([k, v]) => `${k}: ${v}`),
      },
      skipped
        ? warn(
            'reg-skipped',
            `${skipped} tests are skipped or todo`,
            'A skipped test is not a regression guard.',
          )
        : pass('reg-skipped', 'No skipped or todo tests'),
    ];

    if (args.includes('--run-unit')) {
      if (!existsSync(join(ROOT, 'node_modules')))
        checks.push(
          skip('reg-run', 'Run unit suites', 'dependencies not installed (pnpm install)'),
        );
      else {
        const out = join(ROOT, 'reports/qa-suite/vitest-api.json');
        const r = sh(
          'pnpm',
          [
            '--filter',
            '@crm/api',
            'exec',
            'vitest',
            'run',
            'test/unit',
            '--reporter=json',
            `--outputFile=${out}`,
          ],
          { timeout: 3600_000 },
        );
        try {
          const j = JSON.parse(read(out));
          checks.push(
            j.numFailedTests === 0
              ? pass('reg-run', `API unit suite: ${j.numPassedTests}/${j.numTotalTests} passed`)
              : fail(
                  'reg-run',
                  `API unit suite: ${j.numFailedTests} failed of ${j.numTotalTests}`,
                  '',
                  j.testResults
                    .flatMap((t) =>
                      t.assertionResults
                        .filter((a) => a.status === 'failed')
                        .map((a) => `${t.name}: ${a.fullName}`),
                    )
                    .slice(0, 30),
                  'high',
                ),
          );
        } catch {
          checks.push(fail('reg-run', 'Vitest produced no result', (r.stderr || '').slice(0, 300)));
        }
      }
    } else
      checks.push(
        skip(
          'reg-run',
          'Run the unit suites and require zero failures',
          'pass --run-unit (Docker-backed integration/e2e suites: see docs/quality/README.md)',
        ),
      );
    return {
      checks,
      metrics: { 'static check count': total, 'it.each tables': eachTables, skipped },
      target: {
        met: total >= 10000 ? (checks.some((c) => c.status === 'fail') ? false : null) : false,
        text: `${total}/10000 checks counted statically. "Zero P0/P1 regression" needs a green run: --run-unit, then the Docker suites.`,
      },
    };
  },
};
