import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  REFERRAL_COOKIE,
  withReferralFallback,
} from '@/features/auth-registration-security/guest/referral';
import {
  ACCESS_COOKIE,
  ORG_COOKIE,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  clearSessionCookies,
  setSessionCookies,
} from '@/lib/auth/cookies';
import { clientIpFrom } from '@/lib/auth/client-ip';
import { logoutStaff } from '@/lib/auth/logout';
import { loginPath, safeNextPath } from '@/lib/auth/next-path';
import { isSameOrigin, problem, redirectTo } from '@/lib/auth/proxy';
import { rememberForAction } from '@/lib/auth/remember';
import { apiBase, refreshTokens } from '@/lib/auth/server';

/**
 * Session-issuing endpoints: the browser calls these, the server calls
 * the API, and any token pair that comes back goes into httpOnly cookies. The
 * response body never contains a token, only what the page needs to route on.
 */

const YEAR = 60 * 60 * 24 * 365;

/** action -> upstream path (POST). `refresh` is a GET redirect handled below. */
const UPSTREAM: Record<string, string | ((body: Record<string, unknown>) => string)> = {
  login: '/v2/auth/login',
  mfa: '/v2/auth/login/mfa',
  'login-workspace': '/v2/auth/login/workspace',
  signup: '/v2/auth/signup',
  'signup-otp': '/v2/auth/signup/verify-otp',
  switch: '/v2/auth/workspaces/switch',
  'accept-invite': '/v2/workspace/invitations/accept',
  'social-callback': (b) =>
    `/v2/auth/social/${encodeURIComponent(String(b.provider ?? ''))}/callback`,
};

const SAFE_SLUG = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/);

/** Only same-site relative paths, so this cannot be turned into an open redirect. */
function safeNext(value: string | null): string {
  return safeNextPath(value) ?? '/';
}

/**
 * Whether administrators allow "keep me signed in". A social sign-in has no checkbox, and Reference always
 * remembers it, so the long session applies unless the platform turned remembering off. Fails closed: when the
 * setting cannot be read the session is not remembered.
 */
async function rememberMeAllowed(): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/v2/auth/registration-config`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { rememberMeEnabled?: unknown };
    return json.rememberMeEnabled === true;
  } catch {
    return false;
  }
}

function forwardHeaders(req: Request, token?: string): Headers {
  const h = new Headers({ 'Content-Type': 'application/json' });
  for (const name of ['x-request-id', 'user-agent', 'accept-language']) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  const ip = clientIpFrom(req.headers);
  if (ip) h.set('x-forwarded-for', ip);
  if (!h.has('x-request-id')) h.set('x-request-id', crypto.randomUUID());
  if (token) h.set('authorization', `Bearer ${token}`);
  return h;
}

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const store = await cookies();

  if (action === 'logout') {
    // Always completes (no origin check): a logout that fails is worse than a forged one.
    await logoutStaff(req);
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
  // A sign-up that left the referral box empty still counts the link that brought the visitor here.
  const outgoing =
    action === 'signup' || action === 'social-callback'
      ? withReferralFallback(payload, store.get(REFERRAL_COOKIE)?.value)
      : payload;

  const upstream = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: forwardHeaders(req, action === 'switch' ? store.get(ACCESS_COOKIE)?.value : undefined),
    body: JSON.stringify(outgoing),
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
        // A lockout or rate limit says how long to wait; the page reads it from here or from the body.
        ...(upstream.headers.get('retry-after')
          ? { 'retry-after': upstream.headers.get('retry-after')! }
          : {}),
      },
    });
  }

  if (json.status === 'authenticated' && json.tokens) {
    // The API states whether it opened a long session (`remember`), and that decides the cookie lifetime. Only an
    // answer without it falls back to the request-side rules: the checkbox for password and code sign-ins, the
    // choice this browser already made for a switch, and "remembered unless the platform turned it off" for social.
    const fromApi = typeof json.remember === 'boolean' ? json.remember : undefined;
    const remember = rememberForAction({
      fromApi,
      action,
      requested: payload.remember,
      cookie: store.get(REMEMBER_COOKIE)?.value,
      platformAllows:
        action === 'social-callback' && fromApi === undefined ? await rememberMeAllowed() : false,
    });
    setSessionCookies(store, json.tokens as never, { remember });
    // The account exists now, so the referral link has done its job (Reference forgets it at the same point).
    if ((action === 'signup' || action === 'signup-otp') && store.get(REFERRAL_COOKIE)) {
      store.delete(REFERRAL_COOKIE);
    }
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
    // Back to sign-in with the page they were after, so signing in again lands there.
    return redirectTo(loginPath(url.searchParams.get('next'), { expired: true }));
  }
  setSessionCookies(store, tokens, { remember: store.get(REMEMBER_COOKIE)?.value === '1' });
  return redirectTo(safeNext(url.searchParams.get('next')));
}
