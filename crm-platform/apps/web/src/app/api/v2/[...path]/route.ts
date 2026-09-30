import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, setSessionCookies } from '@/lib/auth/cookies';
import { apiBase, refreshTokens } from '@/lib/auth/server';

const FORWARD_REQUEST = [
  'content-type',
  'accept',
  'idempotency-key',
  'x-request-id',
  'if-match',
  'accept-language',
];
const FORWARD_RESPONSE = ['content-type', 'x-request-id', 'etag', 'retry-after'];

function problem(status: number, code: string, title: string) {
  return NextResponse.json(
    { type: 'about:blank', title, status, code },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  // Token-issuing endpoints are handled by /api/auth/*; never hand raw tokens to page JavaScript.
  if (path[0] === 'auth') return problem(404, 'NOT_FOUND', 'Not found');

  const mutating = !['GET', 'HEAD'].includes(req.method);
  const origin = req.headers.get('origin');
  if (mutating && origin && new URL(origin).host !== new URL(req.url).host)
    return problem(403, 'FORBIDDEN', 'Cross-origin request refused');

  const url = new URL(req.url);
  const target = `${apiBase()}/v2/${path.map(encodeURIComponent).join('/')}${url.search}`;
  const body = mutating ? await req.arrayBuffer() : undefined;
  const store = await cookies();

  const call = (token: string | undefined) => {
    const headers = new Headers();
    for (const h of FORWARD_REQUEST) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (token) headers.set('authorization', `Bearer ${token}`);
    return fetch(target, { method: req.method, headers, body, cache: 'no-store' });
  };

  let upstream = await call(store.get(ACCESS_COOKIE)?.value);
  if (upstream.status === 401) {
    const rt = store.get(REFRESH_COOKIE)?.value;
    const tokens = rt ? await refreshTokens(rt) : null;
    if (tokens) {
      setSessionCookies(store, tokens);
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

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
