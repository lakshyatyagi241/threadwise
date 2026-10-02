import type { DashboardCustomer, DashboardOrder, DashboardProduct } from '@crm/contracts';

/** Pure shaping of the store dashboard (TW-ECOM-023): WooCommerce's live records into rows, discounts, the 14 day trend. */

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const str = (x: unknown): string | null =>
  typeof x === 'string' && x !== '' ? x : typeof x === 'number' ? String(x) : null;
const num = (x: unknown): number => {
  const n = typeof x === 'number' ? x : Number.parseFloat(String(x ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const iso = (x: unknown): string | null => {
  const s = str(x);
  if (!s) return null;
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Whole percent off a compare-at price; 0 when there is none or it is not higher. */
export const discountPct = (price: number, compare: number | null): number =>
  compare !== null && compare > price && compare > 0 ? Math.round((1 - price / compare) * 100) : 0;

const WHATSAPP_ENGINES = ['baileys', 'waba', 'twilio'];
const OTHER_CHANNELS = ['instagram', 'facebook', 'telegram', 'line', 'wechat', 'viber'];

/**
 * The engine a template belongs to (Reference's `engineKey`): its channel when that names a WhatsApp engine, else (any other value or
 * none) Twilio when it has a content sid, WABA when Meta or a provider account knows it, else the unofficial engine. Null for a template of another channel
 * (Instagram, Facebook, Telegram, ...), which a WhatsApp automation cannot send.
 */
export function templateEngine(t: {
  channel: string | null;
  twilioContentSid: string | null;
  metaTemplateId: string | null;
  providerConfigId: unknown;
}): string | null {
  if (t.channel !== null && OTHER_CHANNELS.includes(t.channel)) return null;
  if (t.channel !== null && WHATSAPP_ENGINES.includes(t.channel)) return t.channel;
  if (t.twilioContentSid) return 'twilio';
  if (t.metaTemplateId || t.providerConfigId) return 'waba';
  return 'baileys';
}

/** How many numbered variables a template body declares (the highest `{{n}}`). */
export function paramCount(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

const label = (d: Date): string =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The last 14 days (UTC), oldest first, with days that had no orders at 0. `byDay` is keyed `YYYY-MM-DD`. */
export function trend14(
  byDay: ReadonlyMap<string, number>,
  now: Date,
): Array<{ label: string; value: number }> {
  const out: Array<{ label: string; value: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push({ label: label(d), value: byDay.get(d.toISOString().slice(0, 10)) ?? 0 });
  }
  return out;
}

export function wooDashboardOrder(raw: Json, fallbackCurrency: string): DashboardOrder {
  const billing = obj(raw.billing);
  const name = `${str(billing.first_name) ?? ''} ${str(billing.last_name) ?? ''}`.trim();
  return {
    name: `#${str(raw.number) ?? str(raw.id) ?? '?'}`,
    customer: name || str(billing.email) || '—',
    email: str(billing.email),
    phone: str(billing.phone),
    status: str(raw.status),
    fulfillment: null,
    total: num(raw.total),
    currency: str(raw.currency) ?? fallbackCurrency,
    createdAt: iso(raw.date_created_gmt) ?? iso(raw.date_created),
  };
}

export function wooDashboardProduct(raw: Json): DashboardProduct {
  const price = num(raw.price);
  const regular = num(raw.regular_price);
  const compare = raw.on_sale === true && regular > price ? regular : null;
  const image = obj(Array.isArray(raw.images) ? raw.images[0] : null);
  return {
    id: str(raw.id) ?? '',
    title: str(raw.name) ?? '—',
    vendor: null,
    imageUrl: str(image.src),
    productUrl: str(raw.permalink),
    price,
    comparePrice: compare,
    discountPct: discountPct(price, compare),
    inStock: str(raw.stock_status) !== 'outofstock',
  };
}

export function wooDashboardCustomer(raw: Json): DashboardCustomer {
  const billing = obj(raw.billing);
  const name = `${str(raw.first_name) ?? ''} ${str(raw.last_name) ?? ''}`.trim();
  return {
    name: name || str(raw.email) || '—',
    email: str(raw.email),
    phone: str(billing.phone),
    ordersCount: Math.max(0, Math.round(num(raw.orders_count))),
    totalSpent: Math.max(0, num(raw.total_spent)),
  };
}
