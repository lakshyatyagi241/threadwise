import { currencyExponent } from '@crm/contracts';
import type { ExternalOrderInput, ExternalOrderLine } from '../crm';

/** The columns of `wa_orders` the bridge reads. Amounts are the table's own: stored x100 by the app's convention (see `toTrueMinor`). */
export interface StoreOrderRow {
  id: number;
  uuid: string;
  source: string;
  status: string;
  customerPhone: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  itemsJson: unknown;
  totalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  taxInclusive: boolean;
  taxLinesJson: unknown;
  discountMinor: number;
  couponCode: string | null;
  paymentMethod: string;
  currencyCode: string;
  notes: string | null;
  metaJson: Record<string, unknown> | null;
  waPaymentTxnId: string | null;
  contactId: number | null;
  salesOrderId: number | null;
  invoiceId: number | null;
  createdAt: Date;
}

/** One line of `wa_order_items`, the fallback when `items_json` holds nothing readable. */
export interface StoreOrderItemRow {
  name: string;
  retailerId: string | null;
  quantity: number;
  priceMinor: number;
}

/**
 * Reference's invoice triggers for a store order (`invoice_settings.trigger_own`): when the order reaches the state the owner chose, its
 * invoice is issued. `manual` is ours: the workspace turns the automation off and bills with the "Create invoice" button.
 */
export type InvoiceTrigger = 'on_placed' | 'on_paid' | 'on_fulfilled' | 'manual';

export const DEFAULT_TRIGGER: InvoiceTrigger = 'on_paid';

export const parseTrigger = (raw: string | null | undefined): InvoiceTrigger =>
  raw === 'on_placed' || raw === 'on_paid' || raw === 'on_fulfilled' || raw === 'manual'
    ? raw
    : DEFAULT_TRIGGER;

/** Statuses that mean the buyer has paid (Reference's sweeper billed `paid` and `completed`). */
const PAID = new Set(['paid', 'completed']);
/** Statuses that mean the goods left. */
const FULFILLED = new Set(['shipped', 'completed']);

export const isPaid = (status: string): boolean => PAID.has(status);
export const isCancelled = (status: string): boolean => status === 'cancelled';

/** Has the order reached the state the owner chose to invoice at? A cancelled order never bills. */
export function triggerMet(trigger: InvoiceTrigger, status: string): boolean {
  if (isCancelled(status)) return false;
  switch (trigger) {
    case 'on_placed':
      return true;
    case 'on_paid':
      return PAID.has(status);
    case 'on_fulfilled':
      return FULFILLED.has(status);
    case 'manual':
      return false;
  }
}

/**
 * `wa_orders` and `wa_products` store amounts x100 by app convention (Reference). The invoice engine works in the currency's TRUE minor
 * units, so a zero- or three-decimal currency is re-scaled (a stored 15000 for IDR is 150 major units, which is 150 minor units).
 */
