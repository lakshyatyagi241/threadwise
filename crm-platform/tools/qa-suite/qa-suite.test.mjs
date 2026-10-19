// The QA suite's own tests: the parsers, and the live checks against a mock API that behaves correctly and one that does not.
//   node --test tools/qa-suite/qa-suite.test.mjs
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

// ---- mock API ------------------------------------------------------------------------------------------------------------------
let mode = 'good'; // 'good' | 'bad'
const SECRET = 'test-secret',
  GRACE_MS = 1000;
const sessions = new Map(); // sid -> { rv, rotatedAt, revoked }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (p) => createHmac('sha256', SECRET).update(p).digest('base64url');
const access = (sid) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }),
    p = b64({ sid, exp: Math.floor(Date.now() / 1000) + 900 });
  return `${h}.${p}.${sign(`${h}.${p}`)}`;
};
const verify = (tok) => {
  const [h, p, g] = String(tok ?? '').split('.');
  if (!h || !p) return null;
  if (mode === 'good' && !g) return null;
  try {
    if (mode === 'bad' && JSON.parse(Buffer.from(h, 'base64url')).alg === 'none')
      return JSON.parse(Buffer.from(p, 'base64url'));
    if (mode === 'good' && sign(`${h}.${p}`) !== g) return null;
    const pl = JSON.parse(Buffer.from(p, 'base64url'));
    if (pl.exp < Date.now() / 1000 && mode === 'good') return null;
    return pl;
  } catch {
    return null;
  }
};
const refreshTok = (sid, rv) => `${sid}.${rv}`;
let server, base;
before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const send = (code, o, h = {}) => {
        res.writeHead(code, {
          'content-type': 'application/json',
          'x-content-type-options': 'nosniff',
          ...h,
        });
        res.end(JSON.stringify(o));
      };
      let j = {};
      try {
        j = JSON.parse(body || '{}');
      } catch {
        /* */
      }
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, ''),
        claims = verify(bearer);
      const live =
        claims &&
        (mode === 'bad' || (sessions.get(claims.sid) && !sessions.get(claims.sid).revoked));
      if (url.pathname === '/health') return send(200, { ok: true });
      if (mode === 'bad' && /pg_sleep|sleep/.test(decodeURIComponent(req.url)))
        return setTimeout(() => send(200, { data: [] }), 3600);
      if (mode === 'bad' && /'/.test(decodeURIComponent(url.search)))
        return send(500, { detail: 'syntax error at or near "\'" SQLSTATE 42601' });
      if (url.pathname === '/v2/auth/login' && req.method === 'POST') {
        if (j.password !== 'pw' || j.email !== 'a@b.test')
          return send(401, { title: 'bad credentials' });
        const sid = randomUUID();
        sessions.set(sid, { rv: 0, rotatedAt: 0, revoked: false });
        return send(200, {
          status: 'authenticated',
          tokens: { accessToken: access(sid), refreshToken: refreshTok(sid, 0) },
        });
      }
      if (url.pathname === '/v2/auth/refresh') {
        const [sid, rvs] = String(j.refreshToken ?? '').split('.');
        const s = sessions.get(sid);
        const rv = Number(rvs);
        if (!s || s.revoked || Number.isNaN(rv)) return send(401, { title: 'invalid' });
        if (rv === s.rv) {
          s.rv++;
          s.rotatedAt = Date.now();
          return send(200, { accessToken: access(sid), refreshToken: refreshTok(sid, s.rv) });
        }
        if (rv === s.rv - 1 && Date.now() - s.rotatedAt <= GRACE_MS)
          return send(200, { accessToken: access(sid), refreshToken: refreshTok(sid, s.rv) });
        if (mode === 'good') s.revoked = true;
        return send(401, { title: 'reuse' });
      }
      if (url.pathname === '/v2/auth/logout') {
        const sid = claims?.sid ?? String(j.refreshToken ?? '').split('.')[0];
        if (sessions.get(sid) && mode === 'good') sessions.get(sid).revoked = true;
        if (mode === 'bad' && sessions.get(sid)) {
          /* client-side logout only: server keeps the session alive */
        }
        return send(200, { ok: true });
      }
      if (url.pathname === '/v2/auth/session')
        return live
          ? send(200, { user: 1 }, { 'cache-control': 'no-store' })
          : send(401, { title: 'unauthorised' });
      if (url.pathname === '/v2/auth/registration-config') return send(200, { ok: true });
      if (url.pathname === '/v2/contacts') return live ? send(200, { data: [] }) : send(401, {});
      send(404, { title: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    API_URL: base,
    QA_EMAIL: 'a@b.test',
    QA_PASSWORD: 'pw',
    QA_REFRESH_GRACE: '1',
    QA_REPEAT: '2',
    QA_INJECTION_MAX: '5',
    QA_INJECTION_ROUTES: '/v2/contacts',
  });
});
after(() => server.close());

const status = (r, id) => r.checks.find((c) => c.id === id)?.status;

