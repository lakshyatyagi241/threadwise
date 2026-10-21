#!/usr/bin/env node
// Own-code DAST baseline (the fallback when OWASP ZAP cannot run, and a cheap complement when it can).
// Walks the live OpenAPI document of a LOCAL API and checks the classic problems. Refuses any non-local target.
//   node tools/security/vapt/dast.mjs --base http://localhost:3922 --out reports/vapt/dast.json
// Identities: tenant A admin + viewer, tenant B admin (see tools/security/vapt.sh for how they are seeded).
// Finding shape: { id, severity, title, evidence }. Exit 0 always; vapt.sh decides on severity.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:3922');
const OUT = arg('out', 'reports/vapt/dast.json');
const host = new URL(BASE).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`refusing non-local target ${BASE}`);
  process.exit(2);
}
const PW = process.env.VAPT_PASSWORD ?? 'Passw0rd!';
const USERS = {
  adminA: process.env.VAPT_ADMIN_A ?? 'nachiket.challawar@geta.ai',
  adminB: process.env.VAPT_ADMIN_B ?? 'nachiket.challawar+ten@geta.ai',
  viewerA: process.env.VAPT_VIEWER_A ?? 'viewer@admin.test',
};
const findings = [];
const add = (id, severity, title, evidence) => findings.push({ id, severity, title, evidence });

const call = async (method, path, { token, headers = {}, body } = {}) => {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text };
  } catch (e) {
    return { status: 0, headers: new Headers(), text: String(e) };
  }
};
const login = async (email) => {
  const r = await call('POST', '/v2/auth/login', { body: { email, password: PW } });
  try {
    return JSON.parse(r.text).tokens?.accessToken;
  } catch {
    return undefined;
  }
};

const doc = JSON.parse((await call('GET', '/docs-json')).text);
const ops = [];
for (const [p, item] of Object.entries(doc.paths))
  for (const m of ['get', 'post', 'put', 'patch', 'delete'])
    if (item[m]) ops.push({ method: m.toUpperCase(), path: p, op: item[m] });
const fill = (p) => p.replace(/\{[^}]+\}/g, '00000000-0000-0000-0000-000000000001');
// sessions we need to keep, and long-lived streams
const SKIP = /\/auth\/(logout|login|refresh)|\/realtime|\/stream|\/events$/;
// Intentionally public surfaces (signature/token-verified webhooks, public pages, auth bootstrap, docs, health).
const PUBLIC =
  /^\/(health|ready|live|metrics|docs|v2\/auth|v2\/platform\/auth|v2\/public|public|p\/|webhooks?|v2\/webhooks?|hooks?|api\/v1|v2\/i18n\/languages|v2\/setup\/status|v2\/shopify\/embedded\/config)|\/(webhooks?|callback|oauth|public|unsubscribe|receipt|track|verify|lookup|widget|embed|submit|booking|return)(\/|$)/i;

const tokens = {};
for (const [k, e] of Object.entries(USERS)) tokens[k] = await login(e);
const noLogin = Object.keys(tokens).filter((k) => !tokens[k]);
if (noLogin.length)
  add(
    'DAST-SETUP',
    'Info',
    'Seeded identities could not log in; authenticated checks skipped',
    noLogin.join(','),
  );

// 1. missing authentication: every non-public route without a token must not answer 2xx
const unauth = [];
const serverErrors = [];
for (const { method, path } of ops) {
  if (SKIP.test(path)) continue;
  const r = await call(method, fill(path), {
    body: method === 'GET' || method === 'DELETE' ? undefined : {},
  });
  if (r.status >= 500) serverErrors.push(`${method} ${path} -> ${r.status}`);
  if (/\n\s+at .*\(.*:\d+:\d+\)/.test(r.text) || /node_modules|\.ts:\d+/.test(r.text))
    add(
      'DAST-STACK',
      'Medium',
      'Stack trace or source path in a response',
      `${method} ${path}: ${r.text.slice(0, 200)}`,
    );
  if (r.status >= 200 && r.status < 300 && !PUBLIC.test(path))
    unauth.push(`${method} ${path} -> ${r.status}`);
}
if (unauth.length)
  add(
    'DAST-NOAUTH',
    'High',
    `${unauth.length} non-allow-listed routes answered 2xx with no token (triage each)`,
    unauth.slice(0, 40).join('\n'),
  );
