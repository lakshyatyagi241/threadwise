import { NextResponse, type NextRequest } from 'next/server';
import { referralCookieFor } from '@/features/auth-registration-security/guest/referral';
import { REQUEST_PATH_HEADER } from '@/lib/auth/next-path';
import {
  EMBEDDED_PATH,
  isShopifyEmbeddedRequest,
  isShopifyPath,
  shopifyFrameHeaders,
} from '@/features/shopify-woocommerce/lib/embedded';
import { formKeyOf, frameAncestorsFor, frameHeaders } from '@/features/web-forms/lib/frame-headers';

/**
 * Runs before every page request (not API routes or static files).
 *
 * 1. Tells server components which page was asked for (`x-crm-path`), so a layout that has to send a signed-out
 *    visitor to sign-in can carry `?next=` with it (TW-AUTH-001/011). Any value the browser sent is overwritten.
 * 2. Remembers a referral code: a `?ref=` on any page becomes an httpOnly, lax, 30-day cookie, set here on the
 *    server (TW-AUTH-005). The code is cleaned to A-Z0-9 and dropped if it is empty or longer than 16.
 * 3. Frames: a form page (`/f/<key>`) is the one route that may be framed by other sites, per form (Forms add-on, spec section 7.3).
 *    `next.config.ts` leaves `/f/*` out of the blanket `frame-ancestors 'self'`; this sets the real policy for it. It is the only
 *    path that answers asynchronously, because it reads that form's allow-list.
 * 4. Shopify's admin (TW-ECOM-038): `/shopify` carrying Shopify's `host` and `shop` is served by the embedded page (no app shell, no
 *    sign-in redirect) and may be framed by Shopify only. `next.config.ts` leaves the `/shopify` pages out of the blanket policy; this
 *    sets it for them, falling back to the app-wide one when the request is not Shopify's.
 */
export function proxy(request: NextRequest): NextResponse | Promise<NextResponse> {
  const headers = new Headers(request.headers);
  const { pathname, search } = request.nextUrl;
  headers.set(REQUEST_PATH_HEADER, `${pathname}${search}`);

  const shopify = isShopifyPath(pathname);
  const toEmbedded =
    shopify && pathname === '/shopify' && isShopifyEmbeddedRequest(request.nextUrl.searchParams);
  const response = toEmbedded
    ? NextResponse.rewrite(new URL(`${EMBEDDED_PATH}${search}`, request.url), {
        request: { headers },
      })
    : NextResponse.next({ request: { headers } });
  if (shopify) {
    for (const [name, value] of Object.entries(
      shopifyFrameHeaders(pathname, request.nextUrl.searchParams),
    ))
      response.headers.set(name, value);
  }

  if (request.method === 'GET') {
    const secure =
      request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
    const cookie = referralCookieFor(request.nextUrl.searchParams.get('ref'), secure);
    if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
  }

  const formKey = formKeyOf(pathname);
  if (formKey)
    return framedForm(response, formKey, request.nextUrl.searchParams.get('embed') === '1');
  return response;
}

async function framedForm(
  response: NextResponse,
  key: string,
  embed: boolean,
): Promise<NextResponse> {
  const ancestors = embed
    ? await frameAncestorsFor(key, process.env.API_URL ?? 'http://localhost:3000')
    : null;
  for (const [name, value] of Object.entries(frameHeaders(embed, ancestors)))
    response.headers.set(name, value);
  return response;
}

export const config = {
  // Pages only: skip API routes, Next internals and anything with a file extension.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
