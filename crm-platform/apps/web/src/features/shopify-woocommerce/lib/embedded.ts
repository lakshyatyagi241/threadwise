/**
 * The Shopify embedded app (TW-ECOM-038): which requests Shopify loads in its admin iframe, and who may frame them.
 * Pure, so the header policy is tested without a server. Everything outside the `/shopify` pages keeps `frame-ancestors 'self'`.
 */

/** The only sites that may frame the embedded app: Shopify's admin and a store's own admin address. */
export const SHOPIFY_FRAME_ANCESTORS = 'https://admin.shopify.com https://*.myshopify.com';
/** Where `/shopify` with Shopify's `host` and `shop` is served from (outside the app shell: no menu, no sign-in redirect). */
export const EMBEDDED_PATH = '/shopify/embedded';

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
/** `host` is Shopify's base64 of the admin address; it is opaque to us, only its shape is checked. */
const HOST = /^[A-Za-z0-9_=-]{1,512}$/;

/** `/shopify` and `/shopify/embedded` (with an optional trailing slash): the only paths this policy touches. */
export const isShopifyPath = (pathname: string): boolean =>
  /^\/shopify(?:\/embedded)?\/?$/.test(pathname);

/** A request that carries Shopify's `host` and a valid `shop`: Shopify is loading the app in its admin. */
export function isShopifyEmbeddedRequest(search: URLSearchParams): boolean {
  const host = search.get('host') ?? '';
  const shop = search.get('shop') ?? '';
  return HOST.test(host) && SHOP.test(shop);
}

/**
 * The frame headers for a `/shopify` page. Framing by Shopify only when the request carries `host` and `shop` (or is the embedded
 * page itself, which only exists to be framed); the staff screen opened directly keeps the app-wide policy. X-Frame-Options cannot
 * name a list, so it is sent only when the page is not framed by Shopify.
 */
export function shopifyFrameHeaders(
  pathname: string,
  search: URLSearchParams,
): Record<string, string> {
  const embedded =
    pathname.replace(/\/+$/, '') === EMBEDDED_PATH || isShopifyEmbeddedRequest(search);
  return embedded
    ? { 'Content-Security-Policy': `frame-ancestors ${SHOPIFY_FRAME_ANCESTORS}` }
    : { 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' };
}
