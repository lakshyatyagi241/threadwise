import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  OP_ACCESS_COOKIE,
  OP_REFRESH_COOKIE,
  clearSessionCookies,
  setSessionCookies,
} from '@/lib/auth/cookies';
import { isSameOrigin, problem } from '@/lib/auth/proxy';
import { apiBase, refreshTokens } from '@/lib/auth/server';

/** Platform-operator sign-in (a separate identity pool and cookie set, ADR-0019). */
const UPSTREAM: Record<string, string> = {
  login: '/v2/platform/auth/login',
  mfa: '/v2/platform/auth/login/mfa',
};

function safeNext(value: string | null): string {
  return value && /^\/(?![/\\])[\w\-./?=&%]*$/.test(value) ? value : '/admin';
}

function headersFor(req: Request, token?: string): Headers {
  const h = new Headers({ 'Content-Type': 'application/json' });
  for (const name of ['x-request-id', 'user-agent']) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) h.set('x-forwarded-for', ip);
  if (token) h.set('authorization', `Bearer ${token}`);
  return h;
}

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const store = await cookies();

  if (action === 'logout') {
    const at = store.get(OP_ACCESS_COOKIE)?.value;
    if (at) {
      await fetch(`${apiBase()}/v2/platform/auth/logout`, {
        method: 'POST',
        headers: headersFor(req, at),
        body: '{}',
        cache: 'no-store',
      }).catch(() => undefined);
    }
    clearSessionCookies(store, 'operator');
    return new NextResponse(null, { status: 204 });
  }

  const path = UPSTREAM[action];
  if (!path) return problem(404, 'NOT_FOUND', 'Not found');
  if (!isSameOrigin(req)) {
    return problem(403, 'FORBIDDEN', 'Cross-origin request refused');
  }

  const upstream = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: headersFor(req),
    body: await req.text(),
    cache: 'no-store',
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    return new NextResponse(text || null, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/problem+json',
      },
    });
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  if (json.status === 'authenticated' && json.tokens) {
    setSessionCookies(store, json.tokens as never, { kind: 'operator' });
    const { tokens: _tokens, ...safe } = json;
    void _tokens;
    return NextResponse.json(safe);
  }
  return NextResponse.json(json);
}

export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action !== 'refresh') return problem(404, 'NOT_FOUND', 'Not found');
  const url = new URL(req.url);
  const store = await cookies();
  const rt = store.get(OP_REFRESH_COOKIE)?.value;
  const tokens = rt ? await refreshTokens(rt, 'operator') : null;
  if (!tokens) {
    clearSessionCookies(store, 'operator');
    return NextResponse.redirect(new URL('/admin/login?expired=1', url));
  }
  setSessionCookies(store, tokens, { kind: 'operator' });
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get('next')), url));
}
