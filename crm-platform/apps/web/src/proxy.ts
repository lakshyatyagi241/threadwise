import { NextResponse, type NextRequest } from 'next/server';
import { referralCookieFor } from '@/features/auth-registration-security/guest/referral';
import { REQUEST_PATH_HEADER } from '@/lib/auth/next-path';

/**
 * Runs before every page request (not API routes or static files).
 *
 * 1. Tells server components which page was asked for (`x-crm-path`), so a layout that has to send a signed-out
 *    visitor to sign-in can carry `?next=` with it (TW-AUTH-001/011). Any value the browser sent is overwritten.
 * 2. Remembers a referral code: a `?ref=` on any page becomes an httpOnly, lax, 30-day cookie, set here on the
 *    server (TW-AUTH-005). The code is cleaned to A-Z0-9 and dropped if it is empty or longer than 16.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const { pathname, search } = request.nextUrl;
  headers.set(REQUEST_PATH_HEADER, `${pathname}${search}`);

  const response = NextResponse.next({ request: { headers } });

  if (request.method === 'GET') {
    const secure =
      request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
    const cookie = referralCookieFor(request.nextUrl.searchParams.get('ref'), secure);
    if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}

export const config = {
  // Pages only: skip API routes, Next internals and anything with a file extension.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
