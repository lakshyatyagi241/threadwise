import 'server-only';
import { clientIpFrom } from '@/lib/auth/client-ip';
import { apiBase } from '@/lib/auth/server';

/** Request headers the chat widget's pages and calls need to reach the API unchanged. */
const FORWARD = [
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'range',
  'if-none-match',
  'x-visitor-uuid',
  'x-widget-session',
  'x-requested-with',
  'access-control-request-method',
  'access-control-request-headers',
];

/** What the response must not carry over: the body is already decoded and re-framed here. */
const DROP = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

/**
 * The widget's pages (`/widget/<token>/chat`, `/embed`, its `api/*` calls) and assets are served by the API, but the snippet and the
 * Preview link use this app's address. This hands them to the API at request time, reading the API's address from the environment
 * when the request arrives (not when the app was built, which is why this is not a `next.config` rewrite).
 */
export async function proxyWidget(req: Request, segments: string[]): Promise<Response> {
  const url = new URL(req.url);
  const target = `${apiBase().replace(/\/+$/, '')}/${segments.map(encodeURIComponent).join('/')}${url.search}`;
  const headers = new Headers();
  for (const name of FORWARD) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = clientIpFrom(req.headers);
  if (ip) headers.set('x-forwarded-for', ip);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return new Response('Chat widget is unavailable right now.', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const out = new Headers(upstream.headers);
  for (const name of DROP) out.delete(name);
  return new Response(req.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
