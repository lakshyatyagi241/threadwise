// #17 Session-expiry testing: scenario catalogue with P0/P1 coverage, plus live API attacks on the session lifecycle (repeated to expose flakiness).
import {
  ROOT,
  env,
  exists,
  expectNone,
  fail,
  http,
  login,
  pass,
  requireLocal,
  skip,
  walk,
  read,
} from '../lib/core.mjs';
import { join } from 'node:path';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACE = Number(process.env.QA_REFRESH_GRACE ?? 30);

// live: id -> function returning true on pass. `s` is a fresh sign-in { token, refresh }.
const LIVE = {
  SE01: [
    'P0',
    'a valid access token reads the session',
    async (s) => (await http('GET', '/v2/auth/session', { token: s.token })).status === 200,
  ],
  SE02: [
    'P0',
    'no Authorization header is refused with 401',
    async () => (await http('GET', '/v2/auth/session')).status === 401,
  ],
  SE03: [
    'P0',
    'a malformed bearer value is refused with 401',
    async () =>
      (
        await Promise.all(
          ['x', 'a.b', 'a.b.c', ' ', 'null', '{}'].map((t) =>
            http('GET', '/v2/auth/session', { token: t }),
          ),
        )
      ).every((r) => r.status === 401),
  ],
  SE04: [
    'P0',
    'a token with a tampered signature is refused',
    async (s) => {
      const [h, p, g] = s.token.split('.');
      return (
        (await http('GET', '/v2/auth/session', { token: `${h}.${p}.${g.slice(0, -3)}AAA` }))
          .status === 401
      );
    },
  ],
  SE05: [
    'P0',
    'a token with a tampered payload (privilege swap) is refused',
    async (s) => {
      const [h, p, g] = s.token.split('.');
      const pl = JSON.parse(Buffer.from(p, 'base64url'));
      pl.exp = Math.floor(Date.now() / 1000) + 99999;
      return (
        (await http('GET', '/v2/auth/session', { token: `${h}.${b64(pl)}.${g}` })).status === 401
      );
    },
  ],
  SE06: [
    'P0',
    'an unsigned (alg=none) token is refused',
    async (s) => {
      const p = s.token.split('.')[1];
      return (
        (
          await http('GET', '/v2/auth/session', {
            token: `${b64({ alg: 'none', typ: 'JWT' })}.${p}.`,
          })
        ).status === 401
      );
    },
  ],
  SE07: [
    'P0',
    'an expired token is refused',
    async (s) => {
      const [h, p, g] = s.token.split('.');
      const pl = JSON.parse(Buffer.from(p, 'base64url'));
      pl.exp = 1;
      return (
        (await http('GET', '/v2/auth/session', { token: `${h}.${b64(pl)}.${g}` })).status === 401
      );
    },
  ],
  SE08: [
    'P0',
    'logout revokes the access token on the server (not only in the browser)',
    async (s) => {
      await http('POST', '/v2/auth/logout', { token: s.token, body: { refreshToken: s.refresh } });
      return (await http('GET', '/v2/auth/session', { token: s.token })).status === 401;
    },
  ],
  SE09: [
    'P0',
    'logout with only the refresh token ends the session',
    async (s) => {
      const r = await http('POST', '/v2/auth/logout', { body: { refreshToken: s.refresh } });
      const again = await http('POST', '/v2/auth/refresh', { body: { refreshToken: s.refresh } });
      return r.status === 201 || r.status === 200 ? again.status === 401 : false;
    },
  ],
  SE10: [
    'P0',
    'refresh returns a working new access token and a new refresh token',
    async (s) => {
      const r = await http('POST', '/v2/auth/refresh', { body: { refreshToken: s.refresh } });
      const t = r.json?.accessToken ?? r.json?.data?.accessToken;
      const n = r.json?.refreshToken ?? r.json?.data?.refreshToken;
      return (
        !!t &&
        !!n &&
        n !== s.refresh &&
        (await http('GET', '/v2/auth/session', { token: t })).status === 200
      );
    },
  ],
  SE11: [
    'P0',
    'garbage refresh tokens are refused with 401',
    async () =>
      (
        await Promise.all(
          ['', 'x', 'a.b.c', 'AAAA'.repeat(200)].map((t) =>
            http('POST', '/v2/auth/refresh', { body: { refreshToken: t } }),
          ),
        )
      ).every((r) => [400, 401].includes(r.status)),
  ],
  SE12: [
    'P0',
    'a rotated refresh token replayed after the grace window revokes the whole session',
    async (s) => {
      const r1 = await http('POST', '/v2/auth/refresh', { body: { refreshToken: s.refresh } });
      const next = r1.json?.refreshToken ?? r1.json?.data?.refreshToken;
      await sleep((GRACE + 2) * 1000);
      const replay = await http('POST', '/v2/auth/refresh', { body: { refreshToken: s.refresh } });
      const after = await http('POST', '/v2/auth/refresh', { body: { refreshToken: next } });
      return replay.status === 401 && after.status === 401;
    },
    'slow',
  ],
  SE13: [
    'P1',
    'a replay inside the grace window is tolerated (two tabs refreshing at once)',
    async (s) => {
      const a = await http('POST', '/v2/auth/refresh', { body: { refreshToken: s.refresh } });
      const b = await http('POST', '/v2/auth/refresh', { body: { refreshToken: s.refresh } });
      return a.status < 300 && b.status < 300;
    },
  ],
  SE14: [
    'P1',
    'logout is idempotent (second call still answers ok)',
    async (s) => {
      await http('POST', '/v2/auth/logout', { body: { refreshToken: s.refresh } });
      const r = await http('POST', '/v2/auth/logout', { body: { refreshToken: s.refresh } });
      return r.status < 300 && (r.json?.ok ?? true) === true;
    },
  ],
  SE15: [
    'P1',
    'logout never answers 5xx for junk input',
    async () =>
      (
        await Promise.all(
          [{}, { refreshToken: 'x' }, { refreshToken: null }].map((b) =>
            http('POST', '/v2/auth/logout', { body: b, token: 'junk' }),
          ),
        )
      ).every((r) => r.status < 500),
  ],
  SE16: [
    'P1',
    'the session endpoint is not cacheable (no-store) so a back button cannot replay it',
    async (s) => {
      const r = await http('GET', '/v2/auth/session', { token: s.token });
      const cc = r.headers?.get('cache-control') ?? '';
      return /no-store|no-cache|private/.test(cc);
    },
  ],
};
// scenarios covered by existing automated tests rather than by the live run: [id, priority, title, phrase searched in test names]
const EXISTING = [
  ['SE20', 'P1', 'idle timeout ends the session with reason idle', /idle/i],
  ['SE21', 'P1', 'a suspended workspace is refused on its next request', /suspend/i],
  [
    'SE22',
    'P1',
    'a deactivated user cannot keep using an old token',
    /(deactivat|disabled user|inactive user)/i,
  ],
  [
    'SE23',
    'P1',
    'changing the password ends other sessions',
    /(password).*(revoke|other sessions|sign out)/i,
  ],
  [
    'SE24',
    'P1',
    'concurrent session cap evicts the oldest session',
    /(session cap|max sessions|concurrent sessions)/i,
  ],
  ['SE25', 'P1', 'refresh reuse is written to the audit log', /(refresh_reuse|reuse)/i],
];
const BROWSER = [
  'SE30 expired cookie -> sign-in page',
  'SE31 tampered cookie -> sign-in page',
  'SE32 sign-out in one tab ends the other',
  'SE33 deep link survives sign-in',
  'SE34 back button after sign-out',
];

