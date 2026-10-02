import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SHOP_DOMAIN } from '../../infra/providers/ecom/ecom.port';

/** Pure rules of connecting a store (WD-ECOM-005, 006, 007, 025, 026): no database, no network, so each can be tested alone. */

/** The topics registered on a Shopify store. `app/uninstalled` is the cleanup hook: Shopify calls it once when the app is removed. */
export const SHOPIFY_WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/fulfilled',
  'orders/cancelled',
  // Carries `shipment_status` (in_transit, out_for_delivery, delivered) for the Delivered automation.
  'fulfillments/update',
  'refunds/create',
  'products/update',
  'customers/create',
  'customers/update',
  'checkouts/create',
  'app/uninstalled',
] as const;

/** The topics registered on a WooCommerce store: the ones with the highest messaging value. */
export const WOO_WEBHOOK_TOPICS = [
  'order.created',
  'order.updated',
  'order.deleted',
  'customer.created',
  'customer.updated',
  'product.created',
  'product.updated',
] as const;

export const DEFAULT_SCOPES =
  'read_products,read_orders,write_orders,read_customers,read_checkouts,read_inventory';

/**
 * What the merchant typed as a Shopify store, as a host name: scheme and path dropped, lower case, and a bare handle gets
 * `.myshopify.com` (the field says "just the store handle"). A handle has no dot; a full domain does.
 */
export function normalizeShop(input: string): string {
  let shop = input.trim().replace(/^https?:\/\//i, '');
  shop = shop.replace(/\/+$/, '');
  if (shop.includes('/')) shop = shop.split('/')[0]!;
  shop = shop.toLowerCase();
  if (shop !== '' && !shop.includes('.')) shop += '.myshopify.com';
  return shop;
}

export const isValidShop = (input: string): boolean => SHOP_DOMAIN.test(normalizeShop(input));

/** PHP's `urlencode`: letters, digits and `-_.` stay, a space is `+`, everything else (the `~` too) is percent-encoded. */
export const phpUrlencode = (s: string): string =>
  encodeURIComponent(s)
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');

/**
 * Shopify signs the callback's query: the `hmac` is the HMAC-SHA256 (hex, keyed by the app's client secret) of the other
 * parameters sorted by name and written as `name=value&...`. Compared in constant time; no `hmac` means not valid.
 */
export function verifyOAuthHmac(query: Readonly<Record<string, string>>, secret: string): boolean {
  const given = query.hmac ?? '';
  if (given === '' || secret === '') return false;
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${phpUrlencode(k)}=${phpUrlencode(query[k]!)}`)
    .join('&');
  const expected = createHmac('sha256', secret).update(message).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The address the browser is sent to so the merchant can approve the app: the store's own host, as Shopify documents. */
export function authorizeUrl(o: {
  shop: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    scope: o.scopes,
    redirect_uri: o.redirectUri,
    state: o.state,
  });
  return `https://${o.shop}/admin/oauth/authorize?${q.toString()}`;
}

/** What the OAuth round trip carries and for how long it is good. A callback older than this is refused. */
export const STATE_TTL_MS = 15 * 60_000;

export interface ConnectState {
  orgId: number;
  userId: number | null;
  /** The store the merchant asked for: the callback must come back for the same one. */
  shop: string;
  /** When the connection was started, in epoch milliseconds. */
  at: number;
  /** A random value, so two connections started in the same millisecond are different states. */
  nonce: string;
}

/** The state is whatever sealed it handed back: valid only if it parses, is fresh and is not from the future. */
export function readState(json: string, now: number): ConnectState | null {
  let s: unknown;
  try {
    s = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof s !== 'object' || s === null) return null;
  const v = s as Partial<ConnectState>;
  if (
    typeof v.orgId !== 'number' ||
    typeof v.shop !== 'string' ||
    typeof v.at !== 'number' ||
    typeof v.nonce !== 'string'
  ) {
    return null;
  }
  if (v.userId !== null && typeof v.userId !== 'number') return null;
  if (v.at > now + 60_000 || now - v.at > STATE_TTL_MS) return null;
  return { orgId: v.orgId, userId: v.userId ?? null, shop: v.shop, at: v.at, nonce: v.nonce };
}

/**
 * A WooCommerce address as an origin: `example.com`, `https://example.com/wp-json` and `HTTP://Example.com:8080/x` become
 * `https://example.com`, `https://example.com` and `http://example.com:8080`. Empty when there is no host.
 */
export function normalizeWooUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (u.hostname === '') return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

export const isValidWooUrl = (input: string): boolean => normalizeWooUrl(input) !== '';

/** The secret in a webhook address. It only picks which store a delivery is for (the delivery itself is signed). 40 characters. */
export const newWebhookSecret = (): string => randomBytes(30).toString('base64url');

/** Where a store delivers its webhooks. */
export const webhookUrl = (
  appUrl: string,
  kind: 'shopify' | 'woocommerce',
  secret: string,
): string => `${appUrl.replace(/\/+$/, '')}/v2/${kind}/webhook/${secret}`;

/** The webhook ids kept in an integration's metadata: topic to the store's id, with anything else dropped. */
export function webhookIdsOf(metadata: unknown): Record<string, string> {
  const raw = (metadata as { webhook_ids?: unknown } | null)?.webhook_ids;
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [topic, id] of Object.entries(raw)) {
    if (typeof id === 'string' && id !== '') out[topic] = id;
  }
  return out;
}