describe('schema parser', () => {
  it('reads tables, composite keys, indexes and RLS from SQL', async () => {
    const { buildSchema, covered } = await import('./lib/schema.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'qa-sql-')),
      f = join(dir, '0001.sql');
    writeFileSync(
      f,
      `CREATE TABLE contacts (org_id bigint NOT NULL, id bigint NOT NULL, email text, owner_id bigint, PRIMARY KEY (org_id, id),
      FOREIGN KEY (org_id, owner_id) REFERENCES users (org_id, id));
      CREATE INDEX idx_c_email ON contacts (org_id, email);
      ALTER TABLE contacts ENABLE ROW LEVEL SECURITY; ALTER TABLE contacts FORCE ROW LEVEL SECURITY;`,
    );
    const t = buildSchema([f]).get('contacts');
    assert.deepEqual(t.pk, ['org_id', 'id']);
    assert.equal(t.fks.length, 1);
    assert.ok(t.rls && t.forced);
    assert.ok(covered(t, ['org_id', 'email']));
    assert.ok(!covered(t, ['org_id', 'owner_id']), 'the FK on owner_id has no index');
  });
});

describe('injection classifier', () => {
  it('separates literals, constants, request data and the rest', async () => {
    const { classify } = await import('./lib/sql-template.mjs');
    const consts = new Set(['COLS']);
    assert.equal(classify("'a.id'", consts), 'safe');
    assert.equal(classify('COLS', consts), 'safe');
    assert.equal(classify('`d.${column}`', consts), 'request');
    assert.equal(classify('`ORDER BY ${sort}`', consts), 'request');
    assert.equal(classify('`x.${alias}.id`', consts), 'review');
  });
});

describe('cpu profile reader', () => {
  it('ranks functions by self time', async () => {
    const { topSelfTime } = await import('./tasks/59-cpu-profiling.mjs');
    const top = topSelfTime(
      {
        nodes: [
          { id: 1, callFrame: { functionName: 'hot', url: 'file:///a.js', lineNumber: 4 } },
          { id: 2, callFrame: { functionName: 'cold', url: 'file:///b.js', lineNumber: 1 } },
        ],
        samples: [1, 1, 1, 2],
        timeDeltas: [1000, 1000, 1000, 1000],
      },
      2,
    );
    assert.match(top[0], /75\.0%.*hot/);
  });
});

describe('live checks against a correct API', () => {
  it('session expiry: every scenario passes and none is flaky', async () => {
    mode = 'good';
    const r = await (await import('./tasks/17-session-expiry.mjs')).default.run({ args: [] });
    const live = r.checks.filter((c) => c.id.startsWith('live-'));
    assert.equal(live.length, 16);
    assert.deepEqual(
      live.filter((c) => c.status !== 'pass').map((c) => `${c.id}: ${c.detail}`),
      [],
    );
  });
  it('injection: payloads cause no 5xx and no delay', async () => {
    mode = 'good';
    const r = await (await import('./tasks/30-injection.mjs')).default.run({ args: [] });
    assert.equal(status(r, 'inj-live-5xx'), 'pass');
    assert.equal(status(r, 'inj-live-time'), 'pass');
  });
  it('xss: the API never reflects a payload as HTML', async () => {
    mode = 'good';
    const r = await (await import('./tasks/31-xss.mjs')).default.run({ args: [] });
    assert.equal(status(r, 'xss-live-api'), 'pass');
  });
  it('stress: finds a step and reports recovery', async () => {
    mode = 'good';
    Object.assign(process.env, { QA_PEAK_RPS: '10', QA_STAGE_SEC: '1', QA_STRESS_STEPS: '1,2,3' });
    const r = await (await import('./tasks/54-stress.mjs')).default.run({ args: ['--stress'] });
    assert.equal(status(r, 'stress-2x'), 'pass');
    assert.equal(status(r, 'stress-recovery'), 'pass');
  });
  it('profiling: stores p50/p95/p99 per endpoint', async () => {
    mode = 'good';
    Object.assign(process.env, { QA_PROFILE_RPS: '10', QA_PROFILE_SEC: '1' });
    const r = await (await import('./tasks/59-cpu-profiling.mjs')).default.run({ args: [] });
    assert.equal(status(r, 'perf-artifact'), 'pass');
    assert.ok(r.checks.some((c) => /p50/.test(c.title)));
  });
});

describe('live checks catch a broken API', () => {
  it('session expiry: server-side revocation, alg=none and reuse failures are reported', async () => {
    mode = 'bad';
    const r = await (await import('./tasks/17-session-expiry.mjs')).default.run({ args: [] });
    const st = Object.fromEntries(
      r.checks
        .filter((c) => c.id.startsWith('live-'))
        .map((c) => [c.id, `${c.status}: ${c.detail}`]),
    );
    for (const id of ['live-SE06', 'live-SE08', 'live-SE12'])
      assert.match(st[id], /^fail/, `${id} -> ${st[id]}`);
  });
  it('injection: 5xx with database detail and time-based execution are reported', async () => {
    mode = 'bad';
    const r = await (await import('./tasks/30-injection.mjs')).default.run({ args: [] });
    assert.equal(status(r, 'inj-live-5xx'), 'fail');
    assert.equal(status(r, 'inj-live-time'), 'fail');
  });
  it('refuses to attack a non-local target', async () => {
    const { requireLocal } = await import('./lib/core.mjs');
    assert.match(requireLocal('https://crm.example.com'), /refusing non-local/);
    assert.equal(requireLocal('http://localhost:3000'), null);
  });
});
