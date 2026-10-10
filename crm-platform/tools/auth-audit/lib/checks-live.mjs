// Live probes: attack the RUNNING API over HTTP and report what came back.
//
// Safety rules, enforced in code:
//   - only loopback / *.localhost / *.test hosts unless --allow-remote is passed (never point this at production);
//   - authenticated probes use credentials YOU supply (dev seed users), never anything stored in the repo;
//   - request volume is small and bounded (the login throttles are deliberately exercised, nothing more);
//   - no credential, token or recovery value is written to the report: bodies are summarised, tokens are never echoed.

import { result } from './util.mjs';

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1|[\w-]+\.localhost|[\w.-]+\.test)$/i;

export function assertSafeTarget(base, allowRemote) {
  let u;
  try {
    u = new URL(base);
  } catch {
    return { ok: false, reason: `"${base}" is not a URL` };
  }
  if (!allowRemote && !LOCAL_HOST.test(u.hostname)) {
    return {
      ok: false,
      reason: `${u.hostname} is not a local host. Live probes only run against loopback / *.localhost / *.test unless --allow-remote is passed. Never aim them at production.`,
    };
  }
  return { ok: true, base: u.origin };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

async function http(base, method, path, { json, body, headers = {}, raw } = {}) {
  const started = performance.now();
  try {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: raw ?? (json !== undefined ? JSON.stringify(json) : body),
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not json */
    }
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: parsed,
      ms: performance.now() - started,
    };
  } catch (e) {
    return {
      status: 0,
      headers: new Headers(),
      text: '',
      json: null,
      ms: performance.now() - started,
      error: String(e?.cause?.code ?? e?.message ?? e),
    };
  }
}

