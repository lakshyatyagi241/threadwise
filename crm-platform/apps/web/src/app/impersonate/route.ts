import { cookies } from 'next/headers';
import { redeemImpersonationResponseSchema } from '@crm/contracts';
import { clearSessionCookies, setImpersonationCookie } from '@/lib/auth/cookies';
import { clientIpFrom } from '@/lib/auth/client-ip';
import { redirectTo } from '@/lib/auth/proxy';
import { apiBase } from '@/lib/auth/server';

const ENDED = '/impersonate/ended';
/** Where the operator lands: the customer's inbox, as Reference does (TW-WSP-032 rule 4). */
const LANDING = '/inbox';

/**
 * GET /impersonate?code=...: the operator's click lands here (the API's start call returned this URL). The one-time code is
 * exchanged server-to-server for the act-as access token, which becomes the normal httpOnly auth cookie; there is no refresh
 * cookie, so the session ends when the token does. The code in the address bar is spent by then, and the redirect drops it.
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) return redirectTo(`${ENDED}?why=invalid`);

  const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
  for (const name of ['x-request-id', 'user-agent', 'accept-language']) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  const ip = clientIpFrom(req.headers);
  if (ip) headers.set('x-forwarded-for', ip);

  const upstream = await fetch(`${apiBase()}/v2/auth/impersonation/redeem`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code }),
    cache: 'no-store',
  }).catch(() => null);
  const parsed = upstream?.ok
    ? redeemImpersonationResponseSchema.safeParse(await upstream.json().catch(() => null))
    : null;
  if (!parsed?.success) return redirectTo(`${ENDED}?why=invalid`);

  const store = await cookies();
  // Anything left from a previous session in this browser (a refresh token above all) must not outlive or renew this one.
  clearSessionCookies(store);
  setImpersonationCookie(store, parsed.data.accessToken, parsed.data.expiresIn);
  return redirectTo(LANDING, 303);
}
