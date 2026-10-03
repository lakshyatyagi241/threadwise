import { STORE_CART_MAX_LINES, STORE_CART_MAX_QTY, type PublicProduct } from '@crm/contracts';

/**
 * The buyer's cart (TW-STORE-012): a list in the browser, one per shop. A line carries the price it was added at, for display
 * only: the server re-prices every line. All functions are pure; the caller stores the result.
 */
export interface CartLine {
  id: string;
  name: string;
  /** Minor units when added. */
  price: number;
  image: string | null;
  qty: number;
}

export interface Shipping {
  flatMinor: number;
  freeAboveMinor: number;
  note: string | null;
}

export type CapReason = 'stock' | 'max';
export interface Cap {
  cap: number;
  reason: CapReason;
}

/** How many of a product the cart may hold: its tracked stock (null = unlimited), never more than 999 on a line. */
export function capFor(product: Pick<PublicProduct, 'stockQty'> | undefined): Cap {
  const stock = product?.stockQty;
  if (stock === null || stock === undefined) return { cap: STORE_CART_MAX_QTY, reason: 'max' };
  const tracked = Math.max(0, Math.trunc(stock));
  return tracked < STORE_CART_MAX_QTY
    ? { cap: tracked, reason: 'stock' }
    : { cap: STORE_CART_MAX_QTY, reason: 'max' };
}

export const cartCount = (cart: readonly CartLine[]): number => cart.reduce((n, l) => n + l.qty, 0);
export const cartSubtotal = (cart: readonly CartLine[]): number =>
  cart.reduce((n, l) => n + l.price * l.qty, 0);

/** Flat fee, waived once the subtotal reaches the free-above amount (when one is set). */
export function shippingFee(shipping: Shipping | null, subtotal: number): number {
  if (!shipping) return 0;
  if (shipping.freeAboveMinor > 0 && subtotal >= shipping.freeAboveMinor) return 0;
  return shipping.flatMinor;
}

export const cartTotal = (cart: readonly CartLine[], shipping: Shipping | null): number => {
  const sub = cartSubtotal(cart);
  return sub + shippingFee(shipping, sub);
};

export type ShippingRow =
  { kind: 'none' } | { kind: 'free' } | { kind: 'fee'; fee: number; remaining: number };

/** What the drawer's shipping row shows: nothing without a flat fee, FREE above the threshold, else the fee and what is left to save it. */
export function shippingRow(shipping: Shipping | null, subtotal: number): ShippingRow {
  if (!shipping || shipping.flatMinor <= 0) return { kind: 'none' };
  const fee = shippingFee(shipping, subtotal);
  if (fee === 0)
    return shipping.freeAboveMinor > 0 && subtotal >= shipping.freeAboveMinor
      ? { kind: 'free' }
      : { kind: 'none' };
  const remaining =
    shipping.freeAboveMinor > 0 && subtotal < shipping.freeAboveMinor
      ? shipping.freeAboveMinor - subtotal
      : 0;
  return { kind: 'fee', fee, remaining };
}

export type AddOutcome =
  | { kind: 'ok'; cart: CartLine[] }
  /** Over the cap: nothing changed. `cap` is the limit that was hit. */
  | { kind: 'capped'; cart: CartLine[]; cap: Cap }
  | { kind: 'full'; cart: CartLine[] };

const lineOf = (p: PublicProduct, qty: number): CartLine => ({
  id: p.id,
  name: p.name,
  price: p.priceMinor,
  image: p.imageUrl,
  qty,
});

/** The card's "Add to cart": one more unit, refused past the cap or past 100 lines. */
export function addOne(cart: readonly CartLine[], product: PublicProduct): AddOutcome {
  const cap = capFor(product);
  const existing = cart.find((l) => l.id === product.id);
  const have = existing?.qty ?? 0;
  if (have + 1 > cap.cap) return { kind: 'capped', cart: [...cart], cap };
  if (!existing && cart.length >= STORE_CART_MAX_LINES) return { kind: 'full', cart: [...cart] };
  const next = existing
    ? cart.map((l) => (l.id === product.id ? { ...l, qty: l.qty + 1 } : l))
    : [...cart, lineOf(product, 1)];
  return { kind: 'ok', cart: next };
}