export function toTrueMinor(stored: number | bigint, currency: string): bigint {
  const exp = currencyExponent(currency);
  const n = Number(stored);
  if (exp === 2) return BigInt(Math.round(n));
  return BigInt(Math.round((n / 100) * 10 ** exp));
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/** A quantity as the decimal string the invoice engine reads (up to 4 decimals, above zero). */
export function qtyText(raw: unknown): string {
  const n = num(raw, 1);
  const q = n > 0 ? n : 1;
  return String(Math.round(q * 10_000) / 10_000);
}

interface ItemFacts {
  name: string;
  sku: string | null;
  qty: string;
  priceMinor: number;
}

/** "T-shirt (M / Red)" for a variant line, the plain name otherwise. */
const variantName = (name: string, variantTitle: string | null): string =>
  variantTitle ? `${name} (${variantTitle})` : name;

/** The order's lines: `items_json` first (the storefront writes `qty`, the WhatsApp cart `quantity`), else the `wa_order_items` rows. */
export function itemFacts(itemsJson: unknown, rows: StoreOrderItemRow[]): ItemFacts[] {
  const fromJson = Array.isArray(itemsJson)
    ? (itemsJson as Array<Record<string, unknown>>)
        .filter((r) => r && typeof r === 'object')
        .map((r) => ({
          name: variantName(text(r.name) ?? 'Item', text(r.variant_title)),
          sku:
            text(r.retailer_id) ??
            text(r.sku) ??
            (r.product_id != null ? String(r.product_id) : null),
          qty: qtyText(r.qty ?? r.quantity),
          priceMinor: num(r.price_minor, 0),
        }))
    : [];
  if (fromJson.length > 0) return fromJson;
  return rows.map((r) => ({
    name: r.name || 'Item',
    sku: r.retailerId,
    qty: qtyText(r.quantity),
    priceMinor: r.priceMinor,
  }));
}

/** unit price x quantity, half-up, in minor units. */
function lineGross(unit: bigint, qty: string): bigint {
  const [whole = '0', frac = ''] = qty.split('.');
  const scale = 10n ** BigInt(frac.length);
  const q = BigInt(whole) * scale + BigInt(frac || '0');
  return (unit * q * 2n + scale) / (scale * 2n);
}

/**
 * The tax rate (percent, up to 4 decimals) of an order that captured a tax amount. The rate the checkout stored on a tax line wins; when
 * only the amount was captured the rate is derived from it, so the document reproduces the amount: exclusive tax is `tax / (goods -
 * discount)`, inclusive tax is `tax / (goods - discount - tax)`. Null when nothing taxable is left (no rate can be derived).
 */
export function taxRatePercent(opts: {
  taxMinor: bigint;
  taxableMinor: bigint;
  inclusive: boolean;
  taxLinesJson: unknown;
}): string | null {
  const lines = Array.isArray(opts.taxLinesJson)
    ? (opts.taxLinesJson as Array<Record<string, unknown>>)
    : [];
  const stored = lines
    .map((l) => num(l.rate ?? l.rate_percent ?? l.ratePercent, NaN))
    .filter((r) => Number.isFinite(r) && r > 0);
  if (lines.length === 1 && stored.length === 1) return trimRate(stored[0]!);
  const base = opts.inclusive ? opts.taxableMinor - opts.taxMinor : opts.taxableMinor;
  if (opts.taxMinor <= 0n || base <= 0n) return null;
  // percent x 10^4, half-up
  const scaled = (opts.taxMinor * 1_000_000n * 2n + base) / (base * 2n);
  return trimRate(Number(scaled) / 10_000);
}

const trimRate = (n: number): string => String(Math.round(n * 10_000) / 10_000);

/** The label of the order's tax: its own tax line, else the workspace's tax label, else "Tax". */
export function taxLabel(taxLinesJson: unknown, settingsLabel: string | null): string {
  const first = Array.isArray(taxLinesJson)
    ? (taxLinesJson as Array<Record<string, unknown>>)[0]
    : undefined;
  return (
    text(first?.label) ?? text(first?.title) ?? text(first?.name) ?? text(settingsLabel) ?? 'Tax'
  );
}

/**
 * Reference's `OwnStoreInvoiceMapper`, for our invoicing engine: a store order is issued as a RECEIPT unless a real tax amount was
 * captured (never a "tax invoice" with a zero-tax line on a taxable sale); no readable lines at all becomes one "Order #id" line.
 */
export function toExternalOrder(
  order: StoreOrderRow,
  rows: StoreOrderItemRow[],
  opts: { settingsTaxLabel: string | null; contactId: number | null },
): ExternalOrderInput {
  const currency = (order.currencyCode || 'USD').toUpperCase();
  const facts = itemFacts(order.itemsJson, rows);
  const shipping = toTrueMinor(order.shippingMinor, currency);
  let discount = toTrueMinor(order.discountMinor, currency);
  const tax = toTrueMinor(order.taxMinor, currency);
  const total = toTrueMinor(order.totalMinor, currency);

  let lines: ExternalOrderLine[] = facts.map((f) => ({
    description: f.name,
    sku: f.sku,
    qty: f.qty,
    unitPriceMinor: toTrueMinor(f.priceMinor, currency),
  }));
  if (lines.length === 0) {
    // A denormalised order with no lines: one "Order total" line holding the goods (total - shipping + discount).
    const goods = total - shipping + discount;
    lines = [
      {
        description: `Order #${order.id}`,
        sku: null,
        qty: '1',
        unitPriceMinor: goods > 0n ? goods : 0n,
      },
    ];
  }
  const goodsMinor = lines.reduce((a, l) => a + lineGross(l.unitPriceMinor, l.qty), 0n);
  if (discount > goodsMinor) discount = goodsMinor;

  const rate =
    tax > 0n
      ? taxRatePercent({
          taxMinor: tax,
          taxableMinor: goodsMinor - discount,
          inclusive: order.taxInclusive,
          taxLinesJson: order.taxLinesJson,
        })
      : null;
  const hasTax = rate !== null;
  return {
    waOrderId: order.id,
    reference: `Store order #${order.id}`,
    contactId: opts.contactId,
    buyer: {
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
      address: order.customerAddress,
    },
    currency,
    lines,
    discountMinor: discount,
    shippingMinor: shipping,
    tax: hasTax
      ? {
          inclusive: order.taxInclusive,
          label: taxLabel(order.taxLinesJson, opts.settingsTaxLabel),
          ratePercent: rate,
        }
      : null,
    notes: order.notes,
    orderTotalMinor: total,
    docType: hasTax ? 'tax_invoice' : 'receipt',
    meta: { nativeSource: order.source, orderUuid: order.uuid, couponCode: order.couponCode },
  };
}
