import { createHmac, timingSafeEqual } from 'node:crypto';
import { wooInvoiceUrl } from './mirror-rules';
import { wooPhoneOf } from './woo-phone';

/**
 * Pure rules of reading a store's webhook into a WhatsApp message (TW-ECOM-008, 010, 027, 029): the signatures, who the message is
 * for, and the variables that fill the template. No database and no network, so each can be tested alone.
 */

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | null =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : null;
const filled = (...v: Array<string | null>): string | null =>
  v.find((x) => x !== null && x.trim() !== '') ?? null;

// ── Signatures ──────────────────────────────────────────────────────────

/** A base64 HMAC-SHA256 of the raw body, as both stores send it. Compared in constant time; an empty header never matches. */
function signatureHolds(payload: Buffer, header: string, secret: string): boolean {
  if (header === '' || secret === '') return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('base64'));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Shopify signs every store's deliveries with the platform app's client secret (`X-Shopify-Hmac-SHA256`). */
export const verifyShopifyWebhook = (
  payload: Buffer,
  header: string,
  clientSecret: string,
): boolean => signatureHolds(payload, header, clientSecret);

/** WooCommerce signs a store's deliveries with the secret set on that store's webhooks (`X-WC-Webhook-Signature`). */
export const verifyWooWebhook = (payload: Buffer, header: string, webhookSecret: string): boolean =>
  signatureHolds(payload, header, webhookSecret);

// ── The automations a store can map ─────────────────────────────────────

/** The Shopify automations Reference shows: its order and customer topics, then the ones it adds (delivered, COD, back in stock, the cart steps). `fulfillments/update` and `app/uninstalled` are webhooks we handle but not automations a merchant maps. */
export const SHOPIFY_AUTOMATIONS: readonly string[] = [
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/fulfilled',
  'orders/cancelled',
  'refunds/create',
  'products/update',
  'customers/create',
  'customers/update',
  'checkouts/create',
  'cod/confirm',
  'cod/prepaid',
  'stock/back',
  'order/delivered',
  'cart/step2',
  'cart/step3',
];

/** WooCommerce's topics, then one automation per order status, then COD, stock, the cart steps, dunning and the review reward. */
export const WOO_AUTOMATIONS: readonly string[] = [
  'order.created',
  'order.updated',
  'order.deleted',
  'customer.created',
  'customer.updated',
  'product.created',
  'product.updated',
  'order.processing',
  'order.completed',
  'order.on-hold',
  'order.cancelled',
  'order.refunded',
  'order.failed',
  'cod/confirm',
  'cod/prepaid',
  'stock/back',
  'checkout.created',
  'cart/step2',
  'cart/step3',
  'subscription.payment_failed',
  'review/reward',
];

// ── The recipient ───────────────────────────────────────────────────────

/** Shopify: the customer's phone, else the order's, else the shipping then billing address's (the first one filled in). */
export const shopifyRecipient = (data: Json): string | null =>
  filled(
    str(obj(data.customer).phone),
    str(data.phone),
    str(obj(data.shipping_address).phone),
    str(obj(data.billing_address).phone),
  );

/** WooCommerce: billing, shipping or customer phone, made international from the billing country. */
export const wooRecipient = (data: Json): string | null => wooPhoneOf(data);

// ── The variables ───────────────────────────────────────────────────────

/** What fills a template: named values, and the ordered list that fills `{{1}}`, `{{2}}`, ... */
export interface EventContext {
  vars: Record<string, string>;
  positional: string[];
}

export interface StoreFacts {
  storeName: string | null;
  storeUrl: string;
  currency: string | null;
}

const label = (s: StoreFacts): string => s.storeName || s.storeUrl;

/** Shopify's order or customer payload as variables. The positional default is `[name, order name, total]`. */
export function shopifyContext(store: StoreFacts, data: Json): EventContext {
  const cust = obj(data.customer);
  const first = (str(cust.first_name) ?? str(data.first_name) ?? '').trim();
  const last = (str(cust.last_name) ?? str(data.last_name) ?? '').trim();
  const name = `${first} ${last}`.trim() || str(data.name) || 'there';
  const orderName = str(data.name) ?? `#${str(data.order_number) ?? str(data.id) ?? ''}`;
  const currency = str(data.currency) ?? store.currency ?? '';
  const total = str(data.total_price) ?? '';
  const totalFmt = total !== '' ? `${total} ${currency}`.trim() : '';
  const ful = obj(arr(data.fulfillments)[0]);
  const orderUrl = str(data.order_status_url) ?? '';
  return {
    vars: {
      name,
      first_name: first || name,
      last_name: last,
      order_number: str(data.order_number) ?? str(data.id) ?? '',
      order_name: orderName,
      total: totalFmt,
      total_price: total,
      currency,
      email: str(cust.email) ?? str(data.email) ?? '',
      store_name: label(store),
      financial_status: str(data.financial_status) ?? '',
      fulfillment_status: str(data.fulfillment_status) ?? '',
      // Usable as {{tracking_url}}, {{tracking_number}}, {{tracking_company}} and {{order_url}} in Shipped, Delivered and Prepaid templates.
      tracking_url: str(ful.tracking_url) ?? str(arr(ful.tracking_urls)[0]) ?? orderUrl,
      tracking_number: str(ful.tracking_number) ?? '',
      tracking_company: str(ful.tracking_company) ?? '',
      order_url: orderUrl,
      checkout_url: str(data.abandoned_checkout_url) ?? orderUrl,
    },
    positional: [name, orderName, totalFmt],
  };
}

