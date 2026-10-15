import { describe, expect, it } from 'vitest';
import {
  buildMetaVariantItem,
  metaItemsOf,
  retailerIdOfVariant,
  shareRetailerId,
  type CatalogVariant,
} from '../../../src/modules/catalog-products/catalog-variants';
import { matchVariant } from '../../../src/modules/catalog-products/product-matcher';

const product = {
  id: 7,
  sku: 'HOOD',
  metaRetailerId: null,
  name: 'Hoodie',
  slug: 'hoodie',
  description: 'Warm',
  condition: 'new',
  priceMinor: 99900,
  currencyCode: 'INR',
  imageUrl: 'https://img/p.png',
  galleryUrls: [],
  productUrl: null,
  brand: null,
  category: null,
  googleProductCategory: null,
  availability: 'in stock',
  inStock: true,
  status: 'active',
  stockQty: 8,
  reservedQty: 0,
  options: [{ name: 'Size' }, { name: 'Colour' }],
};

const v = (
  over: Partial<CatalogVariant> & { position: number; optionValues: string[] },
): CatalogVariant => ({
  id: over.position + 1,
  title: over.optionValues.join(' / '),
  sku: null,
  priceMinor: null,
  imageUrl: null,
  stockQty: 5,
  reservedQty: 0,
  active: true,
  metaRetailerId: null,
  ...over,
});

const variants = [
  v({
    position: 0,
    optionValues: ['M', 'Red'],
    sku: 'HOOD-M-RED',
    priceMinor: 109900,
    imageUrl: 'https://img/red.png',
  }),
  v({ position: 1, optionValues: ['L', 'Red'], stockQty: 0 }),
  v({ position: 2, optionValues: ['L', 'Blue'], metaRetailerId: 'custom-3', active: false }),
];

describe('retailer id of a variant (invariant 5)', () => {
  it('is the Meta id, else the SKU, else <product id>-<position + 1>', () => {
    expect(retailerIdOfVariant(product, variants[0]!)).toBe('HOOD-M-RED');
    expect(retailerIdOfVariant(product, variants[1]!)).toBe('HOOD-2');
    expect(retailerIdOfVariant(product, variants[2]!)).toBe('custom-3');
  });
});

describe('Meta items of a product with variants', () => {
  it('sends one item per variant, grouped by the product retailer id, with the variant price, image and availability', () => {
    const items = metaItemsOf(product, variants, 'https://shop.test');
    expect(items.map((i) => i.retailerId)).toEqual(['HOOD-M-RED', 'HOOD-2', 'custom-3']);
    const first = items[0]!.data;
    expect(first).toMatchObject({
      retailer_id: 'HOOD-M-RED',
      item_group_id: 'HOOD',
      name: 'Hoodie - M / Red',
      size: 'M',
      image_url: 'https://img/red.png',
      availability: 'in stock',
      inventory: 5,
    });
    expect(first.price).toBe(109900);
    // No own price: the product's.
    expect(items[1]!.data.price).toBe(99900);
    expect(items[1]!.data.availability).toBe('out of stock');
    // An inactive variant is hidden and out of stock, not deleted.
    expect(items[2]!.data).toMatchObject({ availability: 'out of stock', visibility: 'hidden' });
  });

  it('a product without variants is its one item, unchanged', () => {
    const items = metaItemsOf(product, [], 'https://shop.test');
    expect(items).toHaveLength(1);
    expect(items[0]!.retailerId).toBe('HOOD');
    expect(items[0]!.data.item_group_id).toBeUndefined();
  });

  it('hides the old product-level item once it has been pushed and no variant carries its id', () => {
    const items = metaItemsOf(
      { ...product, metaSyncStatus: 'synced' },
      variants,
      'https://shop.test',
    );
    expect(items.at(-1)).toMatchObject({
      retailerId: 'HOOD',
      data: { availability: 'out of stock', visibility: 'hidden' },
    });
  });

  it('a variant item carries the unlimited stock as no inventory field', () => {
    const data = buildMetaVariantItem(
      product,
      v({ position: 0, optionValues: ['S', 'Red'], stockQty: null }),
      'https://shop.test',
    );
    expect('inventory' in data).toBe(false);
    expect(data.availability).toBe('in stock');
  });
});

describe('the retailer id a product is offered under in a message', () => {
  it('is the first sellable variant, else the first active one, else the product', () => {
    expect(shareRetailerId(product, variants)).toBe('HOOD-M-RED');
    expect(shareRetailerId(product, [variants[1]!, variants[2]!])).toBe('HOOD-2');
    expect(shareRetailerId(product, [variants[2]!])).toBe('HOOD');
    expect(shareRetailerId(product, [])).toBe('HOOD');
  });
});

describe('which variant a customer names', () => {
  const grid = [
    v({ position: 0, optionValues: ['S', 'Red'] }),
    v({ position: 1, optionValues: ['M', 'Red'] }),
    v({ position: 2, optionValues: ['M', 'Blue'] }),
    v({ position: 3, optionValues: ['XL', 'Blue'] }),
    v({ position: 4, optionValues: ['XXL', 'Blue'], active: false }),
  ];
  const names = ['Size', 'Colour'];

  it('matches one variant from both options, in any order or word shape', () => {
    expect(matchVariant(grid, names, 'hoodie medium red').status).toBe('ambiguous'); // "medium" is not a value
    expect(matchVariant(grid, names, 'hoodie red M').variant?.title).toBe('M / Red');
    expect(matchVariant(grid, names, 'a blue hoodie, size m please').variant?.title).toBe(
      'M / Blue',
    );
    expect(matchVariant(grid, names, "men's hoodie xl blue").variant?.title).toBe('XL / Blue');
  });

  it('asks for the missing option when several variants still fit', () => {
    const r = matchVariant(grid, names, 'hoodie in M');
    expect(r.status).toBe('ambiguous');
    expect(r.missing).toEqual(['Colour']);
    expect(r.candidates.map((c) => c.title)).toEqual(['M / Red', 'M / Blue']);
    expect(matchVariant(grid, names, 'hoodie').missing).toEqual(['Size', 'Colour']);
  });

  it('says none when the named combination does not exist or is inactive', () => {
    expect(matchVariant(grid, names, 'hoodie S Blue').status).toBe('none');
    expect(matchVariant(grid, names, 'hoodie XXL').status).not.toBe('matched');
  });

  it('a SKU or the full title typed whole wins, and one active variant needs no words', () => {
    const withSku = [
      v({ position: 0, optionValues: ['S', 'Red'], sku: 'HD-S-R' }),
      ...grid.slice(1),
    ];
    expect(matchVariant(withSku, names, 'hd-s-r').variant?.title).toBe('S / Red');
    expect(matchVariant(grid, names, 'M / Blue').variant?.title).toBe('M / Blue');
    expect(matchVariant([grid[0]!], names, 'hoodie').status).toBe('matched');
    expect(matchVariant([], names, 'hoodie').status).toBe('none');
  });

  it('reads "Extra Large" before "Large"', () => {
    const sizes = [
      v({ position: 0, optionValues: ['Large'] }),
      v({ position: 1, optionValues: ['Extra Large'] }),
    ];
    expect(matchVariant(sizes, ['Size'], 'tee extra large').variant?.title).toBe('Extra Large');
    expect(matchVariant(sizes, ['Size'], 'tee large').variant?.title).toBe('Large');
  });
});
