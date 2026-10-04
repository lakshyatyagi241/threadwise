import { STORE_CART_MAX_LINES, STORE_CART_MAX_QTY, type PublicProduct } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addOne,
  addQty,
  capFor,
  cartCount,
  cartSubtotal,
  cartTotal,
  parseStoredCart,
  parseStoredIds,
  removeLine,
  setQty,
  shippingFee,
  shippingRow,
  storageKeys,
  toRequestItems,
  type CartLine,
  type Shipping,
} from './cart';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const product = (n: number, over: Partial<PublicProduct> = {}): PublicProduct => ({
  id: uuid(n),
  slug: `p-${n}`,
  name: `Product ${n}`,
  sku: null,
  description: null,
  bodyHtml: null,
  priceMinor: 10000,
  priceDisplay: '₹ 100',
  comparePriceMinor: null,
  comparePriceDisplay: null,
  onSale: false,
  currencyCode: 'INR',
  imageUrl: null,
  galleryUrls: [],
  category: null,
  stockQty: null,
  brand: null,
  ...over,
});
const line = (n: number, qty: number, price = 10000): CartLine => ({
  id: uuid(n),
  name: `Product ${n}`,
  price,
  image: null,
  qty,
});

describe('stock cap', () => {
  it('uses the tracked stock, and 999 when stock is unlimited or larger', () => {
    expect(capFor(product(1, { stockQty: 3 }))).toEqual({ cap: 3, reason: 'stock' });
    expect(capFor(product(1, { stockQty: 0 }))).toEqual({ cap: 0, reason: 'stock' });
    expect(capFor(product(1, { stockQty: null }))).toEqual({
      cap: STORE_CART_MAX_QTY,
      reason: 'max',
    });
    expect(capFor(product(1, { stockQty: 5000 }))).toEqual({
      cap: STORE_CART_MAX_QTY,
      reason: 'max',
    });
    expect(capFor(undefined)).toEqual({ cap: STORE_CART_MAX_QTY, reason: 'max' });
  });
});

describe('add to cart (card button)', () => {
  it('adds one unit and merges repeats', () => {
    const p = product(1);
    const a = addOne([], p);
    expect(a).toMatchObject({ kind: 'ok', cart: [{ id: p.id, qty: 1, price: 10000 }] });
    const b = addOne(a.cart, p);
    expect(b.cart).toHaveLength(1);
    expect(b.cart[0]!.qty).toBe(2);
  });

  it('refuses the unit past the stock and leaves the cart unchanged ("Only 2 in stock")', () => {
    const p = product(1, { stockQty: 2 });
    const out = addOne([line(1, 2)], p);
    expect(out).toMatchObject({ kind: 'capped', cap: { cap: 2, reason: 'stock' } });
    expect(out.cart[0]!.qty).toBe(2);
  });

  it('refuses a sold-out product with a zero cap', () => {
    expect(addOne([], product(1, { stockQty: 0 }))).toMatchObject({
      kind: 'capped',
      cap: { cap: 0 },
    });
  });

  it('stops at 999 on a line and at 100 lines', () => {
    expect(addOne([line(1, 999)], product(1))).toMatchObject({
      kind: 'capped',
      cap: { reason: 'max' },
    });
    const full = Array.from({ length: STORE_CART_MAX_LINES }, (_, i) => line(i + 1, 1));
    expect(addOne(full, product(500)).kind).toBe('full');
    expect(addOne(full, product(1)).kind).toBe('ok');
  });
});

describe('quantity add (product page, stepper)', () => {
  it('clamps to the stock instead of refusing, and says so', () => {
    const p = product(1, { stockQty: 3 });
    const fresh = addQty([], p, 5);
    expect(fresh.cart[0]!.qty).toBe(3);
    expect(fresh.clamped).toEqual({ cap: 3, reason: 'stock' });
    const more = addQty([line(1, 2)], p, 5);
    expect(more.cart[0]!.qty).toBe(3);
    expect(more.clamped?.cap).toBe(3);
  });

  it('adds within the cap without a warning', () => {
    const out = addQty([line(1, 1)], product(1, { stockQty: 10 }), 4);
    expect(out.cart[0]!.qty).toBe(5);
    expect(out.clamped).toBeNull();
  });

  it('never goes below one for a decrement', () => {
    expect(addQty([line(1, 1)], product(1), -1).cart[0]!.qty).toBe(1);
  });

  it('does not add a sold-out product', () => {
    const out = addQty([], product(1, { stockQty: 0 }), 1);
    expect(out.cart).toEqual([]);
    expect(out.clamped?.cap).toBe(0);
  });
});

