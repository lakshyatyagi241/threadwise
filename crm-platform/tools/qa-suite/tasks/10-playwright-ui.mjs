// #10 Playwright UI automation: scenario count and P0/P1 journey coverage. `--run-playwright` also executes the suite (needs the stack).
import {
  ROOT,
  apiSrc,
  exists,
  expectNone,
  fail,
  pass,
  read,
  skip,
  sh,
  warn,
  walk,
} from '../lib/core.mjs';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

const WEB = join(ROOT, 'apps/web');

export function matrixShape() {
  const cfg = JSON.parse(read(join(WEB, 'e2e/_matrix/matrix.config.json')));
  const pages = [...walk(join(WEB, 'src/app'), (p) => p.endsWith('/page.tsx'))].map((p) =>
    p
      .slice(join(WEB, 'src/app').length + 1)
      .split('/')
      .slice(0, -1),
  );
  const dyn = pages.filter((s) => s.some((x) => x.includes('[')) || s.includes('api')).length;
  const gen = pages.filter(
    (s) => !s.some((x) => cfg.skipGroups.includes(x) || x.includes('[') || x === 'api'),
  );
  const per = cfg.viewports.length * cfg.checksPerRouteViewport.length + cfg.checksPerRoute.length;
  return {
    pages: pages.length,
    generated: gen.length,
    dynamic: dyn,
    skippedGroups: pages.length - gen.length - dyn,
    scenarios: gen.length * per,
    per,
  };
}

export default {
  id: 10,
  priority: 'P1',
  name: 'Playwright UI automation',
  owner: 'Punya',
  target: '2,500 browser scenarios; 100% P0/P1 UI journeys',
  async run({ args }) {
    const checks = [];
    // Exact count when Playwright is installed, otherwise a static count (specs + generated matrix).
    let total = null,
      source = '';
    if (args.includes('--exact-count')) {
      // One `playwright test --list` per e2e folder (a spec that fails to load, for example one needing generated files, would otherwise hide everything).
      let sum = 0;
      const failed = [];
      for (const dir of readdirSync(join(WEB, 'e2e'), { withFileTypes: true }).filter(
        (d) => d.isDirectory() && d.name !== '.results',
      )) {
        const r = sh(
          'pnpm',
          ['--filter', '@crm/web', 'exec', 'playwright', 'test', `e2e/${dir.name}`, '--list'],
          { timeout: 180000 },
        );
        const m = /Total:\s*(\d+)\s+tests?/.exec(r.stdout ?? '');
        if (m && r.status === 0) sum += +m[1];
        else failed.push(dir.name);
      }
      if (sum > 0) {
        total = sum;
        source = `playwright test --list per folder${failed.length ? `; folders that failed to load and are not counted: ${failed.join(', ')}` : ''}`;
      }
    }
    const specs = [
      ...walk(join(WEB, 'e2e'), (p) => p.endsWith('.spec.ts') && !p.includes('/_matrix/')),
    ];
    const handWritten = specs.reduce(
      (a, f) => a + (read(f).match(/^\s*(?:test|it)(?:\.(?:only|fixme))?\(/gm) ?? []).length,
      0,
    );
    const mx = exists('apps/web/e2e/_matrix/matrix.config.json') ? matrixShape() : null;
    if (total === null) {
      total = handWritten + (mx?.scenarios ?? 0);
      source =
        'static count (hand-written tests + matrix expansion; loops over data in hand-written specs count once)';
    }
    checks.push(
      total >= 2500
        ? pass('pw-count', `${total} browser scenarios (target 2,500)`, source)
        : fail('pw-count', `${total} browser scenarios, target 2,500`, source, [], 'medium'),
    );
    if (mx)
      checks.push(
        pass(
          'pw-matrix',
          `Route matrix generates ${mx.scenarios} scenarios from ${mx.generated} static pages x ${mx.per} checks`,
          `${mx.dynamic} dynamic pages and ${mx.skippedGroups} pages in skipped groups are not generated`,
        ),
      );
    else checks.push(fail('pw-matrix', 'Route matrix exists (apps/web/e2e/_matrix)'));
    checks.push(
      exists('apps/web/e2e/security/xss.spec.ts') &&
        exists('apps/web/e2e/security/session-expiry.spec.ts')
        ? pass('pw-security', 'Security UI specs exist (XSS, session expiry)')
        : warn('pw-security', 'Security UI specs exist'),
    );

    // Journey coverage: each P0/P1 journey's domains need a Playwright folder.
    const cat = JSON.parse(read(join(ROOT, 'docs/quality/journeys/journeys.json')));
    const folders = new Set(readdirSync(join(WEB, 'e2e')));
    const j = cat.journeys.filter((x) => ['P0', 'P1'].includes(x.priority));
    const uncovered = j.flatMap((x) =>
      (x.domains ?? [])
        .filter((d) => !folders.has(d))
        .map((d) => `${x.id} (${x.priority}): no Playwright folder for domain "${d}"`),
    );
    checks.push(
      expectNone(
        'pw-journeys',
        `Every domain of the ${j.length} P0/P1 journeys has Playwright specs`,
        uncovered,
        { severity: 'medium' },
      ),
    );

    if (args.includes('--run-playwright')) {
      const r = sh(
        'pnpm',
        ['--filter', '@crm/web', 'exec', 'playwright', 'test', '--reporter=json'],
        { env: { ...process.env, HEADLESS: '1' }, timeout: 3 * 3600_000 },
      );
      try {
        const s = JSON.parse(r.stdout).stats;
        checks.push(
          s.unexpected === 0 && s.flaky === 0
            ? pass('pw-run', `Suite ran: ${s.expected} passed`)
            : fail(
                'pw-run',
                `Suite ran: ${s.unexpected} failed, ${s.flaky} flaky, ${s.expected} passed`,
              ),
        );
      } catch {
        checks.push(
          fail('pw-run', 'Playwright run produced no JSON result', (r.stderr || '').slice(0, 300)),
        );
      }
    } else
      checks.push(
        skip(
          'pw-run',
          'Execute the suite against the running stack',
          'pass --run-playwright (needs API :3000, web :3001 and seeded data)',
        ),
      );
    return {
      checks,
      metrics: {
        scenarios: total,
        'matrix pages': mx?.generated ?? 0,
        'hand-written tests': handWritten,
        'P0/P1 journeys': j.length,
      },
      target: {
        met: total >= 2500 && uncovered.length === 0 ? true : false,
        text: `${total}/2500 scenarios, ${uncovered.length} journey domains without UI specs. Pass rate is only known after --run-playwright.`,
      },
    };
  },
};
