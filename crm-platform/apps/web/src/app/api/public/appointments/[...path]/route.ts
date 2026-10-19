import { matchPublicPath, slotsQuery } from '@/features/appointments/lib/public-paths';
import { isSameOrigin, problem } from '@/lib/auth/proxy';
import { apiBase } from '@/lib/auth/server';

/**
 * The visitor's calls (`/book/<org>/<service>` and `/b/manage/<token>`): relayed to the API's public appointments routes WITHOUT
 * any session cookie, because the page address or the manage link's secret is the only credential, and a staff member opening
 * the link in their own browser must not act as staff. Only the paths and methods listed in `lib/public-paths.ts` are
 * reachable; the response is never cached or indexed.
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
/** A booking page picture is public and its address carries a version, so unlike everything else here it may be cached. */
const FORWARD_ASSET = [
  'etag',
  'cache-control',
  'x-content-type-options',
  'content-security-policy',
];
/** A booking is a few fields and answers; anything bigger is not from our page. */
const MAX_BODY_BYTES = 64 * 1024;

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const match = matchPublicPath(req.method, path);
  if (!match.ok) {
    return match.status === 404
      ? problem(404, 'NOT_FOUND', 'Not found')
      : problem(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  const mutating = match.method === 'POST';
  if (mutating && !isSameOrigin(req))
    return problem(403, 'FORBIDDEN', 'Cross-origin request refused');

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // The API rate-limits and records the visitor's address, not this server's.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers.set('x-forwarded-for', ip);

  let body: ArrayBuffer | undefined;
  if (mutating) {
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES)
      return problem(413, 'PAYLOAD_TOO_LARGE', 'Request too large');
  }

  const query = match.hasQuery ? slotsQuery(new URL(req.url).searchParams) : '';
  const target = `${apiBase()}/v2/public/${match.path}${query}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: match.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
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
  if (match.asset && upstream.ok) {
    for (const h of FORWARD_ASSET) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set('x-content-type-options', 'nosniff');
  }
  out.set('x-robots-tag', 'noindex, nofollow');
  out.set('referrer-policy', 'no-referrer');
  return new Response([204, 304].includes(upstream.status) ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export { handler as GET, handler as POST, handler as HEAD };