const LEAKS =
  /(\bat [\w.<>$]+ \(|node_modules|[A-Za-z]:\\\\|\/src\/|\.ts:\d+|SequelizeError|QueryFailedError|drizzle|pg_catalog|syntax error at or near|stack)/i;
/** Normalised error identity: ignore request ids, paths and timestamps. */
const problemKey = (r) =>
  `${r.status}|${r.json?.code ?? ''}|${r.json?.detail ?? r.json?.message ?? ''}`;

const R =
  (id, controls, title) =>
  (status, extra = {}) =>
    result({ id, controls, title, status, confidence: 'live', ...extra });

export async function runLiveProbes(ctx) {
  const { opts } = ctx;
  const target = assertSafeTarget(opts.live, opts.allowRemote);
  if (!target.ok) {
    return [
      result({
        id: 'live-probes',
        controls: [],
        title: 'Live probes',
        status: 'error',
        summary: `NOT RUN: ${target.reason}`,
        confidence: 'not-run',
      }),
    ];
  }
  const base = target.base;
  const up = await http(base, 'GET', '/v2/auth/password-policy');
  if (up.status !== 200) {
    return [
      result({
        id: 'live-probes',
        controls: [],
        title: 'Live probes',
        status: 'error',
        summary: `NOT RUN: the API at ${base} did not answer GET /v2/auth/password-policy with 200 (got ${up.status || up.error}). Start it (\`pnpm dev\`, after \`bash .claude/skills/setup/scripts/setup.sh\`) or pass --live <url>.`,
        confidence: 'not-run',
      }),
    ];
  }

  const cred = {
    org: opts.org ?? process.env.AUTH_AUDIT_ORG,
    email: opts.email ?? process.env.AUTH_AUDIT_EMAIL,
    password: opts.password ?? process.env.AUTH_AUDIT_PASSWORD,
  };
  const haveCred = Boolean(cred.email && cred.password);
  const out = [];
  const notRun = (id, controls, title, why) =>
    out.push(
      result({
        id,
        controls,
        title,
        status: 'error',
        summary: `NOT RUN: ${why}`,
        confidence: 'not-run',
      }),
    );

  // ---- L1 unauthenticated access to a protected route -----------------------------------------------------------
  {
    const ok = R(
      'live-unauthenticated-access',
      ['AUTH-031', 'AUTH-019', 'AUTH-027'],
      'Protected routes refuse missing, malformed and wrong-scheme credentials',
    );
    const cases = [
      ['no header', {}],
      ['empty bearer', { authorization: 'Bearer ' }],
      ['garbage bearer', { authorization: 'Bearer not.a.jwt' }],
      ['basic scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
      ['bearer with SQL-ish payload', { authorization: "Bearer ' OR 1=1 --" }],
    ];
    const rows = [];
    for (const [name, headers] of cases)
      rows.push([name, await http(base, 'GET', '/v2/auth/session', { headers })]);
    const bad = rows.filter(([, r]) => r.status !== 401 || LEAKS.test(r.text));
    out.push(
      ok(bad.length ? 'fail' : 'pass', {
        severity: bad.length ? 'critical' : undefined,
        summary:
          rows.map(([n, r]) => `${n}: ${r.status}`).join('; ') +
          (bad.length
            ? ` — UNEXPECTED: ${bad.map(([n, r]) => `${n} → ${r.status}`).join(', ')}`
            : ' — all 401 with no stack/path leakage.'),
      }),
    );
  }

  // ---- L2 forged tokens -----------------------------------------------------------------------------------------
  {
    const ok = R(
      'live-forged-tokens',
      ['AUTH-037', 'AUTH-036'],
      'Forged and tampered JWTs are rejected by the running API',
    );
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const far = 4102444800;
    const claims = {
      sub: 1,
      org: 1,
      typ: 'user',
      uid: 'x',
      sid: '00000000-0000-4000-8000-000000000000',
      ep: 0,
      exp: far,
    };
    const tokens = {
      'alg=none': `${b({ alg: 'none', typ: 'JWT' })}.${b(claims)}.`,
      'alg=none, empty-sig variant': `${b({ alg: 'None', typ: 'JWT' })}.${b(claims)}.AAAA`,
      'HS256 signed with a guessed secret': await hs256(claims, 'secret'),
      'platform_operator claim, bad signature': `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ ...claims, typ: 'platform_operator', org: 0 })}.${'A'.repeat(43)}`,
    };
    const rows = [];
    for (const [name, t] of Object.entries(tokens))
      rows.push([
        name,
        await http(base, 'GET', '/v2/auth/session', { headers: { authorization: `Bearer ${t}` } }),
      ]);
    const bad = rows.filter(([, r]) => r.status !== 401);
    out.push(
      ok(bad.length ? 'fail' : 'pass', {
        severity: bad.length ? 'critical' : undefined,
        summary:
          rows.map(([n, r]) => `${n}: ${r.status}`).join('; ') +
          (bad.length
            ? ' — A FORGED TOKEN WAS NOT REJECTED'
            : ' — every forged token returned 401.'),
      }),
    );
  }

  // ---- L2b the published example secret --------------------------------------------------------------------------
  {
    const ok = R(
      'live-example-secret',
      ['AUTH-039'],
      'The server does not sign with the secret published in .env.example',
    );
    const local = LOCAL_HOST.test(new URL(base).hostname);
    const claims = {
      sub: 1,
      org: 1,
      typ: 'user',
      uid: 'x',
      sid: '00000000-0000-4000-8000-000000000000',
      ep: 0,
      exp: 4102444800,
    };
    const r = await http(base, 'GET', '/v2/auth/session', {
      headers: {
        authorization: `Bearer ${await hs256(claims, 'dev-only-access-secret-change-me-in-every-real-environment')}`,
      },
    });
    // 401 = rejected (good). Anything else means the token was accepted far enough to be looked up by session: the secret is the public one.
    const accepted = r.status !== 401;
    out.push(
      ok(accepted ? (local ? 'policy' : 'fail') : 'pass', {
        severity: accepted ? (local ? 'low' : 'critical') : undefined,
        summary: accepted
          ? `A token signed with the public example secret got ${r.status} instead of 401: this server is running the development JWT secret. Harmless on a laptop; on any shared URL anyone could mint tokens. (Production start-up refuses this placeholder.)`
          : 'A token signed with the example secret was rejected (401).',
      }),
    );
  }

  // ---- L3 error hygiene -----------------------------------------------------------------------------------------
  {
    const ok = R(
      'live-error-hygiene',
      ['AUTH-027', 'AUTH-091'],
      'Malformed input to login returns a safe client error with no internals',
    );
    const probes = [
      [
        'malformed JSON',
        () =>
          http(base, 'POST', '/v2/auth/login', {
            raw: '{"email": "a@b.test", ',
            headers: { 'content-type': 'application/json' },
          }),
      ],
      [
        'wrong content-type',
        () =>
          http(base, 'POST', '/v2/auth/login', {
            raw: 'email=a&password=b',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
          }),
      ],
      [
        'wrong types',
        () =>
          http(base, 'POST', '/v2/auth/login', { json: { email: { $ne: null }, password: ['x'] } }),
      ],
      [
        '1 MB body',
        () =>
          http(base, 'POST', '/v2/auth/login', {
            json: { email: 'a@b.test', password: 'x'.repeat(1_000_000) },
          }),
      ],
      [
        'NUL / lone surrogate in password',
        () =>
          http(base, 'POST', '/v2/auth/login', {
            json: { email: 'a@b.test', password: 'a\u0000b\ud800' },
          }),
      ],
      [
        'prototype pollution keys',
        () =>
          http(base, 'POST', '/v2/auth/login', {
            raw: '{"__proto__":{"admin":true},"email":"a@b.test","password":"x"}',
            headers: { 'content-type': 'application/json' },
          }),
      ],
    ];
    const rows = [];
    for (const [name, fn] of probes) rows.push([name, await fn()]);
    const bad = rows.filter(([, r]) => r.status < 400 || r.status >= 500 || LEAKS.test(r.text));
    out.push(
      ok(bad.length ? 'fail' : 'pass', {
        severity: bad.length ? 'medium' : undefined,
        summary:
          rows.map(([n, r]) => `${n}: ${r.status}`).join('; ') +
          (bad.length
            ? ` — UNEXPECTED: ${bad.map(([n, r]) => `${n} → ${r.status}${LEAKS.test(r.text) ? ' (internals in body)' : ''}`).join(', ')}`
            : ' — all 4xx, no stack traces, paths or SQL text.'),
      }),
    );
  }

  // ---- L4 headers -----------------------------------------------------------------------------------------------
  {
    const ok = R(
      'live-security-headers',
      ['AUTH-043', 'AUTH-083'],
      'Security headers on authentication responses',
    );
    const r = await http(base, 'POST', '/v2/auth/login', {
      json: { email: 'nobody@example.test', password: 'x' },
    });
    const h = (k) => r.headers.get(k);
    const want = {
      'x-content-type-options': /nosniff/i,
      'referrer-policy': /./,
      'x-frame-options': /./,
      'content-security-policy': /./,
      'cache-control': /no-store/i,
    };
    const missingH = Object.entries(want)
      .filter(([k, re]) => !re.test(h(k) ?? ''))
      .map(([k]) => k);
    const server = h('x-powered-by');
    out.push(
      ok(missingH.length ? 'fail' : server ? 'partial' : 'pass', {
        severity: missingH.length ? 'medium' : server ? 'low' : undefined,
        summary: `login response ${r.status}; missing: ${missingH.join(', ') || 'none'}; x-powered-by: ${server ?? 'absent'}. (HSTS is only sent on secure connections, so it cannot appear on http://localhost.)`,
        recommendation: server
          ? 'Disable x-powered-by (app.disable("x-powered-by")) to stop advertising the framework.'
          : undefined,
      }),
    );
  }

  // ---- L5 CORS ---------------------------------------------------------------------------------------------------
  {
    const ok = R('live-cors', ['AUTH-083'], 'CORS refuses a hostile origin');
    const r = await http(base, 'OPTIONS', '/v2/auth/login', {
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    });
    const acao = r.headers.get('access-control-allow-origin');
    const acac = r.headers.get('access-control-allow-credentials');
    const reflected = acao === 'https://evil.example';
    out.push(
      ok(reflected && acac === 'true' ? 'policy' : 'pass', {
        severity: reflected && acac === 'true' ? 'low' : undefined,
        summary: `preflight from https://evil.example → ACAO=${acao ?? 'none'}, credentials=${acac ?? 'none'}. ${reflected && acac === 'true' ? 'This server REFLECTS arbitrary origins with credentials: that is the non-production default when CORS_ORIGINS is empty. Acceptable on a laptop, a vulnerability on any shared/staging host — set CORS_ORIGINS there.' : 'The hostile origin was not allowed with credentials.'}`,
      }),
    );
  }

  // ---- L6 login parity (enumeration + timing) -------------------------------------------------------------------
  const rnd = () => `audit-${Math.random().toString(36).slice(2, 10)}@audit.example`;
  {
    const ok = R(
      'live-login-parity',
      ['AUTH-005', 'AUTH-023', 'AUTH-027'],
      'Wrong password, unknown email and unknown workspace are indistinguishable',
    );
    const N = 5;
    const series = {
      'unknown workspace': [],
      'unknown email, real workspace': [],
      'real email, wrong password': [],
    };
    const keys = {
      'unknown workspace': new Set(),
      'unknown email, real workspace': new Set(),
      'real email, wrong password': new Set(),
    };
    let limited = false;
    for (let i = 0; i < N; i++) {
      const a = await http(base, 'POST', '/v2/auth/login', {
        json: {
          orgSlug: `no-such-org-${i}-${Date.now() % 1000}`,
          email: rnd(),
          password: 'Wr0ng-password!',
        },
      });
      series['unknown workspace'].push(a.ms);
      keys['unknown workspace'].add(problemKey(a));
      if (cred.org) {
        const b = await http(base, 'POST', '/v2/auth/login', {
          json: { orgSlug: cred.org, email: rnd(), password: 'Wr0ng-password!' },
        });
        series['unknown email, real workspace'].push(b.ms);
        keys['unknown email, real workspace'].add(problemKey(b));
        if (b.status === 429 || a.status === 429) limited = true;
      }
      if (haveCred && cred.org && i < 3) {
        const c = await http(base, 'POST', '/v2/auth/login', {
          json: { orgSlug: cred.org, email: cred.email, password: 'Wr0ng-password!' + i },
        });
        series['real email, wrong password'].push(c.ms);
        keys['real email, wrong password'].add(problemKey(c));
        if (c.status === 429) limited = true;
      }
    }
    const used = Object.entries(series).filter(([, v]) => v.length);
    const allKeys = new Set(used.flatMap(([k]) => [...keys[k]]));
    const meds = Object.fromEntries(used.map(([k, v]) => [k, Math.round(median(v))]));
    const medVals = Object.values(meds);
    const spread = medVals.length > 1 ? Math.max(...medVals) - Math.min(...medVals) : 0;
    const tolerance = Math.max(60, 0.5 * Math.max(...medVals, 1));
    const sameBody = allKeys.size === 1;
    const timingOk = spread <= tolerance;
    out.push(
      ok(limited ? 'error' : sameBody && timingOk ? 'pass' : sameBody ? 'partial' : 'fail', {
        severity: limited ? undefined : !sameBody ? 'high' : !timingOk ? 'medium' : undefined,
        summary: limited
          ? 'INCONCLUSIVE: the login throttle (429) fired during the probe — wait 5 minutes and re-run.'
          : `${used.map(([k]) => `${k}: ${meds[k]} ms median`).join('; ')}. Distinct responses: ${allKeys.size} (${[...allKeys].join(' / ')}). ${sameBody ? 'Bodies identical.' : 'RESPONSES DIFFER: account existence is observable.'} Timing spread ${Math.round(spread)} ms (tolerance ${Math.round(tolerance)} ms)${timingOk ? '' : ' — exceeds tolerance'}. ${cred.org ? '' : 'Pass --org <slug> to include the real-workspace series. '}${haveCred ? '' : 'Pass credentials to include the wrong-password-on-real-account series. '}Timing from 3-5 samples is indicative only.`,
        data: { medians: meds },
      }),
    );
  }

  // ---- L7 lockout ------------------------------------------------------------------------------------------------
  if (cred.org) {
    const ok = R('live-lockout', ['AUTH-021', 'AUTH-022'], 'Repeated failures are throttled');
    const victim = rnd();
    let firstLimitedAt = null;
    for (let i = 1; i <= 9; i++) {
      const r = await http(base, 'POST', '/v2/auth/login', {
        json: { orgSlug: cred.org, email: victim, password: 'Wr0ng-password!' + i },
      });
      if (r.status === 429) {
        firstLimitedAt = i;
        break;
      }
    }
    out.push(
      ok(firstLimitedAt ? 'pass' : 'fail', {
        severity: firstLimitedAt ? undefined : 'high',
        summary: firstLimitedAt
          ? `A throwaway account was locked out on attempt ${firstLimitedAt} (policy default is 5 failures, so the 6th is refused).`
          : 'NINE consecutive wrong passwords from one address were all answered normally: no lockout or throttle engaged.',
      }),
    );
    out.push(
      R(
        'live-lockout-distributed',
        ['AUTH-022', 'AUTH-024'],
        'Source-address variation does not reset the account counter',
      )('info', {
        summary:
          'Not executed over HTTP: faking source addresses needs X-Forwarded-For trust, which a correct TRUST_PROXY setting forbids. The static check "login-throttling-design" documents that the counter key includes the IP.',
      }),
    );
  } else {
    notRun(
      'live-lockout',
      ['AUTH-021', 'AUTH-022'],
      'Repeated failures are throttled',
      'needs a real workspace slug (--org <slug> or AUTH_AUDIT_ORG).',
    );
  }

  // ---- L8 forgot-password parity --------------------------------------------------------------------------------
  if (haveCred && cred.org) {
    const ok = R(
      'live-forgot-parity',
      ['AUTH-056', 'AUTH-005', 'AUTH-061'],
      'Forgot-password answers identically for existing and unknown accounts',
    );
    const real = await http(base, 'POST', '/v2/auth/forgot-password', {
      json: { orgSlug: cred.org, email: cred.email },
    });
    const none = await http(base, 'POST', '/v2/auth/forgot-password', {
      json: { orgSlug: cred.org, email: rnd() },
    });
    const same =
      real.status === none.status &&
      JSON.stringify(real.json ?? real.text) === JSON.stringify(none.json ?? none.text);
    const dt = Math.abs(real.ms - none.ms);
    out.push(
      ok(same && dt < 150 ? 'pass' : same ? 'partial' : 'fail', {
        severity: same ? (dt < 150 ? undefined : 'low') : 'high',
        summary: `existing: ${real.status} in ${Math.round(real.ms)} ms; unknown: ${none.status} in ${Math.round(none.ms)} ms; bodies ${same ? 'identical' : 'DIFFER'}.`,
      }),
    );
  } else {
    notRun(
      'live-forgot-parity',
      ['AUTH-056'],
      'Forgot-password parity',
      'needs --org and a real account (--email/--password).',
    );
  }

  // ---- L9 session lifecycle -------------------------------------------------------------------------------------
  if (haveCred && cred.org) {
    const login = () =>
      http(base, 'POST', '/v2/auth/login', {
        json: { orgSlug: cred.org, email: cred.email, password: cred.password },
      });
    const session = (t) =>
      http(base, 'GET', '/v2/auth/session', { headers: { authorization: `Bearer ${t}` } });
    const refresh = (t) => http(base, 'POST', '/v2/auth/refresh', { json: { refreshToken: t } });
    const first = await login();
    if (first.json?.status !== 'authenticated') {
      const why =
        first.json?.status === 'mfa_required'
          ? 'this account has MFA on (the probe will not handle a second factor); use an account without MFA'
          : first.status === 429
            ? 'the login throttle fired — wait 5 minutes'
            : `login returned ${first.status} ${first.json?.code ?? ''}`;
      notRun(
        'live-session-lifecycle',
        ['AUTH-033', 'AUTH-036', 'AUTH-038'],
        'Session lifecycle',
        why,
      );
    } else {
      const t1 = first.json.tokens;
      const s1 = await session(t1.accessToken);
      // logout, then reuse
      await http(base, 'POST', '/v2/auth/logout', {
        json: { refreshToken: t1.refreshToken },
        headers: { authorization: `Bearer ${t1.accessToken}` },
      });
      const afterLogoutAccess = await session(t1.accessToken);
      const afterLogoutRefresh = await refresh(t1.refreshToken);
      const logoutOk =
        s1.status === 200 && afterLogoutAccess.status === 401 && afterLogoutRefresh.status === 401;
      out.push(
        R(
          'live-session-lifecycle',
          ['AUTH-033', 'AUTH-036'],
          'After logout the access AND refresh token are dead immediately',
        )(logoutOk ? 'pass' : 'fail', {
          severity: logoutOk ? undefined : 'critical',
          summary: `session before logout: ${s1.status}; same access token after logout: ${afterLogoutAccess.status}; refresh token after logout: ${afterLogoutRefresh.status}.`,
        }),
      );
      // refresh rotation + reuse detection
      const second = await login();
      if (second.json?.status === 'authenticated') {
        const a = second.json.tokens;
        const r2 = await refresh(a.refreshToken);
        const r3 = r2.json?.refreshToken ? await refresh(r2.json.refreshToken) : null;
        const replay = await refresh(a.refreshToken); // two rotations behind: must be refused as reuse
        const killedAccess = r3?.json?.accessToken ? await session(r3.json.accessToken) : null;
        const rotated =
          r2.status === 200 && r2.json?.refreshToken && r2.json.refreshToken !== a.refreshToken;
        const reuseCaught = replay.status === 401;
        const sessionRevoked = killedAccess?.status === 401;
        out.push(
          R(
            'live-refresh-reuse',
            ['AUTH-038', 'AUTH-036'],
            'Refresh tokens rotate; replaying an old one revokes the whole session',
          )(rotated && reuseCaught && sessionRevoked ? 'pass' : 'fail', {
            severity: rotated && reuseCaught && sessionRevoked ? undefined : 'critical',
            summary: `rotation changes the token: ${rotated}; replay of a token 2 rotations old → ${replay.status}; the session's newest access token afterwards → ${killedAccess?.status ?? 'n/a'} (401 = whole session revoked, as designed).`,
          }),
        );
        if (r3?.json?.refreshToken)
          await http(base, 'POST', '/v2/auth/logout', {
            json: { refreshToken: r3.json.refreshToken },
          });
      }
    }
  } else {
    notRun(
      'live-session-lifecycle',
      ['AUTH-033', 'AUTH-036', 'AUTH-038'],
      'Session lifecycle and refresh reuse',
      'needs a real account on a dev server: pass --org, --email and --password (or AUTH_AUDIT_ORG / _EMAIL / _PASSWORD). Use a seeded dev user, never a real one.',
    );
  }

  // ---- L10 realtime handshake -----------------------------------------------------------------------------------
  {
    const ok = R(
      'live-realtime-auth',
      ['AUTH-084'],
      'An unauthenticated WebSocket connect to /realtime is refused',
    );
    const open = await http(base, 'GET', '/socket.io/?EIO=4&transport=polling');
    const sid = /"sid":"([^"]+)"/.exec(open.text)?.[1];
    if (!sid) {
      out.push(
        ok('error', {
          summary: `NOT RUN: no socket.io handshake from ${base}/socket.io (status ${open.status}).`,
        }),
      );
    } else {
      await http(base, 'POST', `/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
        raw: '40/realtime,{}',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
      });
      await sleep(150);
      const poll = await http(base, 'GET', `/socket.io/?EIO=4&transport=polling&sid=${sid}`);
      const refused = /44\/realtime,.*unauthorized/i.test(poll.text);
      const accepted = /40\/realtime,\{"sid"/.test(poll.text);
      out.push(
        ok(refused ? 'pass' : accepted ? 'fail' : 'partial', {
          severity: accepted ? 'critical' : refused ? undefined : 'low',
          summary: refused
            ? 'Connect packet without credentials answered with CONNECT_ERROR "unauthorized".'
            : accepted
              ? 'AN UNAUTHENTICATED CLIENT WAS ACCEPTED INTO /realtime.'
              : `Inconclusive polling response: ${poll.text.slice(0, 120)}`,
        }),
      );
    }
  }

  // ---- L11 latency under a small burst --------------------------------------------------------------------------
  if (cred.org) {
    const ok = R(
      'live-login-latency',
      ['AUTH-095', 'AUTH-098'],
      'Login latency under a small concurrent burst',
    );
    const N = 10;
    const rs = await Promise.all(
      Array.from({ length: N }, () =>
        http(base, 'POST', '/v2/auth/login', {
          json: { orgSlug: cred.org, email: rnd(), password: 'Wr0ng-password!' },
        }),
      ),
    );
    const limited = rs.filter((r) => r.status === 429).length;
    const errs = rs.filter((r) => r.status === 0 || r.status >= 500).length;
    const ms = rs.map((r) => r.ms);
    out.push(
      ok(errs ? 'fail' : 'info', {
        severity: errs ? 'medium' : undefined,
        summary: `${N} concurrent failed logins: p50 ${Math.round(median(ms))} ms, p95 ${Math.round(pct(ms, 95))} ms, ${errs} server errors, ${limited} throttled. Indicative only; real load testing (k6, 100+ VUs, refresh and session validation paths) needs its own environment.`,
      }),
    );
  }

  // ---- not executable here ---------------------------------------------------------------------------------------
  notRun(
    'live-partner-revocation',
    ['AUTH-042', 'AUTH-038'],
    'A deactivated partner agent is refused',
    'needs a partner agent account. Steps to reproduce the suspected gap: sign in at POST /v2/auth/partner/login, deactivate the agent in the console, then call GET /v2/partner/… and POST /v2/auth/refresh with the old tokens; both should be 401 but the code reads as if they succeed.',
  );
  notRun(
    'live-redis-outage',
    ['AUTH-096', 'AUTH-097'],
    'Redis outage behaviour',
    'destructive by nature (stops Redis). Run it only in a disposable environment: `docker compose stop redis`, repeat a revoked-token request and a burst of failed logins, then `docker compose start redis`. The code review predicts: revoked tokens keep working until they expire and the login throttle stops counting.',
  );
  return out;
}

async function hs256(claims, secret) {
  const { createHmac } = await import('node:crypto');
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b({ alg: 'HS256', typ: 'JWT' });
  const body = b(claims);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
