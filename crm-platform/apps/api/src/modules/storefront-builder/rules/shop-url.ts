import type { StorefrontEnv } from '../../../config/domains/storefront-builder.env';
import { digitsOnly } from './phone';

export interface ShopAddress {
  slug: string;
  customDomain: string | null;
  customDomainVerified: boolean;
}

/**
 * The address buyers use (WD-STORE-022): the verified custom domain, else `https://<slug>.<STOREFRONT_HOST>` when that host
 * is a real one, else `<web app>/s/<slug>`.
 */
export function publicUrl(shop: ShopAddress, env: StorefrontEnv): string {
  if (shop.customDomain && shop.customDomainVerified) return `https://${shop.customDomain}`;
  if (env.storefrontHost) return `https://${shop.slug}.${env.storefrontHost}`;
  return `${env.webAppUrl}/s/${shop.slug}`;
}

/**
 * The origin the shop's own pages (`/s/<slug>/order/<token>`) are served from. On a custom domain or a subdomain the path form
 * works on the same host, so links keep that host; otherwise they live on the web app. (WaDesk built the Razorpay callback
 * as `<domain>/order/<token>`, a route that does not exist: this gives the right one.)
 */
export function pagesOrigin(shop: ShopAddress, env: StorefrontEnv): string {
  if (shop.customDomain && shop.customDomainVerified) return `https://${shop.customDomain}`;
  if (env.storefrontHost) return `https://${shop.slug}.${env.storefrontHost}`;
  return env.webAppUrl;
}

const TOTAL_SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

/**
 * WaDesk's `WaOrder::total_display`: one of four symbols (any other currency shows its code), a space, and always two decimals
 * with thousands separators. The confirmation text and the tracking page's Total use it; card prices do not.
 */
export function totalDisplay(minor: number, code: string): string {
  const text = (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${TOTAL_SYMBOLS[code] ?? code} ${text}`;
}

export const trackPath = (slug: string, token: string): string => `/s/${slug}/order/${token}`;

export const trackUrl = (shop: ShopAddress, token: string, env: StorefrontEnv): string =>
  `${pagesOrigin(shop, env)}${trackPath(shop.slug, token)}`;

/**
 * `https://wa.me/<digits>?text=...` with the confirmation WaDesk composed: "Hi <shop>! I just placed order #<id> (<total>). My
 * name is <name or a dash>." and a "Track:" line. Null when the shop has no sending number.
 */
export function buildWaUrl(input: {
  waNumber: string | null;
  shopName: string;
  orderNo: number;
  totalMinor: number;
  currencyCode: string;
  customerName: string | null;
  trackUrl: string;
}): string | null {
  const to = digitsOnly(input.waNumber);
  if (!to) return null;
  const text =
    `Hi ${input.shopName}! I just placed order #${input.orderNo}` +
    ` (${totalDisplay(input.totalMinor, input.currencyCode)}). My name is ${input.customerName || '—'}.` +
    `\nTrack: ${input.trackUrl}`;
  // PHP `rawurlencode` also escapes ! ' ( ) *
  const encoded = encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `https://wa.me/${to}?text=${encoded}`;
}