if (serverErrors.length)
  add(
    'DAST-5XX',
    'Low',
    `${serverErrors.length} unauthenticated requests ended in a 5xx`,
    serverErrors.slice(0, 25).join('\n'),
  );

// 2. privilege escalation: a viewer must not reach platform/operator/admin routes
if (tokens.viewerA) {
  const bad = [];
  for (const { method, path } of ops) {
    if (!/\/(platform|operator|admin)\//.test(path) || SKIP.test(path)) continue;
    const r = await call(method, fill(path), {
      token: tokens.viewerA,
      body: method === 'GET' || method === 'DELETE' ? undefined : {},
    });
    if (r.status >= 200 && r.status < 300) bad.push(`${method} ${path} -> ${r.status}`);
  }
  if (bad.length)
    add(
      'DAST-PRIVESC',
      'Critical',
      'Tenant viewer reached platform/admin routes',
      bad.slice(0, 40).join('\n'),
    );
}

// 3. headers, CORS, method override, redirects, login throttle
const h = (await call('GET', '/v2/auth/password-policy')).headers;
const need = {
  'x-content-type-options': /nosniff/i,
  'x-frame-options': /./,
  'content-security-policy': /./,
};
const missing = Object.keys(need).filter((k) => !need[k].test(h.get(k) ?? ''));
if (h.get('x-powered-by'))
  add('DAST-HDR-POWERED', 'Low', 'X-Powered-By is exposed', h.get('x-powered-by'));
if (missing.length)
  add('DAST-HDR', 'Low', 'Security headers missing on an API response', missing.join(', '));
const cors = await call('GET', '/v2/auth/password-policy', {
  headers: { origin: 'https://evil.example' },
});
if (
  cors.headers.get('access-control-allow-origin') === 'https://evil.example' &&
  cors.headers.get('access-control-allow-credentials') === 'true'
)
  add(
    'DAST-CORS',
    'High',
    'CORS reflects an arbitrary origin with credentials',
    'GET /v2/auth/password-policy',
  );
for (const ho of ['x-http-method-override', 'x-method-override', 'x-http-method']) {
  const r = await call('GET', '/v2/contacts', {
    token: tokens.viewerA,
    headers: { [ho]: 'DELETE' },
  });
  if (r.status === 204)
    add('DAST-METHOD-OVERRIDE', 'Medium', `${ho} changes the verb`, `status ${r.status}`);
}
const REDIR = /^(redirect|return_?to|next|url|callback)/i;
for (const { path, op } of ops
  .filter(
    (o) =>
      o.method === 'GET' &&
      !SKIP.test(o.path) &&
      (o.op.parameters ?? []).some((p) => REDIR.test(p.name)),
  )
  .slice(0, 20)) {
  const p = op.parameters.find((x) => REDIR.test(x.name));
  const r = await call('GET', `${fill(path)}?${p.name}=https://evil.example/x`, {
    token: tokens.adminA,
  });
  const loc = r.headers.get('location') ?? '';
  if (r.status >= 300 && r.status < 400 && /evil\.example/.test(loc))
    add('DAST-OPEN-REDIRECT', 'Medium', 'Open redirect', `${path}?${p.name} -> ${loc}`);
}
// 45 bad logins for made-up addresses must hit the 40-per-5-min IP ceiling (429) (bounded, local only)
let throttled = false;
for (let i = 0; i < 45 && !throttled; i++)
  throttled =
    (
      await call('POST', '/v2/auth/login', {
        body: { email: `nobody${i}@vapt.test`, password: `wrong-${i}` },
      })
    ).status === 429;
if (!throttled)
  add(
    'DAST-LOGIN-THROTTLE',
    'Medium',
    'No 429 after 12 bad logins from one client',
    'POST /v2/auth/login',
  );

mkdirSync(dirname(OUT), { recursive: true });
const counts = findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {});
writeFileSync(OUT, JSON.stringify({ base: BASE, routes: ops.length, counts, findings }, null, 2));
console.log(`DAST: ${ops.length} operations walked; findings ${JSON.stringify(counts)} -> ${OUT}`);