export interface QtyOutcome {
  cart: CartLine[];
  /** The request went past the cap and was clamped to it. */
  clamped: Cap | null;
  full?: boolean;
}

/** The product page's quantity add and the drawer's +/- : clamps to the cap instead of refusing. */
export function addQty(cart: readonly CartLine[], product: PublicProduct, qty: number): QtyOutcome {
  const cap = capFor(product);
  const existing = cart.find((l) => l.id === product.id);
  const wanted = (existing?.qty ?? 0) + qty;
  if (qty > 0 && wanted > cap.cap) {
    if (existing) {
      return {
        cart: cart.map((l) => (l.id === product.id ? { ...l, qty: cap.cap } : l)),
        clamped: cap,
      };
    }
    if (cap.cap > 0 && cart.length < STORE_CART_MAX_LINES) {
      return { cart: [...cart, lineOf(product, cap.cap)], clamped: cap };
    }
    return { cart: [...cart], clamped: cap, full: cart.length >= STORE_CART_MAX_LINES };
  }
  if (existing) {
    return {
      cart: cart.map((l) => (l.id === product.id ? { ...l, qty: Math.max(1, wanted) } : l)),
      clamped: null,
    };
  }
  if (qty > 0) {
    if (cart.length >= STORE_CART_MAX_LINES) return { cart: [...cart], clamped: null, full: true };
    return { cart: [...cart, lineOf(product, qty)], clamped: null };
  }
  return { cart: [...cart], clamped: null };
}

/** Typing a quantity in the drawer: at least 1, clamped to the cap (an unknown product is only clamped to 999). */
export function setQty(
  cart: readonly CartLine[],
  id: string,
  raw: number,
  product: PublicProduct | undefined,
): QtyOutcome {
  const line = cart.find((l) => l.id === id);
  if (!line) return { cart: [...cart], clamped: null };
  const cap = capFor(product);
  const wanted = Number.isFinite(raw) ? Math.max(1, Math.trunc(raw)) : 1;
  if (wanted > cap.cap) {
    return { cart: cart.map((l) => (l.id === id ? { ...l, qty: cap.cap } : l)), clamped: cap };
  }
  return { cart: cart.map((l) => (l.id === id ? { ...l, qty: wanted } : l)), clamped: null };
}

export const removeLine = (cart: readonly CartLine[], id: string): CartLine[] =>
  cart.filter((l) => l.id !== id);

/** The request body's lines: ids and quantities only. */
export const toRequestItems = (cart: readonly CartLine[]) =>
  cart.map((l) => ({ id: l.id, qty: l.qty }));

/** Reads a stored cart defensively: anything malformed is dropped, never thrown. */
export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: CartLine[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (out.length >= STORE_CART_MAX_LINES) break;
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id === '' || seen.has(r.id)) continue;
    const qty = typeof r.qty === 'number' ? Math.trunc(r.qty) : NaN;
    if (!(qty >= 1)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      name: typeof r.name === 'string' ? r.name : '',
      price: typeof r.price === 'number' && r.price >= 0 ? Math.trunc(r.price) : 0,
      image: typeof r.image === 'string' && r.image !== '' ? r.image : null,
      qty: Math.min(qty, STORE_CART_MAX_QTY),
    });
  }
  return out;
}

/** Wishlist and compare lists: arrays of product ids. */
export function parseStoredIds(raw: string | null, max = 500): string[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return [...new Set(data.filter((v): v is string => typeof v === 'string' && v !== ''))].slice(
      0,
      max,
    );
  } catch {
    return [];
  }
}

export const storageKeys = (slug: string) => ({
  cart: `sf_cart_${slug}`,
  wish: `sf_wish_${slug}`,
  compare: `sf_compare_${slug}`,
});

/** Storage that may be missing or blocked (private mode): every read and write is guarded. */
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* works without it: the cart just does not survive a reload */
  }
}
