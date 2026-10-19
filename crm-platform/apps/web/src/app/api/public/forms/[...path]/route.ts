import { apiBase } from '@/lib/auth/server';
import { isSameOrigin, problem } from '@/lib/auth/proxy';
import { matchPublicPath } from '@/features/web-forms/lib/public-paths';
import { upstreamFetch } from '@/lib/auth/upstream';

/**
 * The visitor's relay: forwards a short allowlist of calls to the API's public form routes WITHOUT any session cookie, because a
 * form's key is its only identifier and a staff member filling a form in their own browser must not act as staff. The allowlist
 * (method plus path shape) is `matchPublicPath`; the response is never cached or indexed.
 */
const FORWARD_REQUEST = [
  'content-type',
  'accept',
  'idempotency-key',
  'x-request-id',
  'accept-language',
  'user-agent',
  'origin',
  // Global Privacy Control: the browser's own statement of the visitor's choice, passed on so the API can record the opt-out (BL-180).
  'sec-gpc',
];
const FORWARD_RESPONSE = ['content-type', 'x-request-id', 'retry-after'];

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const match = matchPublicPath(req.method, path);
  if (!match.ok)
    return problem(
      match.status,
      match.status === 404 ? 'NOT_FOUND' : 'METHOD_NOT_ALLOWED',
      'Not found',
    );
  if (match.hasBody && !isSameOrigin(req))
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
    upstream = await upstreamFetch(`${apiBase()}/v2/public/forms/${match.path}`, {
      method: match.method,
      headers,
      body: match.hasBody ? await req.arrayBuffer() : undefined,
      cache: 'no-store',
    });
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
  return new Response([204, 304].includes(upstream.status) ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export { handler as GET, handler as HEAD, handler as POST };
