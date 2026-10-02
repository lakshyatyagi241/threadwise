import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { cookieNames, setSessionCookies, REMEMBER_COOKIE, type SessionKind } from './cookies';
import { apiBase, refreshTokens } from './server';

const FORWARD_REQUEST = [
  'content-type',
  'accept',
  'idempotency-key',
  'x-request-id',
  'if-match',
  'accept-language',
  'user-agent',
  'x-forwarded-for',
  // Audio and video in a thread seek with byte ranges (the media route answers them).
  'range',
];
const FORWARD_RESPONSE = [
  'content-type',
  'x-request-id',
  'etag',
  'retry-after',
  'cache-control',
  'x-content-type-options',
  // Uploaded brand files (SVG) are served with a sandboxing policy that must reach the browser.
  'content-security-policy',
  'cross-origin-resource-policy',
  // A downloaded customer file keeps its name, and a ranged read reports which bytes it got.
  'content-disposition',
  'content-range',
  'accept-ranges',
];

/**
 * Endpoints that return a token pair. They are handled by `/api/auth/*`, which
 * puts the tokens in httpOnly cookies; the generic proxy must never relay them
 * to page JavaScript.
 */
const TOKEN_ISSUING = new Set([
  'auth/login',
  'auth/staff/login',
  'auth/login/mfa',
  'auth/refresh',
  'auth/signup',
  'auth/signup/verify-otp',
  'auth/workspaces/switch',
  'auth/partner/login',
  'auth/clerk/session',
  'auth/logout',
]);
const isTokenIssuing = (path: string[]) => {
  const joined = path.join('/');
  return TOKEN_ISSUING.has(joined) || /^auth\/social\/[^/]+\/callback$/.test(joined);
};

/**
 * CSRF guard for cookie-authenticated writes. The page's own host is what the
 * client addressed (`Host`, or `X-Forwarded-Host` behind a proxy), not `req.url`,
 * which `next dev` rewrites to its bind address.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host');
  try {
    return new URL(origin).host === (host ?? new URL(req.url).host);
  } catch {
    return false;
  }
}

export function problem(status: number, code: string, title: string) {
  return NextResponse.json(
    { type: 'about:blank', title, status, code },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/**
 * Same-origin proxy to the API for one identity pool: adds the bearer token,
 * refreshes once on a 401, refuses cross-origin writes and token-issuing paths.
 */
export async function proxyRequest(req: Request, path: string[], kind: SessionKind) {
  if (kind === 'user' && isTokenIssuing(path)) return problem(404, 'NOT_FOUND', 'Not found');

  const mutating = !['GET', 'HEAD'].includes(req.method);
  if (mutating && !isSameOrigin(req)) {
    return problem(403, 'FORBIDDEN', 'Cross-origin request refused');
  }

  const upstreamPrefix = kind === 'operator' ? '/v2/platform' : '/v2';
  const url = new URL(req.url);
  const target = `${apiBase()}${upstreamPrefix}/${path.map(encodeURIComponent).join('/')}${url.search}`;
  const body = mutating ? await req.arrayBuffer() : undefined;
  const store = await cookies();
  const names = cookieNames(kind);

  const call = (token: string | undefined) => {
    const headers = new Headers();
    for (const h of FORWARD_REQUEST) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    // The API records the caller's address; this proxy is the only client it sees.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (ip) headers.set('x-forwarded-for', ip);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return fetch(target, { method: req.method, headers, body, cache: 'no-store' });
  };

  let upstream = await call(store.get(names.access)?.value);
  if (upstream.status === 401) {
    const rt = store.get(names.refresh)?.value;
    const tokens = rt ? await refreshTokens(rt, kind) : null;
    if (tokens) {
      setSessionCookies(store, tokens, {
        kind,
        remember: store.get(REMEMBER_COOKIE)?.value === '1',
      });
      upstream = await call(tokens.accessToken);
    }
  }
  const headers = new Headers();
  for (const h of FORWARD_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response([204, 304].includes(upstream.status) ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