/**
 * Shipment-tracking details from a WooCommerce order's meta: the Shipment Tracking plugins keep `_wc_shipment_tracking_items` or
 * `_tracking_number`. Empty strings when there is none.
 */
export function wooTracking(data: Json): { number: string; url: string; company: string } {
  const out = { number: '', url: '', company: '' };
  for (const m of arr(data.meta_data)) {
    const meta = obj(m);
    const key = str(meta.key) ?? '';
    const val = meta.value;
    if (key === '_wc_shipment_tracking_items' && Array.isArray(val) && val[0]) {
      const first = obj(val[0]);
      out.number = str(first.tracking_number) ?? '';
      out.company = str(first.tracking_provider) ?? str(first.custom_tracking_provider) ?? '';
      out.url = str(first.custom_tracking_link) ?? '';
    } else if (key === '_tracking_number' && typeof val === 'string') {
      out.number = val;
    }
  }
  return out;
}

/** WooCommerce's order payload as variables. The positional default is `[name, order #, total]`. */
export function wooContext(store: StoreFacts, data: Json): EventContext {
  const billing = obj(data.billing);
  const first = (str(billing.first_name) ?? '').trim();
  const last = (str(billing.last_name) ?? '').trim();
  const name = `${first} ${last}`.trim() || 'there';
  const number = str(data.number) ?? str(data.id) ?? '';
  const orderName = `#${number}`;
  const currency = str(data.currency) ?? store.currency ?? '';
  const total = str(data.total) ?? '';
  const totalFmt = total !== '' ? `${total} ${currency}`.trim() : '';
  const base = store.storeUrl ? store.storeUrl.replace(/\/+$/, '') : '';
  const id = str(data.id) ?? '';
  // The customer-facing order page (the standard My Account endpoint) and the pay-now link (the order-pay endpoint needs the key).
  const orderUrl = base ? `${base}/my-account/view-order/${id}/` : '';
  const key = str(data.order_key);
  const payUrl =
    base && key ? `${base}/checkout/order-pay/${id}/?pay_for_order=true&key=${key}` : orderUrl;
  const tracking = wooTracking(data);
  // A real PDF from the store's invoice plugin when there is one, else the order page where the invoice download lives, so
  // {{invoice_url}} works in any store.
  const invoice = wooInvoiceUrl(data);
  return {
    vars: {
      name,
      first_name: first || name,
      last_name: last,
      order_number: number,
      order_name: orderName,
      total: totalFmt,
      total_price: total,
      currency,
      email: str(billing.email) ?? '',
      store_name: label(store),
      status: str(data.status) ?? '',
      payment_method: str(data.payment_method) ?? '',
      payment_method_title: str(data.payment_method_title) ?? '',
      order_url: orderUrl,
      order_pay_url: payUrl,
      invoice_url: invoice || orderUrl,
      invoice_is_pdf: invoice !== '' ? '1' : '0',
      tracking_number: tracking.number,
      tracking_url: tracking.url || orderUrl,
      tracking_company: tracking.company,
    },
    positional: [name, orderName, totalFmt],
  };
}

/** A chosen list of order fields fills `{{1}}`, `{{2}}`, ...; a field that is not there is empty. */
export const applyVarMap = (ctx: EventContext, varMap: readonly string[] | null): EventContext =>
  varMap && varMap.length > 0
    ? { vars: ctx.vars, positional: varMap.map((f) => ctx.vars[f] ?? '') }
    : ctx;

const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** A template body with its tokens filled: `{{name}}` from the named values (any case), `{{1}}` from the list; unknown ones removed. */
export function renderBody(body: string, ctx: EventContext): string {
  const lower = new Map(Object.entries(ctx.vars).map(([k, v]) => [k.toLowerCase(), v]));
  return body.replace(TOKEN, (_m, key: string) =>
    /^\d+$/.test(key)
      ? (ctx.positional[Number(key) - 1] ?? '')
      : (lower.get(key.toLowerCase()) ?? ''),
  );
}

