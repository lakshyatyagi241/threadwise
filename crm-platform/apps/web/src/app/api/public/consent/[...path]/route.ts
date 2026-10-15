import { apiBase } from '@/lib/auth/server';
import { isSameOrigin, problem } from '@/lib/auth/proxy';

/**
 * The email unsubscribe page's calls (`/u/<token>`): relayed to the API's public unsubscribe route WITHOUT any session cookie, because
 * the link's token is the only credential. Only `GET` (is the link valid) and `POST` (unsubscribe) for one token are reachable.
 */
const FORWARD_REQUEST = [
  'content-type',
  'accept',
  'idempotency-key',
  'x-request-id',
  'accept-language',
  'user-agent',
];
const FORWARD_RESPONSE = ['content-type', 'x-request-id', 'retry-after'];
const TOKEN = /^[A-Za-z0-9_.-]{16,200}$/;

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const [token, ...rest] = path;
  if (!token || !TOKEN.test(token) || rest.length > 0)
    return problem(404, 'NOT_FOUND', 'Not found');
  const mutating = req.method === 'POST';
  if (mutating && !isSameOrigin(req))
    return problem(403, 'FORBIDDEN', 'Cross-origin request refused');

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers.set('x-forwarded-for', ip);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiBase()}/v2/public/consent/unsubscribe/${encodeURIComponent(token)}`,
      {
        method: req.method,
        headers,
        body: mutating ? await req.arrayBuffer() : undefined,
        cache: 'no-store',
      },
    );
  } catch {
    return problem(502, 'UPSTREAM_UNAVAILABLE', 'The service is not reachable');
  }
  const out = new Headers();
  for (const h of FORWARD_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set('cache-control', 'no-store');
  out.set('x-robots-tag', 'noindex, nofollow');
  out.set('referrer-policy', 'no-referrer');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { handler as GET, handler as POST };
