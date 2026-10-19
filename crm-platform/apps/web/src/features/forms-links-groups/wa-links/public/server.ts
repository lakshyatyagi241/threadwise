import 'server-only';
import { headers } from 'next/headers';
import { apiBase } from '@/lib/auth/server';
import { upstreamFetch } from '@/lib/auth/upstream';

export type WaChatLinkResolveResult =
  | { status: 'ok'; url: string }
  | { status: 'missing' }
  | { status: 'gone' }
  | { status: 'unavailable' };

const SLUG = /^[a-z0-9-]{1,64}$/;

/**
 * Resolves a public click-to-chat link (`/l/:slug`) by asking the API's own `WaChatLinkRedirectController` for its
 * Location header, without following it. The API owns the click counter and the per-address throttle
 * (`WaLinkRedirectThrottle`); this is a thin relay (no API route is reachable at the web app's own origin), so the
 * visitor's address is forwarded for that throttle to key on the real caller, not this server.
 */
export async function resolveWaChatLink(slug: string): Promise<WaChatLinkResolveResult> {
  if (!SLUG.test(slug)) return { status: 'missing' };
  const incoming = await headers();
  const forwardedFor = incoming.get('x-forwarded-for');
  const realIp = incoming.get('x-real-ip');
  let res: Response;
  try {
    res = await upstreamFetch(`${apiBase()}/l/${encodeURIComponent(slug)}`, {
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
        ...(realIp ? { 'x-real-ip': realIp } : {}),
      },
    });
  } catch {
    return { status: 'unavailable' };
  }
  if (res.status === 404) return { status: 'missing' };
  if (res.status === 410) return { status: 'gone' };
  const location = res.headers.get('location');
  if ([301, 302, 307, 308].includes(res.status) && location) {
    return { status: 'ok', url: location };
  }
  return { status: 'unavailable' };
}