/** The values for a template's numbered parameters, in order: up to the highest `{{n}}` the body declares. */
export function bodyParams(body: string, positional: readonly string[]): string[] {
  let max = 0;
  for (const m of body.matchAll(TOKEN)) if (/^\d+$/.test(m[1]!)) max = Math.max(max, Number(m[1]));
  return Array.from({ length: max }, (_, i) => positional[i] ?? '');
}

// ── Cash on delivery (TW-ECOM-016, 017, 030) ───────────────────────────

const lower = (x: unknown): string => (str(x) ?? '').toLowerCase();

/** Shopify: a gateway named cash on delivery or cod, or an unpaid order tagged cod. */
export function isShopifyCod(data: Json): boolean {
  for (const g of arr(data.payment_gateway_names)) {
    const n = lower(g);
    if (n.includes('cash on delivery') || n.includes('cod') || n.includes('cash_on_delivery'))
      return true;
  }
  const gw = lower(data.gateway);
  if (gw.includes('cash on delivery') || gw.includes('cod')) return true;
  return lower(data.tags).includes('cod') && lower(data.financial_status) === 'pending';
}

/** WooCommerce: a payment method of cod, or a title naming cash on delivery. */
export function isWooCod(data: Json): boolean {
  const method = lower(data.payment_method);
  if (method === 'cod' || method.includes('cash_on_delivery') || method.includes('cashondelivery'))
    return true;
  const title = lower(data.payment_method_title);
  return title.includes('cash on delivery') || title.includes('cod');
}

const YES = [
  'yes',
  'y',
  'confirm',
  'confirmed',
  'ok',
  'okay',
  'yep',
  'sure',
  'haan',
  'ha',
  'haa',
  '1',
  '✅',
  '👍',
];
const NO = ['no', 'n', 'cancel', 'cancelled', 'cancel order', 'nope', 'nahi', 'nai', '2', '❌'];

/**
 * How a customer's reply reads: yes, no, or neither. Yes wins when a text reads as both, as in Reference (it tests yes first), though
 * no text can start with "yes" or "confirm" and with "no" or "cancel" at once.
 */
export function readCodReply(text: string): 'yes' | 'no' | null {
  const t = text.trim().toLowerCase();
  if (YES.includes(t) || t.startsWith('yes') || t.startsWith('confirm')) return 'yes';
  if (NO.includes(t) || t.startsWith('no') || t.startsWith('cancel')) return 'no';
  return null;
}

export interface RiskFacts {
  priorCount: number;
  priorCancelled: number;
  priorFulfilled: number;
  total: number;
  /** The store's average order value in major units; 0 when there are no orders. */
  average: number;
  hasEmail: boolean;
  hasPhone: boolean;
}

/** A 0 to 100 score, the reasons behind it, and its level (60 and up high, 30 and up medium). */
export function codRisk(f: RiskFacts): {
  score: number;
  level: 'high' | 'medium' | 'low';
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  if (f.priorCount === 0) {
    score += 30;
    reasons.push('First-time buyer (no order history)');
  } else if (f.priorFulfilled === 0) {
    score += 18;
    reasons.push('No previously fulfilled order');
  }
  if (f.priorCancelled > 0) {
    score += Math.min(30, f.priorCancelled * 15);
    reasons.push(`${f.priorCancelled} prior cancelled order${f.priorCancelled === 1 ? '' : 's'}`);
  }
  if (f.average > 0 && f.total > f.average * 2) {
    score += 25;
    reasons.push(`Order value ${Math.round((f.total / f.average) * 10) / 10}× the store average`);
  } else if (f.average > 0 && f.total > f.average * 1.5) {
    score += 12;
    reasons.push('Order value above average');
  }
  if (!f.hasEmail) {
    score += 8;
    reasons.push('No email on the order');
  }
  if (!f.hasPhone) {
    score += 15;
    reasons.push('No phone number on the order');
  }
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low', reasons };
}

// ── Back in stock (TW-ECOM-020) ────────────────────────────────────────

const STOCK_WORDS = ['notify', 'stock', 'back in stock', 'available', 'restock', 'in stock'];

/** A message asking to be told when something is available again. */
export const wantsStockAlert = (text: string): boolean => {
  const t = text.trim().toLowerCase();
  return STOCK_WORDS.some((w) => t.includes(w));
};

/** The first out-of-stock product whose name or sku appears in the message (case-insensitive); an empty name or sku never matches. */
export function matchOutOfStock<P extends { name: string; sku: string | null }>(
  text: string,
  products: readonly P[],
): P | undefined {
  const t = text.trim().toLowerCase();
  return products.find((p) => {
    const name = p.name.toLowerCase();
    const sku = (p.sku ?? '').toLowerCase();
    return (name !== '' && t.includes(name)) || (sku !== '' && t.includes(sku));
  });
}