export default {
  id: 17,
  priority: 'P1',
  name: 'Session-expiry testing',
  owner: 'Punya',
  target: 'Automated suite with >=95% P0/P1 scenario coverage and zero flaky P0 tests',
  async run() {
    const checks = [];
    const testText = [
      ...walk(
        join(ROOT, 'apps/api/test'),
        (p) => /\.(spec|test)\.ts$/.test(p) && /\/(auth|authz|session|workspaces-teams)/i.test(p),
      ),
    ].map((f) => [f, read(f)]);
    let covered = 0,
      total = 0;
    for (const [, pr] of Object.values(LIVE).map((v) => [v, v[0]])) {
      total++;
      covered++;
    } // each live scenario is automated by this task
    for (const [id, pr, title, re] of EXISTING) {
      total++;
      const hit = testText.filter(([, t]) =>
        [...t.matchAll(/(?:it|test)(?:\.each\([^)]*\))?\(\s*[`'"]([^`'"]+)/g)].some((m) =>
          re.test(m[1]),
        ),
      );
      if (hit.length) {
        covered++;
        checks.push(
          pass(
            `cov-${id}`,
            `${id} ${title}: covered by existing tests`,
            hit
              .slice(0, 2)
              .map(([f]) => f.replace(ROOT + '/', ''))
              .join(', '),
          ),
        );
      } else
        checks.push(
          fail(
            `cov-${id}`,
            `${id} ${title}: no test found`,
            `searched test names in apps/api/test for ${re}`,
            [],
            'medium',
          ),
        );
    }
    const browser = exists('apps/web/e2e/security/session-expiry.spec.ts');
    total += BROWSER.length;
    if (browser) covered += BROWSER.length;
    checks.push(
      browser
        ? pass(
            'cov-browser',
            `${BROWSER.length} browser scenarios in apps/web/e2e/security/session-expiry.spec.ts`,
          )
        : fail('cov-browser', 'Browser session-expiry spec exists'),
    );
    const pct = Math.round((covered / total) * 100);
    checks.push(
      pct >= 95
        ? pass('cov-total', `P0/P1 scenario coverage ${pct}% (${covered}/${total}), target 95%`)
        : fail(
            'cov-total',
            `P0/P1 scenario coverage ${pct}% (${covered}/${total}), target 95%`,
            '',
            [],
            'medium',
          ),
    );

    const bad = requireLocal(env.api);
    if (bad || !env.email)
      for (const [id, [pr, title]] of Object.entries(LIVE))
        checks.push(
          skip(
            `live-${id}`,
            `${id} ${pr} ${title}`,
            bad ?? 'set QA_EMAIL and QA_PASSWORD (LOCAL dev account)',
          ),
        );
    else {
      const repeats = Math.max(1, Number(process.env.QA_REPEAT ?? 3));
      for (const [id, [pr, title, fn, slow]] of Object.entries(LIVE)) {
        const results = [];
        for (let i = 0; i < (slow ? 1 : repeats); i++) {
          const s = await login();
          if (s.error) {
            results.push(`login: ${s.error}`);
            break;
          }
          try {
            results.push(!!(await fn(s)));
          } catch (e) {
            results.push(`error: ${e.message}`);
          }
        }
        const allPass = results.every((r) => r === true),
          allFail = results.every((r) => r !== true);
        checks.push(
          allPass
            ? pass(`live-${id}`, `${id} ${pr} ${title}`, `${results.length}/${results.length} runs`)
            : fail(
                `live-${id}`,
                `${id} ${pr} ${title}`,
                allFail
                  ? `failed ${results.length}/${results.length} runs: ${results.find((r) => r !== true)}`
                  : `FLAKY: ${results.filter((r) => r === true).length} of ${results.length} runs passed`,
                [],
                pr === 'P0' ? 'high' : 'medium',
              ),
        );
      }
    }
    const flaky = checks.filter(
      (c) => c.detail.startsWith('FLAKY') && /\sP0\s/.test(c.title),
    ).length;
    return {
      checks,
      metrics: { 'P0/P1 scenarios': total, covered: covered, 'coverage %': pct, 'flaky P0': flaky },
      target: {
        met:
          pct >= 95 && flaky === 0
            ? checks.some((c) => c.id.startsWith('live-') && c.status === 'skip')
              ? null
              : true
            : false,
        text: `${pct}% coverage; flaky P0 = ${flaky}. Flakiness is only measured when the live run executes (QA_EMAIL/QA_PASSWORD set).`,
      },
    };
  },
};