describe('typed quantity in the drawer', () => {
  it('is at least 1 and clamped to stock; unknown product is only limited to 999', () => {
    const cart = [line(1, 2)];
    expect(setQty(cart, uuid(1), 0, product(1)).cart[0]!.qty).toBe(1);
    expect(setQty(cart, uuid(1), Number.NaN, product(1)).cart[0]!.qty).toBe(1);
    const clamped = setQty(cart, uuid(1), 9, product(1, { stockQty: 4 }));
    expect(clamped.cart[0]!.qty).toBe(4);
    expect(clamped.clamped?.cap).toBe(4);
    expect(setQty(cart, uuid(1), 5000, undefined).cart[0]!.qty).toBe(STORE_CART_MAX_QTY);
    expect(setQty(cart, uuid(9), 3, undefined).cart).toEqual(cart);
  });

  it('removes a line', () => {
    expect(removeLine([line(1, 1), line(2, 1)], uuid(1)).map((l) => l.id)).toEqual([uuid(2)]);
  });
});

describe('totals and shipping (WD-STORE-012 acceptance)', () => {
  const ship: Shipping = { flatMinor: 5000, freeAboveMinor: 50000, note: null };

  it('counts and sums', () => {
    const cart = [line(1, 2, 10000), line(2, 1, 5000)];
    expect(cartCount(cart)).toBe(3);
    expect(cartSubtotal(cart)).toBe(25000);
  });

  it('flat fee 50.00 free above 500.00: 520.00 ships free, 300.00 pays the fee', () => {
    expect(shippingFee(ship, 52000)).toBe(0);
    expect(shippingFee(ship, 50000)).toBe(0);
    expect(shippingFee(ship, 30000)).toBe(5000);
    expect(cartTotal([line(1, 1, 52000)], ship)).toBe(52000);
    expect(cartTotal([line(1, 1, 30000)], ship)).toBe(35000);
  });

  it('is free without a rule, and without a free-above amount it always charges the fee', () => {
    expect(shippingFee(null, 100)).toBe(0);
    expect(shippingFee({ flatMinor: 5000, freeAboveMinor: 0, note: null }, 9_000_000)).toBe(5000);
  });

  it('shows what the drawer row shows', () => {
    expect(shippingRow(ship, 52000)).toEqual({ kind: 'free' });
    expect(shippingRow(ship, 30000)).toEqual({ kind: 'fee', fee: 5000, remaining: 20000 });
    expect(shippingRow({ flatMinor: 5000, freeAboveMinor: 0, note: null }, 100)).toEqual({
      kind: 'fee',
      fee: 5000,
      remaining: 0,
    });
    expect(shippingRow({ flatMinor: 0, freeAboveMinor: 100, note: 'x' }, 500)).toEqual({
      kind: 'none',
    });
    expect(shippingRow(null, 500)).toEqual({ kind: 'none' });
  });
});

describe('request items', () => {
  it('carry ids and quantities only, never prices', () => {
    expect(toRequestItems([line(1, 2, 999)])).toEqual([{ id: uuid(1), qty: 2 }]);
  });
});

describe('storage', () => {
  it('reads a stored cart defensively', () => {
    expect(parseStoredCart(null)).toEqual([]);
    expect(parseStoredCart('not json')).toEqual([]);
    expect(parseStoredCart('{"a":1}')).toEqual([]);
    const raw = JSON.stringify([
      { id: uuid(1), name: 'A', price: 100, image: 'https://x/y.png', qty: 2 },
      { id: uuid(1), name: 'dupe', price: 1, image: null, qty: 1 },
      { id: uuid(2), name: 'B', price: -5, image: '', qty: 5000 },
      { id: uuid(3), name: 'C', price: 1, image: null, qty: 0 },
      { id: 7, name: 'D', price: 1, qty: 1 },
      null,
    ]);
    expect(parseStoredCart(raw)).toEqual([
      { id: uuid(1), name: 'A', price: 100, image: 'https://x/y.png', qty: 2 },
      { id: uuid(2), name: 'B', price: 0, image: null, qty: STORE_CART_MAX_QTY },
    ]);
  });

  it('keeps at most 100 stored lines', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: uuid(i + 1),
      name: 'n',
      price: 1,
      image: null,
      qty: 1,
    }));
    expect(parseStoredCart(JSON.stringify(many))).toHaveLength(STORE_CART_MAX_LINES);
  });

  it('reads id lists and caps them', () => {
    expect(parseStoredIds(null)).toEqual([]);
    expect(parseStoredIds('[1,"a","a","",null,"b"]')).toEqual(['a', 'b']);
    expect(parseStoredIds('["a","b","c","d","e"]', 4)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps two shops apart', () => {
    expect(storageKeys('alpha').cart).not.toBe(storageKeys('beta').cart);
    expect(storageKeys('alpha')).toEqual({
      cart: 'sf_cart_alpha',
      wish: 'sf_wish_alpha',
      compare: 'sf_compare_alpha',
    });
  });
});
