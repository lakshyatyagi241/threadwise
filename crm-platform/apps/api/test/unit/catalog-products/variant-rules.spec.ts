import { describe, expect, it } from 'vitest';
import {
  computeAggregate,
  diffVariants,
  toVariantWrite,
  variantRetailerId,
  variantSellable,
  type StoredVariant,
  type VariantWrite,
} from '../../../src/modules/catalog-products/variant-rules';

const major = (m: string) => Math.round(Number(m) * 100);
const v = (o: Partial<VariantWrite> = {}): VariantWrite => ({
  title: 'M',
  optionValues: ['M'],
  sku: null,
  priceMinor: 1000,
  comparePriceMinor: null,
  imageUrl: null,
  weightGrams: null,
  stockQty: 5,
  active: true,
  position: 0,
  ...o,
});
const stored = (id: number, o: Partial<VariantWrite> = {}): StoredVariant => ({
  ...v(o),
  id,
  uuid: `u${id}`,
});

describe('variant aggregate (invariant 1)', () => {
  it('is null without variants', () => {
    expect(computeAggregate([], 500)).toBeNull();
  });
  it('takes the lowest active price, summed stock and held total', () => {
    const a = computeAggregate(
      [
        { priceMinor: 2000, stockQty: 3, reservedQty: 1, active: true },
        { priceMinor: 1500, stockQty: 4, reservedQty: 0, active: true },
        { priceMinor: 100, stockQty: 9, reservedQty: 2, active: false },
      ],
      999,
    );
    expect(a).toEqual({ priceMinor: 1500, stockQty: 7, reservedQty: 3, inStock: true });
  });
  it('is unlimited when any active variant is unlimited; NULL price reads as the product price', () => {
    const a = computeAggregate(
      [
        { priceMinor: null, stockQty: null, reservedQty: 0, active: true },
        { priceMinor: 3000, stockQty: 2, reservedQty: 0, active: true },
      ],
      800,
    );
    expect(a).toMatchObject({ priceMinor: 800, stockQty: null, inStock: true });
  });
  it('is out of stock when every variant is held or inactive', () => {
    const a = computeAggregate(
      [
        { priceMinor: 1000, stockQty: 2, reservedQty: 2, active: true },
        { priceMinor: 900, stockQty: 5, reservedQty: 0, active: false },
      ],
      1000,
    );
    expect(a?.inStock).toBe(false);
    expect(a?.priceMinor).toBe(1000);
  });
  it('variantSellable needs active and stock not held', () => {
    expect(variantSellable({ active: true, stockQty: null, reservedQty: 9 })).toBe(true);
    expect(variantSellable({ active: true, stockQty: 1, reservedQty: 1 })).toBe(false);
    expect(variantSellable({ active: false, stockQty: 5, reservedQty: 0 })).toBe(false);
  });
});

describe('variant retailer id (invariant 5)', () => {
  it('prefers meta id, then sku, then product id with position + 1', () => {
    expect(variantRetailerId({ metaRetailerId: 'm', sku: 's', position: 0 }, 'P')).toBe('m');
    expect(variantRetailerId({ metaRetailerId: null, sku: 's', position: 0 }, 'P')).toBe('s');
    expect(variantRetailerId({ metaRetailerId: null, sku: null, position: 2 }, 'P')).toBe('P-3');
  });
});

describe('toVariantWrite (invariant 2)', () => {
  it('resolves a missing price to the form price and trims the sku', () => {
    const w = toVariantWrite({ optionValues: ['M', 'Red'], sku: ' ab ' } as never, 1, 4200, major);
    expect(w).toMatchObject({
      title: 'M / Red',
      sku: 'ab',
      priceMinor: 4200,
      position: 1,
      active: true,
      stockQty: null,
    });
  });
  it('uses its own price and drops a zero compare price', () => {
    const w = toVariantWrite(
      { optionValues: ['L'], priceMajor: '12.50', comparePriceMajor: '0' } as never,
      0,
      4200,
      major,
    );
    expect(w.priceMinor).toBe(1250);
    expect(w.comparePriceMinor).toBeNull();
  });
});

describe('diffVariants', () => {
  it('keeps by id, inserts id-less new, removes unlisted, flags unknown ids', () => {
    const d = diffVariants(
      [stored(1, { title: 'S' }), stored(2, { title: 'M' }), stored(3, { title: 'L' })],
      [
        { id: 'u1', write: v({ title: 'S', priceMinor: 1100 }) },
        { write: v({ title: 'XL' }) },
        { id: 'zzz', write: v({ title: 'Q' }) },
      ],
    );
    expect(d.keep.map((k) => [k.stored.id, k.changed])).toEqual([[1, true]]);
    expect(d.insert.map((i) => i.next.title)).toEqual(['XL']);
    expect(d.remove.map((r) => r.id).sort()).toEqual([2, 3]);
    expect(d.unknownIds).toEqual(['zzz']);
  });
  it('keeps an id-less input matching an unclaimed stored title, unchanged when equal', () => {
    const d = diffVariants([stored(1, { title: 'M' })], [{ write: v({ title: 'm' }) }]);
    expect(d.keep).toHaveLength(1);
    expect(d.insert).toHaveLength(0);
    expect(d.remove).toHaveLength(0);
  });
});
