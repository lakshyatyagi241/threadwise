// Shared helpers for the QA suite: file walking, check results, optional live connections.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const rel = (p) => relative(ROOT, p);
const SKIP = new Set([
  'node_modules',
  'dist',
  'dist-cli',
  'build',
  '.next',
  'coverage',
  '.turbo',
  'out',
  '.git',
  '.results',
]);

export function* walk(dir, test = () => true) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, test);
    else if (test(p) && statSync(p).size < 2_000_000) yield p;
  }
}
export const read = (p) => readFileSync(p, 'utf8');
export const isTest = (p) => /(\.test\.|\.spec\.|\/test\/|\/e2e\/|__tests__)/.test(p);
export const apiSrc = () => [
  ...walk(join(ROOT, 'apps/api/src'), (p) => p.endsWith('.ts') && !isTest(p)),
];
export const migrations = () =>
  [...walk(join(ROOT, 'packages/db/migrations'), (p) => p.endsWith('.sql'))].sort();
export const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// Check builders. status: pass | fail | warn | skip. `skip` always carries the reason it could not run.
export const pass = (id, title, detail = '', evidence = []) => ({
  id,
  title,
  status: 'pass',
  detail,
  evidence,
});
export const fail = (id, title, detail = '', evidence = [], severity = 'high') => ({
  id,
  title,
  status: 'fail',
  severity,
  detail,
  evidence,
});
export const warn = (id, title, detail = '', evidence = []) => ({
  id,
  title,
  status: 'warn',
  severity: 'low',
  detail,
  evidence,
});
export const skip = (id, title, reason) => ({
  id,
  title,
  status: 'skip',
  detail: reason,
  evidence: [],
});
/** A check that passes when `findings` is empty, otherwise fails (or warns) with the findings as evidence. */
export const expectNone = (
  id,
  title,
  findings,
  { level = 'fail', severity = 'high', okDetail = '' } = {},
) =>
  findings.length === 0
    ? pass(id, title, okDetail)
    : (level === 'warn' ? warn : (a, b, c, d) => fail(a, b, c, d, severity))(
        id,
        title,
        `${findings.length} finding(s)`,
        findings.slice(0, Number(process.env.QA_MAX_EVIDENCE) || 40),
      );

// Live environment. Everything live is opt-in: no URL / no database means the check is reported as skipped, never as passed.
export const env = {
  api: process.env.API_URL ?? process.env.QA_API_URL,
  web: process.env.WEB_URL ?? process.env.QA_WEB_URL,
  db: process.env.DATABASE_URL ?? process.env.QA_DATABASE_URL,
  org: process.env.QA_ORG,
  email: process.env.QA_EMAIL,
  password: process.env.QA_PASSWORD,
};
export const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:|\/|$)/;
/** Refuses to aim attack traffic at anything that is not a local host. */
export function requireLocal(url) {
  if (!url) return 'no URL configured (set API_URL / WEB_URL)';
  if (!LOCAL.test(url))
    return `refusing non-local target ${url}: this suite only attacks localhost`;
  return null;
}
export async function pgClient() {
  if (!env.db) return { error: 'DATABASE_URL not set' };
  for (const base of ['packages/db', 'apps/api', '.']) {
    try {
      const { Client } = createRequire(join(ROOT, base, 'package.json'))('pg');
      const c = new Client({ connectionString: env.db });
      await c.connect();
      return { client: c };
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND')
        return { error: `database connection failed: ${e.message}` };
    }
  }
  return { error: 'the pg package is not installed (run pnpm install)' };
}
export async function http(method, path, { body, headers = {}, token, timeout = 15000 } = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(env.api + path, {
      method,
      signal: AbortSignal.timeout(timeout),
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status, text, json, headers: r.headers, ms: performance.now() - t0 };
  } catch (e) {
    return { status: 0, text: '', error: e.message, ms: performance.now() - t0 };
  }
}
const findKey = (o, k) => {
  if (!o || typeof o !== 'object') return undefined;
  if (typeof o[k] === 'string') return o[k];
  for (const v of Object.values(o)) {
    const r = findKey(v, k);
    if (r) return r;
  }
};
/** Signs in a LOCAL dev account through the real login route. API prefix is /v2 (URI versioning). */
export async function login(over = {}) {
  const org = over.org ?? env.org,
    email = over.email ?? env.email,
    password = over.password ?? env.password;
  if (!email || !password)
    return { error: 'set QA_EMAIL and QA_PASSWORD (a LOCAL dev account; QA_ORG optional)' };
  const r = await http('POST', '/v2/auth/login', {
    body: { ...(org ? { orgSlug: org } : {}), email, password },
  });
  const token = findKey(r.json, 'accessToken');
  return token
    ? { token, refresh: findKey(r.json, 'refreshToken'), res: r }
    : { error: `login failed (HTTP ${r.status}) ${r.error ?? r.json?.title ?? ''}` };
}
export function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
}
// Reviewed findings: tools/qa-suite/data/baseline.json = { "<task id>": [{ "key": "<file>|<snippet>", "reason": "<why this is fine>" }] }.
// A finding in the baseline is a human-reviewed exception (the reason is required); anything else counts as unreviewed.
const keyOf = (ev) => ev.replace(/:\d+/, '').replace(/\s+/g, ' ').trim();
export function unreviewed(taskId, items) {
  let b = {};
  try {
    b = JSON.parse(readFileSync(join(ROOT, 'tools/qa-suite/data/baseline.json'), 'utf8'));
  } catch {
    /* none yet */
  }
  const ok = new Set((b[taskId] ?? []).filter((e) => e.reason).map((e) => e.key));
  return items.filter((i) => !ok.has(keyOf(i)));
}
export const exists = (p) => existsSync(join(ROOT, p));
