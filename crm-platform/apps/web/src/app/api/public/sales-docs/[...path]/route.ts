import { apiBase } from '@/lib/auth/server';
import { isSameOrigin, problem } from '@/lib/auth/proxy';

/**
 * The buyer's calls (`/q/<token>`): relayed to the API's public sales-docs routes WITHOUT any session cookie, because the link's
 * token is the only credential and a staff member opening the link in their own browser must not act as staff. Only the
 * sales-docs public paths are reachable here; the response is never cached or indexed.
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
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const ACTIONS = new Set(['accept', 'decline']);

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const [token, action, ...rest] = path;
  if (
    !token ||
    !TOKEN.test(token) ||
    rest.length > 0 ||
    (action !== undefined && !ACTIONS.has(action))
  ) {
    return problem(404, 'NOT_FOUND', 'Not found');
  }
  const mutating = req.method === 'POST';
  if (mutating && !isSameOrigin(req))
    return problem(403, 'FORBIDDEN', 'Cross-origin request refused');
  if ((mutating && !action) || (!mutating && action))
    return problem(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // The API records the buyer's address with the decision (who signed, from where).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers.set('x-forwarded-for', ip);

  const target = `${apiBase()}/v2/public/sales-docs/${encodeURIComponent(token)}${action ? `/${action}` : ''}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: mutating ? await req.arrayBuffer() : undefined,
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

export { handler as GET, handler as POST };
