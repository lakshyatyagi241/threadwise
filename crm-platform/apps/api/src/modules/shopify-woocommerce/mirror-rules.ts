import { wooPhoneOf } from './woo-phone';

/**
 * Pure rules of mirroring a store into the CRM (TW-ECOM-011, 012): a store's product, order or customer as it arrives, into the rows
 * the catalog, checkout and contacts tables hold. No database and no network, so each can be tested alone. Nothing here trusts the
 * store: every field is picked out and coerced.
 */

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | null =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : null;
const digits = (x: unknown): string => (str(x) ?? '').replace(/\D+/g, '');

export type StoreKind = 'shopify' | 'woocommerce';

/** A price as the store writes it ("19.99") into minor units. Empty or unreadable is 0. */
export function toMinor(price: unknown): number {
  const s = str(price);
  if (s === null || s === '') return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** A name as a URL slug: lower case words joined by hyphens. */
export const slugify = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export interface MirrorProduct {
  /** The store's own id for the product. */
  storeId: string;
  sku: string;
  name: string;
  slug: string;
  description: string;
  bodyHtml: string;
  priceMinor: number;
  /** Only set when the list price is above the selling price (the strike-through price). */
  comparePriceMinor: number | null;
  currency: string;
  imageUrl: string | null;
  gallery: string[];
  inStock: boolean;
  status: 'active' | 'draft' | 'archived';
  category: string | null;
  brand: string | null;
  productUrl: string;
  tags: string[];
}

export interface MirrorOrder {
  storeId: string;
  /** Digits only, or null when the order has no usable number. */
  phone: string | null;
  name: string | null;
  email: string | null;
  items: Array<{ title: string; qty: number; price: string; sku: string | null }>;
  totalMinor: number;
  currency: string;
  status: 'new' | 'paid' | 'shipped' | 'cancelled';
  meta: Record<string, unknown>;
}

export interface MirrorCustomer {
  storeId: string;
  /** Digits only: a customer with no number is not mirrored, WhatsApp needs one. */
  phone: string;
  name: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  ordersCount: number;
  totalSpent: string;
}

const fullName = (first: unknown, last: unknown): string =>
  `${str(first) ?? ''} ${str(last) ?? ''}`.trim();

// ── Shopify ─────────────────────────────────────────────────────────────

/**
 * In stock from the variants' tracked inventory: untracked inventory counts as available, tracked inventory is in stock when the
 * total is above zero.
 */
export function shopifyInStock(p: Json): boolean {
  let tracked = false;
  let qty = 0;
  for (const v of arr(p.variants)) {
    const q = obj(v).inventory_quantity;
    if (q !== null && q !== undefined) {
      tracked = true;
      qty += Number(q) || 0;
    }
  }
  return tracked ? qty > 0 : true;
}

const tagList = (tags: unknown): string[] => {
  if (Array.isArray(tags)) return tags.map((t) => (str(t) ?? '').trim()).filter(Boolean);
  const s = str(tags);
  return s
    ? s
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
};

export function shopifyProduct(
  p: Json,
  ctx: { storeUrl: string; currency: string | null },
): MirrorProduct {
  const variant = obj(arr(p.variants)[0]);
  const images = arr(p.images).map(obj);
  const id = str(p.id) ?? '';
  const title = str(p.title) ?? 'Untitled';
  const handle = str(p.handle);
  const status = (str(p.status) ?? 'active').toLowerCase();
  const bodyHtml = str(p.body_html) ?? '';
  return {
    storeId: id,
    // A variant with no SKU is common; an empty SKU would break anything that looks a product up by it.
    sku: str(variant.sku) || `SHOPIFY-${id}`,
    name: title,
    slug: handle || slugify(title),
    description: bodyHtml.replace(/<[^>]*>/g, ''),
    bodyHtml,
    priceMinor: toMinor(variant.price),
    comparePriceMinor: toMinor(variant.compare_at_price) || null,
    currency: ctx.currency || 'USD',
    imageUrl: str(images[0]?.src) ?? str(obj(p.image).src),
    gallery: images.map((i) => str(i.src)).filter((u): u is string => !!u),
    inStock: shopifyInStock(p),
    status: status === 'draft' ? 'draft' : status === 'archived' ? 'archived' : 'active',
    category: str(p.product_type),
    brand: str(p.vendor),
    productUrl: `https://${ctx.storeUrl}/products/${handle ?? ''}`,
    tags: tagList(p.tags),
  };
}

export function shopifyOrderStatus(o: Json): MirrorOrder['status'] {
  const fin = (str(o.financial_status) ?? '').toLowerCase();
  const ful = (str(o.fulfillment_status) ?? '').toLowerCase();
  if (fin === 'refunded' || fin === 'voided' || o.cancelled_at) return 'cancelled';
  if (ful === 'fulfilled') return 'shipped';
  if (fin === 'paid') return 'paid';
  return 'new';
}

export function shopifyOrder(o: Json, ctx: { currency: string | null }): MirrorOrder {
  const cust = obj(o.customer);
  const name = fullName(cust.first_name, cust.last_name);
  const phone = digits(str(cust.phone) ?? str(o.phone) ?? str(obj(o.shipping_address).phone));
  return {
    storeId: str(o.id) ?? '',
    phone: phone === '' ? null : phone,
    name: name === '' ? null : name,
    email: str(cust.email) ?? str(o.email),
    items: arr(o.line_items).map((li) => {
      const l = obj(li);
      return {
        title: str(l.title) ?? '',
        qty: Number(l.quantity) || 1,
        price: str(l.price) ?? '0',
        sku: str(l.sku),
      };
    }),
    totalMinor: toMinor(o.total_price),
    currency: str(o.currency) || ctx.currency || 'USD',
    status: shopifyOrderStatus(o),
    meta: {
      name: str(o.name),
      order_number: o.order_number ?? null,
      financial_status: str(o.financial_status),
      fulfillment_status: str(o.fulfillment_status),
      created_at: str(o.created_at),
    },
  };
}

export function shopifyCustomer(c: Json): MirrorCustomer | null {
  const phone = digits(c.phone);
  if (phone === '') return null;
  return {
    storeId: str(c.id) ?? '',
    phone,
    name: fullName(c.first_name, c.last_name) || phone,
    email: str(c.email),
    firstName: str(c.first_name),
    lastName: str(c.last_name),
    ordersCount: Number(c.orders_count) || 0,
    totalSpent: str(c.total_spent) ?? '0',
  };
}

// ── WooCommerce ─────────────────────────────────────────────────────────

/** `outofstock` is out, `instock` and `onbackorder` are in; without a status, managed stock is in stock above zero. */
export function wooInStock(p: Json): boolean {
  const status = (str(p.stock_status) ?? '').toLowerCase();
  if (status === 'outofstock') return false;
  if (status === 'instock' || status === 'onbackorder') return true;
  if (p.manage_stock && p.stock_quantity !== null && p.stock_quantity !== undefined) {
    return (Number(p.stock_quantity) || 0) > 0;
  }
  return true;
}

const firstName = (list: unknown): string | null => str(obj(arr(list)[0]).name);
const wooTags = (tags: unknown): string[] =>
  arr(tags)
    .map((t) => (typeof t === 'object' && t !== null ? str(obj(t).name) : str(t)))
    .filter((t): t is string => !!t);

export function wooProduct(
  p: Json,
  ctx: { storeUrl: string; currency: string | null },
): MirrorProduct {
  const images = arr(p.images).map(obj);
  const id = str(p.id) ?? '';
  const name = str(p.name) ?? 'Untitled';
  // `price` is the selling price, `regular_price` the list price: a strike-through only when it is actually discounted.
  const priceMinor = toMinor(p.price ?? p.regular_price);
  const regular = toMinor(p.regular_price);
  const status = (str(p.status) ?? 'publish').toLowerCase();
  return {
    storeId: id,
    sku: str(p.sku) || `WOO-${id}`,
    name,
    slug: str(p.slug) || slugify(name),
    description: (str(p.short_description) ?? str(p.description) ?? '')
      .replace(/<[^>]*>/g, '')
      .trim(),
    bodyHtml: str(p.description) ?? '',
    priceMinor,
    comparePriceMinor: regular > priceMinor ? regular : null,
    currency: ctx.currency || 'USD',
    imageUrl: str(images[0]?.src),
    gallery: images.map((i) => str(i.src)).filter((u): u is string => !!u),
    inStock: wooInStock(p),
    status: status === 'trash' ? 'archived' : status === 'publish' ? 'active' : 'draft',
    category: firstName(p.categories),
    brand: firstName(p.brands),
    productUrl: str(p.permalink) ?? `${ctx.storeUrl}/?p=${id}`,
    tags: wooTags(p.tags),
  };
}

export function wooOrderStatus(o: Json): MirrorOrder['status'] {
  const s = (str(o.status) ?? '').toLowerCase();
  if (s === 'cancelled' || s === 'refunded' || s === 'failed') return 'cancelled';
  if (s === 'completed') return 'shipped';
  if (s === 'processing') return 'paid';
  // pending, on-hold, checkout-draft and unknown custom statuses are new.
  return 'new';
}

/** An invoice PDF link from the order (a field the companion plugin forwards, or a PDF plugin's order meta). https only. */
export function wooInvoiceUrl(o: Json): string {
  const pick = (v: unknown): string => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.startsWith('https://') ? s : '';
  };
  for (const k of ['invoice_url', 'invoice_pdf_url', 'pdf_invoice_url']) {
    const u = pick(o[k]);
    if (u) return u;
  }
  const wanted = new Set([
    '_wcpdf_invoice_url',
    '_wcpdf_document_link',
    '_wpo_wcpdf_invoice_url',
    '_invoice_url',
    '_pdf_invoice_url',
    'invoice_url',
    'ywpi_invoice_url',
  ]);
  for (const m of arr(o.meta_data)) {
    const meta = obj(m);
    if (wanted.has(str(meta.key) ?? '')) {
      const u = pick(meta.value);
      if (u) return u;
    }
  }
  return '';
}

