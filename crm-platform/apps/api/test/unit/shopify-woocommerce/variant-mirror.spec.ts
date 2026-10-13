import { describe, expect, it } from 'vitest';
import {
  shopifyProduct,
  shopifyVariants,
  wooProduct,
  wooVariants,
} from '../../../src/modules/shopify-woocommerce/mirror-rules';
import {
  productFor,
  sellableNow,
  storeVariantIdOf,
} from '../../../src/modules/shopify-woocommerce/checkout-rules';
import type { ShopProductRow } from '../../../src/modules/shopify-woocommerce/shop-products.repository';
import { readWooProducts } from '../../../src/modules/shopify-woocommerce/woo-variations';

/**
 * Fixtures shaped like the Admin REST and WooCommerce REST payloads (documented fields only). No provider is called; nothing here
 * proves a live store answers like this.
 */
const shopifyTee = {
  id: 9001,
  title: 'Tee',
  handle: 'tee',
  status: 'active',
  options: [
    { name: 'Size', values: ['S', 'M'] },
    { name: 'Colour', values: ['Red', 'Blue'] },
  ],
  images: [
    { id: 1, src: 'https://cdn/tee.png' },
    { id: 2, src: 'https://cdn/tee-blue.png' },
  ],
  variants: [
    {
      id: 11,
      option1: 'S',
      option2: 'Red',
      sku: 'TEE-S-R',
      price: '10.00',
      compare_at_price: '12.00',
      inventory_management: 'shopify',
      inventory_quantity: 4,
      grams: 200,
      image_id: null,
    },
    {
      id: 12,
      option1: 'M',
      option2: 'Red',
      sku: '',
      price: '11.50',
      compare_at_price: null,
      inventory_management: 'shopify',
      inventory_quantity: -2,
      grams: 0,
      image_id: null,
    },
    {
      id: 13,
      option1: 'M',
      option2: 'Blue',
      sku: 'TEE-M-B',
      price: '11.50',
      inventory_management: null,
      inventory_quantity: 99,
      image_id: 2,
    },
  ],
};

describe('Shopify variants', () => {
  it('maps variants, options, SKU stand-ins, stock tracking and the variant image', () => {
    const { options, variants } = shopifyVariants(shopifyTee);
    expect(options).toEqual([
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Red', 'Blue'] },
    ]);
    expect(variants.map((v) => v.title)).toEqual(['S / Red', 'M / Red', 'M / Blue']);
    expect(variants[0]).toMatchObject({
      sku: 'TEE-S-R',
      priceMinor: 1000,
      comparePriceMinor: 1200,
      stockQty: 4,
      weightGrams: 200,
    });
    // No SKU: a stable stand-in carrying the Shopify variant id; negative tracked stock reads as 0.
    expect(variants[1]).toMatchObject({ sku: 'SHOPIFY-V12', stockQty: 0, weightGrams: null });
    // Untracked inventory is unlimited; the variant's image comes from the product's images.
    expect(variants[2]).toMatchObject({ stockQty: null, imageUrl: 'https://cdn/tee-blue.png' });
  });

  it('the default single variant is a plain product', () => {
    const plain = {
      id: 5,
      title: 'Mug',
      options: [{ name: 'Title', values: ['Default Title'] }],
      variants: [{ id: 50, option1: 'Default Title', sku: 'MUG', price: '5.00' }],
    };
    expect(shopifyVariants(plain)).toEqual({ options: [], variants: [] });
    const m = shopifyProduct(plain, { storeUrl: 's.myshopify.com', currency: 'USD' });
    expect(m.variants).toEqual([]);
    expect(m.sku).toBe('MUG');
    expect(m.priceMinor).toBe(500);
  });

  it('shopifyProduct carries them and keeps the first variant price as the (later re-derived) product price', () => {
    const m = shopifyProduct(shopifyTee, { storeUrl: 's.myshopify.com', currency: 'USD' });
    expect(m.variants).toHaveLength(3);
    expect(m.options.map((o) => o.name)).toEqual(['Size', 'Colour']);
  });

  it('skips a variant with a missing option value and a duplicate combination', () => {
    const p = {
      ...shopifyTee,
      variants: [
        ...shopifyTee.variants,
        { id: 14, option1: 'M', option2: 'blue', price: '1.00' },
        { id: 15, option1: 'L', option2: '', price: '1.00' },
      ],
    };
    expect(shopifyVariants(p).variants).toHaveLength(3);
  });
});

const wooShirt = {
  id: 700,
  type: 'variable',
  name: 'Shirt',
  price: '20.00',
  attributes: [
    { name: 'Size', variation: true, options: ['Small', 'Large'] },
    { name: 'Fit', variation: false, options: ['Slim'] },
  ],
  variations: [71, 72, 73],
  _variations: [
    {
      id: 71,
      sku: 'SH-S',
      price: '20.00',
      regular_price: '25.00',
      manage_stock: true,
      stock_quantity: 3,
      attributes: [{ name: 'Size', option: 'Small' }],
      image: { src: 'https://w/s.png' },
      weight: '0.5',
      status: 'publish',
    },
    {
      id: 72,
      sku: '',
      price: '22.00',
      regular_price: '22.00',
      manage_stock: false,
      stock_status: 'outofstock',
      attributes: [{ name: 'size', option: 'large' }],
      status: 'publish',
    },
    {
      id: 73,
      sku: 'SH-X',
      price: '22.00',
      stock_status: 'instock',
      manage_stock: false,
      attributes: [{ name: 'Size', option: 'Large' }],
      status: 'private',
    },
  ],
};

