import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { cookieNames, setSessionCookies, REMEMBER_COOKIE, type SessionKind } from './cookies';
import { clientIpFrom } from './client-ip';
import { apiBase, refreshTokens } from './server';
import { isUpstreamTimeout, upstreamFetch } from './upstream';

const FORWARD_REQUEST = [
  'content-type',
  'accept',
  'idempotency-key',
  'x-request-id',
  'if-match',
  'accept-language',
  'user-agent',
  'x-forwarded-for',
  // The Help assistant's model calls name their task (the API refuses a call without it).
  'x-help-agent-task',
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
  'auth/signup/set-password',
  'auth/workspaces/switch',
  'auth/partner/login',
  'auth/clerk/session',
  'auth/logout',
  // The act-as token of an operator impersonation: only /impersonate (a route handler) may receive it.
  'auth/impersonation/redeem',
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
  // Fetch Metadata (sent by every current browser, and not settable by page script): a write that is not from this site, or only from a
  // sibling subdomain (same-site), is refused even when the Origin header is missing or odd. `none` is a user-typed address.
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
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

/**
 * A redirect that keeps the browser on the host it asked. `NextResponse.redirect` needs an absolute address, and
 * the one the server sees is its own bind address (not the public host), which would send the visitor, and their
 * cookies, to the wrong place. A relative `Location` is valid HTTP and resolves against the page's own origin.
 */
export function redirectTo(path: string, status: 303 | 307 = 307): Response {
  return new Response(null, { status, headers: { Location: path, 'Cache-Control': 'no-store' } });
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
    // The API records the caller's address; this proxy is the only client it sees. Only the
    // entries our own proxies appended are believed (see client-ip.ts).
    const ip = clientIpFrom(req.headers);
    if (ip) headers.set('x-forwarded-for', ip);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return upstreamFetch(target, { method: req.method, headers, body, cache: 'no-store' });
  };

  // The API being down or silent is an answer the browser can act on (retry, show a banner), not an unhandled 500 or a hang.
  const unavailable = (e: unknown) =>
    isUpstreamTimeout(e)
      ? problem(504, 'UPSTREAM_TIMEOUT', 'The service took too long to answer')
      : problem(502, 'UPSTREAM_UNAVAILABLE', 'The service is unavailable');

  let upstream: Response;
  try {
    upstream = await call(store.get(names.access)?.value);
  } catch (e) {
    return unavailable(e);
  }
  if (upstream.status === 401) {
    const rt = store.get(names.refresh)?.value;
    const tokens = rt ? await refreshTokens(rt, kind) : null;
    if (tokens) {
      setSessionCookies(store, tokens, {
        kind,
        remember: store.get(REMEMBER_COOKIE)?.value === '1',
      });
      try {
        upstream = await call(tokens.accessToken);
      } catch (e) {
        return unavailable(e);
      }
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
