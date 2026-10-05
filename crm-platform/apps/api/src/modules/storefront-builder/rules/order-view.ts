import type {
  StoreOrderLine,
  StoreOrderPayment,
  StoreOrderTimelineEntry,
  StorePaymentStatus,
} from '@crm/contracts';

/**
 * How an order is shown on the merchant's order page: its lines, what was paid and how, and its history. Pure functions over what
 * the repository read, so the shapes channels write (the storefront checkout, WhatsApp orders, Shopify) are handled in one place.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** `items_json` lines (`{product_id, name, qty, price_minor, image, retailer_id}` as the checkout writes them; a few aliases other channels use). */
export function parseOrderLines(items: unknown): StoreOrderLine[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw): StoreOrderLine => {
    const o = obj(raw);
    const qty = Math.max(1, int(o.qty ?? o.quantity, 1));
    const priceMinor = int(o.price_minor ?? o.priceMinor, 0);
    const productId = o.product_id ?? o.productId;
    return {
      productId:
        productId === undefined || productId === null || productId === ''
          ? null
          : int(productId, 0) || null,
      name: str(o.name) ?? str(o.title) ?? str(o.product_name) ?? 'Item',
      qty,
      priceMinor,
      lineTotalMinor: qty * priceMinor,
      image: str(o.image) ?? str(o.image_url),
      retailerId: str(o.retailer_id) ?? str(o.retailerId),
    };
  });
}

/** What the lines add up to; when an order has no lines, the total with shipping and tax taken out and the discount added back. */
export function orderSubtotal(
  lines: readonly StoreOrderLine[],
  o: {
    totalMinor: number;
    shippingMinor: number;
    taxMinor: number;
    taxInclusive: boolean;
    discountMinor: number;
  },
): number {
  if (lines.length > 0) return lines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  return o.totalMinor - o.shippingMinor - (o.taxInclusive ? 0 : o.taxMinor) + o.discountMinor;
}

export interface PaymentFacts {
  totalMinor: number;
  currencyCode: string;
  paymentMethod: string;
  paymentStatus: StorePaymentStatus;
  paymentLink: string | null;
  waPaymentStatus: string | null;
  waPaymentTxnId: string | null;
  meta: Json | null;
  /** When the order turned paid (from its history), else the last update. */
  paidAt: Date | null;
}

/** The payment records of an order: the money asked for, and how it arrived. */
export function buildPayments(f: PaymentFacts): StoreOrderPayment[] {
  const meta = obj(f.meta);
  const paidVia = str(meta.paid_via);
  const out: StoreOrderPayment[] = [];
  const base = { amountMinor: f.totalMinor, currencyCode: f.currencyCode };

  if (f.paymentMethod === 'cod') {
    out.push({
      kind: 'cod',
      gateway: null,
      status: f.paymentStatus === 'paid' ? 'paid' : 'cod',
      reference: null,
      url: null,
      at: f.paymentStatus === 'paid' ? (f.paidAt?.toISOString() ?? null) : null,
      ...base,
    });
  }
  if (f.paymentLink) {
    out.push({
      kind: 'payment_link',
      gateway: str(meta.gateway_slug) ?? (paidVia === 'razorpay_link' ? 'razorpay' : null),
      status: f.paymentStatus === 'paid' ? 'paid' : 'awaiting',
      reference: str(meta.razorpay_plink) ?? str(meta.payment_link_id),
      url: f.paymentLink,
      at: f.paymentStatus === 'paid' ? (f.paidAt?.toISOString() ?? null) : null,
      ...base,
    });
  }
  if (paidVia && paidVia !== 'razorpay_link') {
    out.push({
      kind: 'gateway',
      gateway: paidVia,
      status: 'paid',
      reference: str(meta.gateway_payment_id) ?? str(meta.razorpay_payment),
      url: null,
      at: f.paidAt?.toISOString() ?? null,
      ...base,
    });
  } else if (paidVia === 'razorpay_link') {
    // The payment id Razorpay reported rides on the link record above; it is repeated on the settlement so a list of payments shows it.
    const link = out.find((p) => p.kind === 'payment_link');
    if (link) {
      link.reference = str(meta.razorpay_payment) ?? link.reference;
    } else {
      out.push({
        kind: 'payment_link',
        gateway: 'razorpay',
        status: 'paid',
        reference: str(meta.razorpay_payment) ?? str(meta.razorpay_plink),
        url: null,
        at: f.paidAt?.toISOString() ?? null,
        ...base,
      });
    }
  }
  if (f.waPaymentStatus) {
    out.push({
      kind: 'whatsapp_pay',
      gateway: null,
      status: ['captured', 'paid', 'success', 'completed'].includes(f.waPaymentStatus.toLowerCase())
        ? 'paid'
        : 'awaiting',
      reference: f.waPaymentTxnId,
      url: null,
      at: null,
      ...base,
    });
  }
  // Marked paid by hand: a status with no payment behind it.
  if (f.paymentStatus === 'paid' && !paidVia && !f.waPaymentStatus && f.paymentMethod !== 'cod') {
    out.push({
      kind: 'manual',
      gateway: null,
      status: 'paid',
      reference: null,
      url: null,
      at: f.paidAt?.toISOString() ?? null,
      ...base,
    });
  }
  return out;
}

export interface AuditEntry {
  at: Date;
  actorType: string;
  action: string;
  delta: Record<string, { old: unknown; new: unknown }> | null;
}

const actorOf = (type: string): string =>
  type === 'user' || type === 'system' ? type : type || 'system';

/** The history of an order, oldest first: how it was placed, then every recorded change. */
export function buildTimeline(
  order: { source: string; createdAt: Date },
  audit: readonly AuditEntry[],
): StoreOrderTimelineEntry[] {
  const out: StoreOrderTimelineEntry[] = [
    {
      at: order.createdAt.toISOString(),
      kind: 'created',
      detail: `Placed via ${order.source}`,
      actor: order.source === 'storefront' ? 'customer' : 'system',
    },
  ];
  for (const a of [...audit].sort((x, y) => x.at.getTime() - y.at.getTime())) {
    if (a.action === 'insert') continue;
    const d = a.delta ?? {};
    const at = a.at.toISOString();
    const actor = actorOf(a.actorType);
    let any = false;
    if (d.status) {
      any = true;
      const to = String(d.status.new);
      out.push({
        at,
        kind: to === 'paid' && actor === 'system' ? 'paid' : 'status_changed',
        detail: `${String(d.status.old)} → ${to}`,
        actor,
      });
    }
    if (d.paymentLink) {
      any = true;
      out.push({
        at,
        kind: 'payment_link',
        detail: d.paymentLink.new ? 'Payment link issued' : 'Payment link removed',
        actor,
      });
    }
    if (d.invoiceId) {
      any = true;
      out.push({ at, kind: 'invoice', detail: 'Invoice created', actor });
    }
    if (d.notes) {
      any = true;
      out.push({ at, kind: 'note', detail: null, actor });
    }
    if (!any) out.push({ at, kind: 'updated', detail: null, actor });
  }
  return out;
}