describe('WooCommerce variations', () => {
  it('maps variation attributes to options, canonical values, stock and status', () => {
    const { options, variants } = wooVariants(wooShirt);
    expect(options).toEqual([{ name: 'Size', values: ['Small', 'Large'] }]);
    expect(variants.map((v) => v.title)).toEqual(['Small', 'Large']);
    expect(variants[0]).toMatchObject({
      sku: 'SH-S',
      priceMinor: 2000,
      comparePriceMinor: 2500,
      stockQty: 3,
      weightGrams: 500,
      imageUrl: 'https://w/s.png',
      active: true,
    });
    // No SKU: stand-in; unmanaged + outofstock reads as 0; the "large" value was cased by the store.
    expect(variants[1]).toMatchObject({ sku: 'WOO-V72', stockQty: 0, comparePriceMinor: null });
    // The duplicate "Large" (variation 73, private) is dropped.
  });

  it('a variable product whose variations were not read keeps the stored variants', () => {
    const { _variations, ...bare } = wooShirt;
    void _variations;
    const m = wooProduct(bare, { storeUrl: 'https://w.test', currency: 'USD' });
    expect(m.variants).toEqual([]);
    expect(m.keepVariants).toBe(true);
    expect(
      wooProduct(wooShirt, { storeUrl: 'https://w.test', currency: 'USD' }).keepVariants,
    ).toBeUndefined();
  });

  it('a simple product is plain', () => {
    const m = wooProduct(
      { id: 1, type: 'simple', name: 'Pen', price: '1.00' },
      { storeUrl: 'https://w.test', currency: 'USD' },
    );
    expect(m.variants).toEqual([]);
    expect(m.keepVariants).toBeUndefined();
  });

  it('readWooProducts attaches the variations of variable products only', async () => {
    const calls: string[] = [];
    const api = {
      products: async () => ({
        items: [
          { id: 700, type: 'variable', variations: [71] },
          { id: 1, type: 'simple' },
        ],
        complete: true,
      }),
      variations: async (id: string) => {
        calls.push(id);
        return { items: [{ id: 71 }], complete: true };
      },
    };
    const read = await readWooProducts(api);
    expect(calls).toEqual(['700']);
    expect(read.items[0]).toMatchObject({ _variations: [{ id: 71 }] });
    expect(read.items[1]).not.toHaveProperty('_variations');
    expect(read.complete).toBe(true);
  });

  it('a store that does not answer for a variation read leaves the product plain and the read incomplete', async () => {
    const api = {
      products: async () => ({
        items: [{ id: 700, type: 'variable', variations: [71] }],
        complete: true,
      }),
      variations: async () => ({ items: [], complete: false }),
    };
    const read = await readWooProducts(api);
    expect(read.complete).toBe(false);
    expect(read.items[0]).not.toHaveProperty('_variations');
  });
});

describe('checkout rules with variants', () => {
  const plain: ShopProductRow = {
    id: 1,
    sku: 'P1',
    metaRetailerId: null,
    storeProductId: '900',
    inStock: true,
    availability: 'in stock',
    status: 'active',
    stockQty: 5,
    reservedQty: 0,
  };
  const variant: ShopProductRow = {
    ...plain,
    sku: 'SHOPIFY-V12',
    stockQty: 0,
    reservedQty: 0,
    variant: { retailerId: 'SHOPIFY-V12', active: true },
  };

  it('a variant retailer id names the variant row; the product row stays the aggregate', () => {
    expect(productFor('SHOPIFY-V12', [plain, variant])).toBe(variant);
    expect(productFor('P1', [variant, plain])).toBe(plain);
  });

  it('a variant is sold on its own stock and active flag, not the product aggregate', () => {
    expect(sellableNow(plain)).toBe(true);
    expect(sellableNow(variant)).toBe(false);
    expect(sellableNow({ ...variant, stockQty: 2, reservedQty: 1 })).toBe(true);
    expect(
      sellableNow({ ...variant, stockQty: null, variant: { retailerId: 'x', active: false } }),
    ).toBe(false);
  });

  it('reads the store variant id out of a stand-in SKU, for its own store only', () => {
    expect(storeVariantIdOf('SHOPIFY-V12', 'shopify')).toBe('12');
    expect(storeVariantIdOf('SHOPIFY-V12', 'woocommerce')).toBeNull();
    expect(storeVariantIdOf('WOO-V72', 'woocommerce')).toBe('72');
    expect(storeVariantIdOf('SHOPIFY-9001', 'shopify')).toBeNull();
    expect(storeVariantIdOf(null, 'shopify')).toBeNull();
  });
});
