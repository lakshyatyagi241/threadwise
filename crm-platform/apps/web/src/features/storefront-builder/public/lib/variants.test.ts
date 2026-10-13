import type { PublicProduct, PublicVariant } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { addOne, addQty, parseStoredCart, reconcileCart, removeLine, toRequestItems } from './cart';
import {
  allVariantsSoldOut,
  emptySelection,
  findVariant,
  firstMissingOption,
  fromPrice,
  hasVariants,
  valueState,
} from './variants';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const variant = (
  n: number,
  values: string[],
  over: Partial<PublicVariant> = {},
): PublicVariant => ({
  id: uuid(100 + n),
  title: values.join(' / '),
  optionValues: values,
  sku: null,
  priceMinor: 10000,
  priceDisplay: '₹ 100',
  comparePriceMinor: null,
  comparePriceDisplay: null,
  imageUrl: null,
  stockQty: null,
  ...over,
});
const shirt = (variants: PublicVariant[]): PublicProduct =>
  ({
    id: uuid(1),
    slug: 'shirt',
    name: 'Shirt',
    sku: null,
    description: null,
    bodyHtml: null,
    priceMinor: 10000,
    priceDisplay: '₹ 100',
    comparePriceMinor: null,
    comparePriceDisplay: null,
    onSale: false,
    currencyCode: 'INR',
    imageUrl: 'p.jpg',
    galleryUrls: [],
    category: null,
    stockQty: null,
    brand: null,
    options: [
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Red', 'Blue'] },
    ],
    variants,
  }) as PublicProduct;

const all = () => [
  variant(1, ['S', 'Red'], { priceMinor: 9000, priceDisplay: '₹ 90' }),
  variant(2, ['S', 'Blue'], { stockQty: 0 }),
  variant(3, ['M', 'Red'], { stockQty: 2, imageUrl: 'm-red.jpg' }),
  variant(4, ['M', 'Blue'], { stockQty: 0 }),
];

describe('variant selection', () => {
  it('needs every option chosen before a variant is found', () => {
    const p = shirt(all());
    expect(hasVariants(p)).toBe(true);
    expect(findVariant(p, ['S', null])).toBeUndefined();
    expect(firstMissingOption(['S', null])).toBe(1);
    expect(findVariant(p, ['m', 'red'])?.id).toBe(uuid(103));
    expect(emptySelection(p)).toEqual([null, null]);
  });

  it('marks a value sold out given the other chosen options', () => {
    const p = shirt(all());
    expect(valueState(p, ['M', null], 1, 'Blue')).toEqual({ exists: true, available: false });
    expect(valueState(p, ['M', null], 1, 'Red')).toEqual({ exists: true, available: true });
    expect(valueState(p, [null, null], 1, 'Red')).toEqual({ exists: true, available: true });
  });

  it('shows the lowest buyable price and whether prices differ', () => {
    const p = shirt(all());
    expect(fromPrice(p)).toMatchObject({ minor: 9000, varies: true });
    expect(allVariantsSoldOut(shirt(all().map((v) => ({ ...v, stockQty: 0 }))))).toBe(true);
  });
});

describe('variant cart lines', () => {
  it('keeps different variants of one product on separate lines and merges identical ones', () => {
    const p = shirt(all());
    const [a, , c] = p.variants!;
    let cart = addOne([], p, a).cart;
    cart = addOne(cart, p, c).cart;
    cart = addOne(cart, p, a).cart;
    expect(cart).toHaveLength(2);
    expect(cart[0]).toMatchObject({
      variantId: a!.id,
      variantTitle: 'S / Red',
      qty: 2,
      price: 9000,
    });
    expect(cart[1]).toMatchObject({ variantId: c!.id, image: 'm-red.jpg' });
  });

  it('caps by the variant stock, not the product stock', () => {
    const p = shirt(all());
    const c = p.variants![2]!;
    const out = addQty([], p, 5, c);
    expect(out.clamped).toEqual({ cap: 2, reason: 'stock' });
    expect(out.cart[0]!.qty).toBe(2);
  });

  it('removes only the named variant line and sends variantId in the request items', () => {
    const p = shirt(all());
    const cart = addOne(addOne([], p, p.variants![0]).cart, p, p.variants![2]).cart;
    expect(toRequestItems(cart)).toEqual([
      { id: p.id, variantId: uuid(101), qty: 1 },
      { id: p.id, variantId: uuid(103), qty: 1 },
    ]);
    expect(removeLine(cart, p.id, uuid(101))).toHaveLength(1);
  });
});

describe('cart migration and reconcile', () => {
  it('reads a cart saved before variants, and drops its line once the product has variants', () => {
    const stored = JSON.stringify([
      { id: uuid(1), name: 'Shirt', price: 10000, image: null, qty: 1 },
    ]);
    const cart = parseStoredCart(stored);
    expect(cart).toHaveLength(1);
    expect(cart[0]!.variantId).toBeUndefined();
    const res = reconcileCart(cart, { [uuid(1)]: shirt(all()) });
    expect(res).toMatchObject({ dropped: 1, changed: true, cart: [] });
  });

  it('drops sold-out or removed variants, re-prices and clamps the rest', () => {
    const p = shirt(all());
    const cart = [
      {
        id: p.id,
        name: 'Old',
        price: 1,
        image: null,
        qty: 5,
        variantId: uuid(103),
        variantTitle: 'x',
      },
      {
        id: p.id,
        name: 'Shirt',
        price: 1,
        image: null,
        qty: 1,
        variantId: uuid(102),
        variantTitle: 'S / Blue',
      },
      {
        id: p.id,
        name: 'Shirt',
        price: 1,
        image: null,
        qty: 1,
        variantId: uuid(999),
        variantTitle: 'gone',
      },
    ];
    const res = reconcileCart(cart, { [p.id]: p });
    expect(res.dropped).toBe(2);
    expect(res.cart).toHaveLength(1);
    expect(res.cart[0]).toMatchObject({
      name: 'Shirt',
      price: 10000,
      qty: 2,
      variantTitle: 'M / Red',
    });
  });

  it('parses stored variant lines and does not merge them', () => {
    const row = (v: string) => ({
      id: uuid(1),
      name: 'Shirt',
      price: 1,
      image: null,
      qty: 1,
      variantId: v,
      variantTitle: 'T',
    });
    const cart = parseStoredCart(JSON.stringify([row(uuid(101)), row(uuid(103)), row(uuid(101))]));
    expect(cart.map((l) => l.variantId)).toEqual([uuid(101), uuid(103)]);
  });
});
