import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ACCESS_COOKIE,
  ORG_COOKIE,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  clearSessionCookies,
  setSessionCookies,
} from '@/lib/auth/cookies';
import { isSameOrigin, problem } from '@/lib/auth/proxy';
import { apiBase, refreshTokens } from '@/lib/auth/server';

/**
 * Session-issuing endpoints (ADR-0018): the browser calls these, the server calls
 * the API, and any token pair that comes back goes into httpOnly cookies. The
 * response body never contains a token, only what the page needs to route on.
 */

const YEAR = 60 * 60 * 24 * 365;

/** action -> upstream path (POST). `refresh` is a GET redirect handled below. */
const UPSTREAM: Record<string, string | ((body: Record<string, unknown>) => string)> = {
  login: '/v2/auth/login',
  mfa: '/v2/auth/login/mfa',
  signup: '/v2/auth/signup',
  'signup-otp': '/v2/auth/signup/verify-otp',
  switch: '/v2/auth/workspaces/switch',
  'social-callback': (b) =>
    `/v2/auth/social/${encodeURIComponent(String(b.provider ?? ''))}/callback`,
};

const SAFE_SLUG = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/);

/** Only same-site relative paths, so this cannot be turned into an open redirect. */
function safeNext(value: string | null): string {
  return value && /^\/(?![/\\])[\w\-./?=&%]*$/.test(value) ? value : '/';
}

function forwardHeaders(req: Request, token?: string): Headers {
  const h = new Headers({ 'Content-Type': 'application/json' });
  for (const name of ['x-request-id', 'user-agent', 'accept-language']) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) h.set('x-forwarded-for', ip);
  if (!h.has('x-request-id')) h.set('x-request-id', crypto.randomUUID());
  if (token) h.set('authorization', `Bearer ${token}`);
  return h;
}

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const store = await cookies();

  if (action === 'logout') {
    const at = store.get(ACCESS_COOKIE)?.value;
    if (at) {
      // Best effort: revoke the server-side session, then clear cookies regardless.
      await fetch(`${apiBase()}/v2/auth/logout`, {
        method: 'POST',
        headers: forwardHeaders(req, at),
        body: '{}',
        cache: 'no-store',
      }).catch(() => undefined);
    }
    clearSessionCookies(store);
    return new NextResponse(null, { status: 204 });
  }

  const target = UPSTREAM[action];
  if (!target) return problem(404, 'NOT_FOUND', 'Not found');

  if (!isSameOrigin(req)) {
    return problem(403, 'FORBIDDEN', 'Cross-origin request refused');
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return problem(400, 'VALIDATION_FAILED', 'Invalid body');
  const path = typeof target === 'function' ? target(body) : target;
  // `provider` is only for building the path; the API does not take it in the body.
  const { provider: _provider, ...payload } = body;
  void _provider;

  const upstream = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: forwardHeaders(req, action === 'switch' ? store.get(ACCESS_COOKIE)?.value : undefined),
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const text = await upstream.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!upstream.ok) {
    return new NextResponse(text || null, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/problem+json',
        ...(upstream.headers.get('x-request-id')
          ? { 'x-request-id': upstream.headers.get('x-request-id')! }
          : {}),
      },
    });
  }

  if (json.status === 'authenticated' && json.tokens) {
    const remember = payload.remember === true;
    setSessionCookies(store, json.tokens as never, { remember });
    // Remember which workspace this browser signs in to (not a credential).
    // The API names the organization the session belongs to; the request only does for password sign-in.
    const slug = SAFE_SLUG.safeParse(json.orgSlug ?? payload.orgSlug);
    if (slug.success) {
      store.set(ORG_COOKIE, slug.data, { path: '/', maxAge: YEAR, sameSite: 'lax' });
    }
    const { tokens: _tokens, ...safe } = json;
    void _tokens;
    return NextResponse.json(safe);
  }
  // mfa_required / otp_required carry no credentials.
  return NextResponse.json(json);
}

/** GET /api/auth/refresh?next=/path: rotate the session, then send the browser back where it was going. */
export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action !== 'refresh') return problem(404, 'NOT_FOUND', 'Not found');

  const url = new URL(req.url);
  const store = await cookies();
  const rt = store.get(REFRESH_COOKIE)?.value;
  const tokens = rt ? await refreshTokens(rt) : null;
  if (!tokens) {
    clearSessionCookies(store);
    return NextResponse.redirect(new URL('/login?expired=1', url));
  }
  setSessionCookies(store, tokens, { remember: store.get(REMEMBER_COOKIE)?.value === '1' });
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get('next')), url));
}
