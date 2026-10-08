import { currencyExponent } from '@crm/contracts';
import type { ExternalOrderInput, ExternalOrderLine } from '../crm';
import { wooPhoneOf } from './woo-phone';
import type { StoreKind } from './mirror-rules';

/**
 * Pure rules of handing a store order to invoicing (WD-ECOM-035, 012): which deliveries count, whether the workspace's trigger is met,
 * and the raw webhook body as an `ExternalOrderInput` in the currency's TRUE minor units. The raw body is read, not the mirror's row:
 * the mirror keeps totals x100 for every currency and has no tax, shipping or discount, which an invoice needs.
 */

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | null =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : null;
const clean = (x: unknown): string | null => {
  const s = (str(x) ?? '').trim();
  return s === '' ? null : s;
};

export type EcomTrigger = 'on_placed' | 'on_paid' | 'on_fulfilled';
export const parseEcomTrigger = (raw: string | null | undefined): EcomTrigger =>
  raw === 'on_placed' || raw === 'on_paid' || raw === 'on_fulfilled' ? raw : 'on_paid';

const SHOPIFY_ORDER_TOPICS = new Set([
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/fulfilled',
  'orders/cancelled',
]);
const WOO_ORDER_TOPICS = new Set(['order.created', 'order.updated']);

export interface OrderFacts {
  /** The delivery is one of the order topics the mirror follows. */
  orderEvent: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
}

/**
 * What a delivery says about its order. Paid: Shopify `orders/paid` or `financial_status = paid`; WooCommerce status `processing`
 * or `completed`, or a `date_paid`. A cancelled, refunded, voided or failed order is never paid here, whatever else it says.
 */
export function orderFacts(kind: StoreKind, topic: string, data: Json): OrderFacts {
  if (kind === 'shopify') {
    const fin = (str(data.financial_status) ?? '').toLowerCase();
    const cancelled =
      topic === 'orders/cancelled' || !!data.cancelled_at || fin === 'refunded' || fin === 'voided';
    return {
      orderEvent: SHOPIFY_ORDER_TOPICS.has(topic) && clean(data.id) !== null,
      paid: !cancelled && (topic === 'orders/paid' || fin === 'paid'),
      fulfilled:
        !cancelled &&
        (topic === 'orders/fulfilled' ||
          (str(data.fulfillment_status) ?? '').toLowerCase() === 'fulfilled'),
      cancelled,
    };
  }
  const status = (str(data.status) ?? '').toLowerCase();
  const cancelled =
    status === 'cancelled' || status === 'refunded' || status === 'failed' || status === 'trash';
  return {
    orderEvent: WOO_ORDER_TOPICS.has(topic) && clean(data.id) !== null,
    paid:
      !cancelled &&
      (status === 'processing' || status === 'completed' || clean(data.date_paid) !== null),
    fulfilled: !cancelled && status === 'completed',
    cancelled,
  };
}

/** Is the workspace's chosen event reached by this delivery? */
export function triggerMet(trigger: EcomTrigger, f: OrderFacts): boolean {
  if (!f.orderEvent || f.cancelled) return false;
  switch (trigger) {
    case 'on_placed':
      return true;
    case 'on_paid':
      return f.paid;
    case 'on_fulfilled':
      return f.fulfilled;
  }
}

/** A decimal the store wrote ("19.99", 19.99, "1,5" is not one) in the currency's minor units, half-up. Unreadable is 0. */
export function toTrueMinor(value: unknown, currency: string): bigint {
  const s = (str(value) ?? '').trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return 0n;
  const exp = currencyExponent(currency);
  const frac = m[3] ?? '';
  const kept = (frac + '0'.repeat(exp)).slice(0, exp);
  let minor = BigInt(m[2]! + kept);
  // Half-up on the first dropped digit.
  if (frac.length > exp && frac.charCodeAt(exp) >= 53) minor += 1n;
  return m[1] === '-' ? -minor : minor;
}

/** unit price x quantity in minor units, half-up (quantities have up to 4 decimals). */
function lineGross(unit: bigint, qty: string): bigint {
  const [whole = '0', frac = ''] = qty.split('.');
  const scale = 10n ** BigInt(frac.length);
  return (unit * (BigInt(whole) * scale + BigInt(frac || '0')) * 2n + scale) / (scale * 2n);
}

const qtyText = (raw: unknown): string => {
  const n = typeof raw === 'number' ? raw : Number(str(raw) ?? '1');
  const q = Number.isFinite(n) && n > 0 ? n : 1;
  return String(Math.round(q * 10_000) / 10_000);
};

const trimRate = (n: number): string => String(Math.round(n * 10_000) / 10_000);

/**
 * The tax rate (percent) of an order that captured a tax amount. Rates the store printed on every tax line are added (two taxes on
 * the same goods, like a state and a county); without them the rate is derived from the amount, so the document reproduces it:
 * exclusive tax is `tax / taxable`, inclusive tax is `tax / (taxable - tax)`. Null when no rate can be derived.
 */
