import 'server-only';
import { cookies } from 'next/headers';
import { apiBase } from '@/lib/auth/server';
import { cookieNames } from '@/lib/auth/cookies';
import { upstreamFetch } from '@/lib/auth/upstream';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True only when the API positively answers "no such coupon" (or the id cannot be one), so the edit page can answer HTTP 404.
 * Any other outcome (no session cookie, an expired token, a server error) returns false and the page's own client-side
 * loading and error states take over: this check never blocks a page on a guess.
 */
export async function couponIsMissing(id: string): Promise<boolean> {
  if (!UUID.test(id)) return true;
  try {
    const at = (await cookies()).get(cookieNames('operator').access)?.value;
    if (!at) return false;
    const res = await upstreamFetch(`${apiBase()}/v2/platform/coupons/${id}`, {
      headers: { Authorization: `Bearer ${at}` },
      cache: 'no-store',
    });
    return res.status === 404;
  } catch {
    return false;
  }
}