export function wooOrder(o: Json, ctx: { currency: string | null }): MirrorOrder {
  const billing = obj(o.billing);
  const name = fullName(billing.first_name, billing.last_name);
  const phone = wooPhoneOf(o);
  const number = o.number ?? o.id ?? '';
  return {
    storeId: str(o.id) ?? '',
    phone: phone ? phone.replace(/\D+/g, '') || null : null,
    name: name === '' ? null : name,
    email: str(billing.email),
    items: arr(o.line_items).map((li) => {
      const l = obj(li);
      return {
        title: str(l.name) ?? '',
        qty: Number(l.quantity) || 1,
        price: str(l.price) ?? str(l.total) ?? '0',
        sku: str(l.sku),
      };
    }),
    totalMinor: toMinor(o.total),
    currency: str(o.currency) || ctx.currency || 'USD',
    status: wooOrderStatus(o),
    meta: {
      name: `#${String(number)}`,
      number: o.number ?? null,
      order_number: o.number ?? o.id ?? null,
      woo_status: str(o.status),
      payment_method: str(o.payment_method),
      payment_method_title: str(o.payment_method_title),
      customer_id: o.customer_id ?? null,
      created_at: str(o.date_created),
      invoice_url: wooInvoiceUrl(o),
    },
  };
}

export function wooCustomer(c: Json): MirrorCustomer | null {
  const phone = wooPhoneOf(c)?.replace(/\D+/g, '') ?? '';
  if (phone === '') return null;
  return {
    storeId: str(c.id) ?? '',
    phone,
    name: fullName(c.first_name, c.last_name) || phone,
    email: str(c.email),
    firstName: str(c.first_name),
    lastName: str(c.last_name),
    ordersCount: Number(c.orders_count) || 0,
    totalSpent: str(c.total_spent) ?? '0',
  };
}

/** The contact group a store's customers go into, with the colour Reference gave it (Shopify's green, WooCommerce's purple). */
export const CUSTOMER_GROUP: Record<StoreKind, { name: string; color: string }> = {
  shopify: { name: 'Shopify Customers', color: '#95BF47' },
  woocommerce: { name: 'WooCommerce Customers', color: '#7F54B3' },
};
