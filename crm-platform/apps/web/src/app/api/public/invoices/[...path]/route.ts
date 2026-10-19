import { apiBase } from '@/lib/auth/server';
import { isSameOrigin, problem } from '@/lib/auth/proxy';
import { upstreamFetch } from '@/lib/auth/upstream';

/**
 * The buyer's calls (`/i/<token>`): relayed to the API's public invoice routes WITHOUT any session cookie, because the link's
 * token is the only credential and a staff member opening the link in their own browser must not act as staff. Only the public
 * invoice paths are reachable here (the invoice, its print view and PDF, and `pay`); the response is never cached or indexed.
 */
const FORWARD_REQUEST = [
  'content-type',
  'accept',
  'idempotency-key',
  'x-request-id',
  'accept-language',
  'user-agent',
];
const FORWARD_RESPONSE = ['content-type', 'content-disposition', 'x-request-id', 'retry-after'];
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const READ_ACTIONS = new Set(['print', 'pdf']);

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const [token, action, ...rest] = path;
  const mutating = req.method === 'POST';
  const known = mutating ? action === 'pay' : action === undefined || READ_ACTIONS.has(action);
  if (!token || !TOKEN.test(token) || rest.length > 0 || !known)
    return problem(404, 'NOT_FOUND', 'Not found');
  if (mutating && !isSameOrigin(req))
    return problem(403, 'FORBIDDEN', 'Cross-origin request refused');

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers.set('x-forwarded-for', ip);

  const target = `${apiBase()}/v2/public/invoices/${encodeURIComponent(token)}${action ? `/${action}` : ''}`;
  let upstream: Response;
  try {
    upstream = await upstreamFetch(target, {
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