export function taxRate(opts: {
  taxMinor: bigint;
  taxableMinor: bigint;
  inclusive: boolean;
  printedRates: number[];
}): string | null {
  if (opts.printedRates.length > 0 && opts.printedRates.every((r) => Number.isFinite(r) && r > 0))
    return trimRate(opts.printedRates.reduce((a, b) => a + b, 0));
  const base = opts.inclusive ? opts.taxableMinor - opts.taxMinor : opts.taxableMinor;
  if (opts.taxMinor <= 0n || base <= 0n) return null;
  const scaled = (opts.taxMinor * 1_000_000n * 2n + base) / (base * 2n);
  return trimRate(Number(scaled) / 10_000);
}

export interface HandOffContext {
  waOrderId: number;
  contactId: number | null;
  /** The workspace's tax label, used when the store's tax lines carry none. */
  settingsTaxLabel: string | null;
  deliveryId: string;
  topic: string;
  /** The currency the mirror guessed (the store's own), when the body names none. */
  fallbackCurrency: string | null;
}

const addressOf = (a: Json, keys: string[]): string | null => {
  const text = keys
    .map((k) => clean(a[k]))
    .filter((x): x is string => x !== null)
    .join(', ');
  return text === '' ? null : text;
};

const digitsOf = (x: unknown): string | null => {
  const d = (str(x) ?? '').replace(/\D+/g, '');
  return d === '' ? null : d;
};

function finish(
  base: Omit<ExternalOrderInput, 'tax' | 'docType' | 'discountMinor'> & { discountMinor: bigint },
  tax: { taxMinor: bigint; inclusive: boolean; printedRates: number[]; labels: string[] },
  settingsTaxLabel: string | null,
): ExternalOrderInput {
  const goods = base.lines.reduce((a, l) => a + lineGross(l.unitPriceMinor, l.qty), 0n);
  const discount = base.discountMinor > goods ? goods : base.discountMinor;
  const rate =
    tax.taxMinor > 0n
      ? taxRate({
          taxMinor: tax.taxMinor,
          taxableMinor: goods - discount,
          inclusive: tax.inclusive,
          printedRates: tax.printedRates,
        })
      : null;
  const label = tax.labels.length > 0 ? tax.labels.join(' + ') : (clean(settingsTaxLabel) ?? 'Tax');
  return {
    ...base,
    discountMinor: discount,
    tax: rate !== null ? { inclusive: tax.inclusive, label, ratePercent: rate } : null,
    // WaDesk's rule: a tax invoice only when tax was really charged, otherwise a receipt.
    docType: rate !== null ? 'tax_invoice' : 'receipt',
  };
}

/** A Shopify money field in the shopper's (presentment) currency when the `_set` object is there, else the plain shop-currency one. */
function shopifyMoney(o: Json, plain: string, set: string): unknown {
  const presentment = obj(obj(o[set]).presentment_money).amount;
  return presentment ?? o[plain];
}

/** A Shopify `orders/*` body as an order to invoice. */
export function shopifyExternalOrder(o: Json, c: HandOffContext): ExternalOrderInput {
  const currency = (
    clean(o.presentment_currency) ??
    clean(o.currency) ??
    c.fallbackCurrency ??
    'USD'
  ).toUpperCase();
  const cust = obj(o.customer);
  const ship = obj(o.shipping_address);
  const bill = obj(o.billing_address);
  const name =
    `${clean(cust.first_name) ?? ''} ${clean(cust.last_name) ?? ''}`.trim() ||
    clean(ship.name) ||
    clean(bill.name);
  const lines: ExternalOrderLine[] = arr(o.line_items).map((li) => {
    const l = obj(li);
    return {
      description: clean(l.title) ?? clean(l.name) ?? 'Item',
      sku: clean(l.sku),
      qty: qtyText(l.quantity),
      unitPriceMinor: toTrueMinor(shopifyMoney(l, 'price', 'price_set'), currency),
    };
  });
  const shipping = arr(o.shipping_lines).reduce<bigint>(
    (a, s) => a + toTrueMinor(shopifyMoney(obj(s), 'price', 'price_set'), currency),
    0n,
  );
  const taxLines = arr(o.tax_lines).map(obj);
  const taxFromLines = taxLines.reduce<bigint>(
    (a, t) => a + toTrueMinor(shopifyMoney(t, 'price', 'price_set'), currency),
    0n,
  );
  const taxMinor =
    taxFromLines > 0n
      ? taxFromLines
      : toTrueMinor(shopifyMoney(o, 'total_tax', 'total_tax_set'), currency);
  const storeId = str(o.id) ?? '';
  const orderName = clean(o.name) ?? `#${clean(o.order_number) ?? storeId}`;
  return finish(
    {
      source: 'shopify',
      waOrderId: c.waOrderId,
      reference: `Shopify order ${orderName}`,
      contactId: c.contactId,
      buyer: {
        name,
        email: clean(cust.email) ?? clean(o.email) ?? clean(o.contact_email),
        phone: digitsOf(ship.phone ?? cust.phone ?? bill.phone ?? o.phone),
        address: addressOf(ship, ['address1', 'address2', 'city', 'province', 'zip', 'country']),
      },
      currency,
      lines,
      discountMinor: toTrueMinor(
        shopifyMoney(o, 'total_discounts', 'total_discounts_set'),
        currency,
      ),
      shippingMinor: shipping,
      notes: null,
      orderTotalMinor: toTrueMinor(shopifyMoney(o, 'total_price', 'total_price_set'), currency),
      meta: meta('shopify', storeId, orderName, c, str(o.financial_status)),
    },
    {
      taxMinor,
      inclusive: o.taxes_included === true,
      // Shopify prints a fraction (0.18); the document wants percent.
      printedRates:
        taxLines.length > 0 ? taxLines.map((t) => (Number(str(t.rate) ?? 'NaN') || NaN) * 100) : [],
      labels: [...new Set(taxLines.map((t) => clean(t.title)).filter((x): x is string => !!x))],
    },
    c.settingsTaxLabel,
  );
}

