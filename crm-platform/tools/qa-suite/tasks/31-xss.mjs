// #31 XSS testing: dangerous sinks in the code, sanitizer coverage, response headers, and live reflection checks. Browser-level checks: apps/web/e2e/security/xss.spec.ts.
import {
  ROOT,
  env,
  exists,
  expectNone,
  fail,
  http,
  login,
  pass,
  read,
  rel,
  requireLocal,
  skip,
  unreviewed,
  walk,
  warn,
} from '../lib/core.mjs';
import { join } from 'node:path';
import { PAYLOADS } from './xss-payloads.mjs';

const SINKS = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML assignment', /\.(innerHTML|outerHTML)\s*=[^=]/],
  ['insertAdjacentHTML / document.write', /insertAdjacentHTML\(|document\.write\(/],
  ['javascript: URL literal', /['"`]javascript:/i],
  ['Function/eval string', /new Function\(|[^.\w]eval\(/],
];

export default {
  id: 31,
  priority: 'P1',
  name: 'XSS testing',
  owner: 'Punya',
  target: 'Automated on PR/daily/pre-release as applicable; zero Critical/High release blockers',
  async run() {
    const checks = [];
    const files = [
      ...walk(
        join(ROOT, 'apps'),
        (p) =>
          /\.(tsx|ts|js|html)$/.test(p) &&
          !/(\.test\.|\.spec\.|\/test\/|\/e2e\/|node_modules)/.test(p) &&
          !p.includes('apps/api/'),
      ),
    ];
    const found = Object.fromEntries(SINKS.map(([n]) => [n, []]));
    for (const f of files) {
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(l)) return;
        for (const [n, re] of SINKS)
          if (re.test(l)) found[n].push(`${rel(f)}:${i + 1}  ${l.trim().slice(0, 100)}`);
      });
    }
    for (const [n, list] of Object.entries(found))
      checks.push(
        expectNone(
          `xss-sink-${n.split(' ')[0].toLowerCase()}`,
          `Sink: ${n} (every use is reviewed and sanitized or escaped)`,
          unreviewed(31, list),
          {
            level: n.startsWith('javascript') || n.startsWith('Function') ? 'fail' : 'warn',
            severity: 'high',
          },
        ),
      );

    // sanitizer present and tested with a payload corpus
    const sanitizer = [
      ...walk(
        join(ROOT, 'apps/api/src'),
        (p) => /sanitiz/i.test(p) && p.endsWith('.ts') && !/\.(test|spec)\./.test(p),
      ),
    ];
    checks.push(
      sanitizer.length
        ? pass(
            'xss-sanitizer',
            `A server-side HTML sanitizer exists (${sanitizer.map(rel).join(', ')})`,
          )
        : fail('xss-sanitizer', 'A server-side HTML sanitizer exists'),
    );
    const tests = [...walk(join(ROOT, 'apps'), (p) => /sanitiz.*\.(test|spec)\.ts$/i.test(p))];
    const payloadsTested = tests.reduce(
      (a, f) => a + (read(f).match(/<script|onerror|javascript:|onload/gi) ?? []).length,
      0,
    );
    checks.push(
      payloadsTested >= 10
        ? pass('xss-sanitizer-tests', `Sanitizer tests contain ${payloadsTested} attack strings`)
        : warn(
            'xss-sanitizer-tests',
            `Sanitizer tests contain ${payloadsTested} attack strings (want >= 10)`,
          ),
    );

    // headers configured in code
    const next = exists('apps/web/next.config.ts')
      ? read(join(ROOT, 'apps/web/next.config.ts'))
      : '';
    const sec = exists('apps/api/src/modules/auth/middleware-security-headers.ts')
      ? read(join(ROOT, 'apps/api/src/modules/auth/middleware-security-headers.ts'))
      : '';
    const want = ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy'];
    const missing = want.filter((h) => !new RegExp(h, 'i').test(next + sec));
    checks.push(
      missing.length
        ? fail(
            'xss-headers-config',
            'CSP, nosniff and Referrer-Policy are configured',
            `missing in next.config.ts / security-headers middleware: ${missing}`,
            [],
            'medium',
          )
        : pass('xss-headers-config', 'CSP, nosniff and Referrer-Policy are configured'),
    );
    checks.push(
      /script-src[^;'"]*'unsafe-inline'/.test(next + sec)
        ? warn(
            'xss-csp-inline',
            'CSP script-src avoids unsafe-inline',
            "'unsafe-inline' in script-src defeats most of CSP's XSS protection: use nonces",
          )
        : pass(
            'xss-csp-inline',
            "CSP script-src does not allow 'unsafe-inline' (or is not set in code)",
          ),
    );

    // live
    const bad = requireLocal(env.api);
    let n = 0;
    if (bad) checks.push(skip('xss-live', 'Live reflection and header checks', bad));
    else {
      const problems = [];
      for (const pay of PAYLOADS) {
        for (const path of [
          `/v2/${encodeURIComponent(pay)}`,
          `/v2/auth/registration-config?x=${encodeURIComponent(pay)}`,
          '/v2/auth/login',
        ]) {
          n++;
          const r =
            path === '/v2/auth/login'
              ? await http('POST', path, { body: { email: pay, password: 'x' } })
              : await http('GET', path);
          const ct = r.headers?.get('content-type') ?? '';
          if (/text\/html/.test(ct) && r.text.includes(pay))
            problems.push(`HTML response reflects the payload: ${path.slice(0, 60)}`);
          if (!/json|problem/.test(ct) && r.text.includes(pay))
            problems.push(`non-JSON response (${ct}) echoes the payload: ${path.slice(0, 60)}`);
          if (!r.headers?.get('x-content-type-options'))
            problems.push(`no X-Content-Type-Options on ${path.slice(0, 40)}`);
        }
      }
      checks.push(
        expectNone(
          'xss-live-api',
          `API never reflects a payload as HTML and always sends nosniff (${n} requests)`,
          [...new Set(problems)],
          { severity: 'high' },
        ),
      );
      if (env.web && !requireLocal(env.web)) {
        const r = await fetch(env.web + '/login').catch(() => null);
        const csp = r?.headers.get('content-security-policy');
        checks.push(
          csp
            ? pass('xss-live-web-csp', 'The web app sends a Content-Security-Policy')
            : fail(
                'xss-live-web-csp',
                'The web app sends a Content-Security-Policy',
                '',
                [],
                'medium',
              ),
        );
      } else
        checks.push(
          skip(
            'xss-live-web-csp',
            'The web app sends a CSP header',
            'set WEB_URL=http://localhost:3001',
          ),
        );
    }
    checks.push(
      exists('apps/web/e2e/security/xss.spec.ts')
        ? pass(
            'xss-browser',
            `Browser XSS spec exists: ${PAYLOADS.length} payloads x stored/reflected pages (run: playwright test e2e/security/xss.spec.ts)`,
          )
        : fail('xss-browser', 'Browser XSS spec exists'),
    );
    const total = Object.values(found).reduce((a, l) => a + l.length, 0);
    return {
      checks,
      metrics: {
        'files scanned': files.length,
        'sink uses': total,
        payloads: PAYLOADS.length,
        'live requests': n,
      },
      target: {
        met: checks.some((c) => c.status === 'fail') ? false : null,
        text: 'Sinks need a human review recorded in data/baseline.json; the browser spec proves payloads do not execute.',
      },
    };
  },
};
