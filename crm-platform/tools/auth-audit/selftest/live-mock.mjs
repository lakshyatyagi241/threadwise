// Self-test for the live probes: runs them against an in-process mock of the API's authentication behaviour, once with a
// CORRECT mock (everything must pass) and once with a deliberately BROKEN one (the probes must notice).
// This is how we know the probes can fail. Run: node tools/auth-audit/selftest/live-mock.mjs

import { createServer } from 'node:http';
import { runLiveProbes } from '../lib/checks-live.mjs';

function startMock({ broken = false } = {}) {
  const sessions = new Map(); // sid -> { rv, revoked }
  const fails = new Map(); // email -> count
  let n = 0;
  const send = (res, status, body, headers = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'content-type': typeof body === 'string' ? 'text/plain' : 'application/problem+json',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'SAMEORIGIN',
      'content-security-policy': "default-src 'none'",
      'cache-control': 'no-store',
      ...headers,
    });
    res.end(text);
  };
  const problem = (res, status, code, detail) =>
    send(res, status, { type: 'about:blank', title: 'x', status, code, detail });
  const tokensFor = (sid, rv) => ({
    accessToken: `A:${sid}:${rv}`,
    refreshToken: `R:${sid}:${rv}`,
    expiresIn: 900,
  });
  const alive = (t) => {
    const m = /^A:(\w+):(\d+)$/.exec(t ?? '');
    const s = m && sessions.get(m[1]);
    return Boolean(s && !s.revoked);
  };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      let json = null;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {
        if (req.url.startsWith('/v2/'))
          return broken
            ? send(res, 500, 'Error: boom\n    at Object.<anonymous> (C:\\app\\src\\x.ts:1:1)')
            : problem(res, 400, 'VALIDATION', 'Malformed JSON');
      }
      if (url.pathname === '/v2/auth/password-policy') return send(res, 200, { minLength: 8 });
      if (url.pathname === '/v2/auth/session') {
        if (broken && auth.split('.')[0] && auth.includes('.')) return send(res, 200, { ok: true }); // accepts forged JWTs
        return alive(auth)
          ? send(res, 200, { user: 1 })
          : problem(res, 401, 'UNAUTHENTICATED', 'Invalid or expired token');
      }
      if (req.method === 'OPTIONS')
        return send(
          res,
          204,
          '',
          broken
            ? {
                'access-control-allow-origin': req.headers.origin,
                'access-control-allow-credentials': 'true',
              }
            : {},
        );
      if (url.pathname === '/v2/auth/login') {
        if (!json || typeof json.email !== 'string' || typeof json.password !== 'string')
          return problem(res, 400, 'VALIDATION', 'Invalid body');
        const known = json.email === 'dev@acme.test' && json.password === 'Passw0rd!';
        if (json.orgSlug && json.orgSlug.startsWith('no-such-org') && broken)
          return problem(res, 404, 'ORG_NOT_FOUND', 'No such workspace'); // enumeration oracle
        if (known) {
          const sid = `s${++n}`;
          sessions.set(sid, { rv: 1, revoked: false });
          return send(
            res,
            200,
            { status: 'authenticated', tokens: tokensFor(sid, 1) },
            { 'content-type': 'application/json' },
          );
        }
        const c = (fails.get(json.email) ?? 0) + 1;
        fails.set(json.email, c);
        if (!broken && c > 5)
          return problem(res, 429, 'AUTH_ACCOUNT_LOCKED', 'Too many failed attempts.');
        return problem(res, 401, 'AUTH_INVALID_CREDENTIALS', 'Those credentials do not match.');
      }
      if (url.pathname === '/v2/auth/forgot-password')
        return send(res, 200, { ok: true }, { 'content-type': 'application/json' });
      if (url.pathname === '/v2/auth/logout') {
        const m = /^R:(\w+):/.exec(json?.refreshToken ?? '');
        const a = /^A:(\w+):/.exec(auth);
        for (const sid of [m?.[1], a?.[1]])
          if (sid && sessions.has(sid) && !broken) sessions.get(sid).revoked = true;
        return send(res, 200, { ok: true }, { 'content-type': 'application/json' });
      }
      if (url.pathname === '/v2/auth/refresh') {
        const m = /^R:(\w+):(\d+)$/.exec(json?.refreshToken ?? '');
        const s = m && sessions.get(m[1]);
        if (!s || s.revoked)
          return problem(res, 401, 'UNAUTHENTICATED', 'Invalid or expired refresh token');
        const presented = Number(m[2]);
        if (presented === s.rv) {
          s.rv++;
          return send(res, 200, tokensFor(m[1], s.rv), { 'content-type': 'application/json' });
        }
        if (presented === s.rv - 1)
          return send(res, 200, tokensFor(m[1], s.rv), { 'content-type': 'application/json' });
        if (!broken) s.revoked = true;
        return broken
          ? send(res, 200, tokensFor(m[1], s.rv), { 'content-type': 'application/json' })
          : problem(res, 401, 'UNAUTHENTICATED', 'Invalid or expired refresh token');
      }
      if (url.pathname === '/socket.io/') {
        if (req.method === 'GET' && !url.searchParams.get('sid'))
          return send(res, 200, '0{"sid":"abc","upgrades":[],"pingInterval":25000}');
        if (req.method === 'POST') return send(res, 200, 'ok');
        return send(
          res,
          200,
          broken ? '40/realtime,{"sid":"zzz"}' : '44/realtime,{"message":"unauthorized"}',
        );
      }
      return problem(res, 404, 'NOT_FOUND', 'nope');
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

let failures = 0;
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? '  ok ' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

for (const broken of [false, true]) {
  console.log(`\n${broken ? 'BROKEN' : 'CORRECT'} mock`);
  const { server, base } = await startMock({ broken });
  const results = await runLiveProbes({
    opts: { live: base, org: 'acme', email: 'dev@acme.test', password: 'Passw0rd!' },
  });
  server.close();
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  const s = (id) => by[id]?.status;
  if (!broken) {
    for (const id of [
      'live-unauthenticated-access',
      'live-forged-tokens',
      'live-error-hygiene',
      'live-security-headers',
      'live-cors',
      'live-login-parity',
      'live-lockout',
      'live-forgot-parity',
      'live-session-lifecycle',
      'live-refresh-reuse',
      'live-realtime-auth',
    ]) {
      expect(
        `${id} passes against a correct server`,
        s(id) === 'pass',
        `${s(id)}: ${by[id]?.summary?.slice(0, 140)}`,
      );
    }
  } else {
    expect('forged tokens are detected', s('live-forged-tokens') === 'fail');
    expect('internals in error bodies are detected', s('live-error-hygiene') === 'fail');
    expect('CORS reflection is detected', s('live-cors') === 'policy');
    expect(
      'enumeration oracle is detected',
      s('live-login-parity') === 'fail',
      by['live-login-parity']?.summary?.slice(0, 120),
    );
    expect('missing lockout is detected', s('live-lockout') === 'fail');
    expect('session surviving logout is detected', s('live-session-lifecycle') === 'fail');
    expect('refresh reuse not caught is detected', s('live-refresh-reuse') === 'fail');
    expect('unauthenticated websocket accepted is detected', s('live-realtime-auth') === 'fail');
  }
}
console.log(failures ? `\n${failures} self-test failure(s)` : '\nlive probes self-test passed');
process.exit(failures ? 1 : 0);