/** A WooCommerce `order.*` body as an order to invoice. WooCommerce totals are always without tax: the tax is added on top. */
export function wooExternalOrder(o: Json, c: HandOffContext): ExternalOrderInput {
  const currency = (clean(o.currency) ?? c.fallbackCurrency ?? 'USD').toUpperCase();
  const billing = obj(o.billing);
  const shipping = obj(o.shipping);
  const name =
    `${clean(billing.first_name) ?? ''} ${clean(billing.last_name) ?? ''}`.trim() ||
    `${clean(shipping.first_name) ?? ''} ${clean(shipping.last_name) ?? ''}`.trim() ||
    null;
  const lines: ExternalOrderLine[] = arr(o.line_items).map((li) => {
    const l = obj(li);
    const qty = qtyText(l.quantity);
    const subtotal = toTrueMinor(l.subtotal ?? l.total, currency);
    const q = Number(qty);
    // `subtotal` is the line before its discount: the unit price is that over the quantity (the discount goes on the document).
    const unit =
      q > 0 && subtotal > 0n
        ? BigInt(Math.round(Number(subtotal) / q))
        : toTrueMinor(l.price, currency);
    return {
      description: clean(l.name) ?? 'Item',
      sku: clean(l.sku),
      qty,
      unitPriceMinor: unit,
    };
  });
  const taxLines = arr(o.tax_lines).map(obj);
  const shippingTax = toTrueMinor(o.shipping_tax, currency);
  const taxTotal = toTrueMinor(o.total_tax, currency);
  const phone = wooPhoneOf(o);
  const storeId = str(o.id) ?? '';
  const orderName = `#${clean(o.number) ?? storeId}`;
  return finish(
    {
      source: 'woocommerce',
      waOrderId: c.waOrderId,
      reference: `WooCommerce order ${orderName}`,
      contactId: c.contactId,
      buyer: {
        name,
        email: clean(billing.email),
        phone: phone ? (digitsOf(phone) ?? null) : null,
        address: addressOf(billing, [
          'address_1',
          'address_2',
          'city',
          'state',
          'postcode',
          'country',
        ]),
      },
      currency,
      lines,
      discountMinor: toTrueMinor(o.discount_total, currency),
      shippingMinor: toTrueMinor(o.shipping_total, currency),
      notes: clean(o.customer_note),
      orderTotalMinor: toTrueMinor(o.total, currency),
      meta: meta('woocommerce', storeId, orderName, c, str(o.status)),
    },
    {
      // The document taxes the goods, so the shipping's own tax is left out of the rate's amount.
      taxMinor: taxTotal > shippingTax ? taxTotal - shippingTax : taxTotal,
      inclusive: false,
      printedRates:
        taxLines.length > 0 ? taxLines.map((t) => Number(str(t.rate_percent) ?? 'NaN') || NaN) : [],
      labels: [...new Set(taxLines.map((t) => clean(t.label)).filter((x): x is string => !!x))],
    },
    c.settingsTaxLabel,
  );
}

function meta(
  kind: StoreKind,
  storeOrderId: string,
  orderName: string,
  c: HandOffContext,
  status: string | null,
): Record<string, unknown> {
  return {
    nativeSource: kind,
    storeOrderId,
    orderName,
    topic: c.topic,
    deliveryId: c.deliveryId,
    storeStatus: status,
  };
}

/** When the buyer paid: the store's own stamp, else now. */
export function paidAtOf(kind: StoreKind, o: Json, now: Date): Date {
  const raw = kind === 'shopify' ? clean(o.processed_at) : clean(o.date_paid_gmt ?? o.date_paid);
  if (!raw) return now;
  // WooCommerce's `_gmt` stamps carry no zone: they are UTC.
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(t.getTime()) ? now : t;
}
