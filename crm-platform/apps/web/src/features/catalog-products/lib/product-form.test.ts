import { describe, expect, it } from 'vitest';
import {
  PRODUCT_CURRENCIES,
  createProductSchema,
  updateProductSchema,
  type ProductResponse,
} from '@crm/contracts';
import {
  CURRENCY_LABELS,
  EMPTY_PRODUCT_FORM,
  buildInput,
  fieldOfPath,
  formFromProduct,
  parseTags,
  previewCompare,
  previewPrice,
  profitIndicator,
  validate,
  type ProductForm,
} from './product-form';

const form = (over: Partial<ProductForm> = {}): ProductForm => ({
  ...EMPTY_PRODUCT_FORM,
  name: 'Spring Cotton Tee',
  priceMajor: '499',
  ...over,
});

describe('currency list', () => {
  it('has a label for every currency the contract allows', () => {
    for (const c of PRODUCT_CURRENCIES) expect(CURRENCY_LABELS[c]).toContain(c);
    expect(Object.keys(CURRENCY_LABELS)).toHaveLength(21);
  });
});

describe('parseTags', () => {
  it('trims, drops blanks and exact repeats, keeps case variants', () => {
    expect(parseTags('cotton, summer ,, cotton, bestseller')).toEqual([
      'cotton',
      'summer',
      'bestseller',
    ]);
    expect(parseTags('Cotton, cotton, COTTON')).toEqual(['Cotton', 'cotton', 'COTTON']);
    expect(parseTags('')).toEqual([]);
  });
  it('trims the whole box of invisible characters, each part like PHP trim()', () => {
    expect(parseTags('\u200bcotton , summer\u200d')).toEqual(['cotton', 'summer']);
    expect(parseTags('cotton, \u200bsummer\u200d ,x')).toEqual([
      'cotton',
      '\u200bsummer\u200d',
      'x',
    ]);
  });
});

describe('validate', () => {
  it('accepts a minimal form', () => {
    expect(validate(form())).toEqual({});
  });
  it('requires a name and a price', () => {
    expect(validate(form({ name: '  ', priceMajor: '' }))).toEqual({
      name: 'required',
      priceMajor: 'required',
    });
  });
  it('checks the lengths and the numbers', () => {
    expect(validate(form({ name: 'x'.repeat(192) })).name).toBe('tooLong');
    expect(validate(form({ sku: 'x'.repeat(97) })).sku).toBe('tooLong');
    expect(validate(form({ priceMajor: '12,5' })).priceMajor).toBe('notNumber');
    expect(validate(form({ priceMajor: '1000001' })).priceMajor).toBe('tooBig');
    expect(validate(form({ priceMajor: '1000000' })).priceMajor).toBeUndefined();
    expect(validate(form({ comparePriceMajor: 'abc' })).comparePriceMajor).toBe('notNumber');
    expect(validate(form({ stockQty: '1.5' })).stockQty).toBe('notWhole');
    expect(validate(form({ stockQty: '1000001' })).stockQty).toBe('outOfRange');
    expect(validate(form({ sortOrder: '10000' })).sortOrder).toBe('outOfRange');
    expect(validate(form({ weightGrams: '-3' })).weightGrams).toBe('notWhole');
  });
  it('reads amounts as a browser number box and Reference do', () => {
    expect(validate(form({ priceMajor: '1e3' })).priceMajor).toBeUndefined();
    expect(validate(form({ priceMajor: '.5' })).priceMajor).toBeUndefined();
    expect(validate(form({ priceMajor: '12.50' })).priceMajor).toBeUndefined();
    expect(validate(form({ priceMajor: '0.123456789' })).priceMajor).toBe('notNumber');
    expect(validate(form({ priceMajor: '19.999' })).priceMajor).toBe('notNumber');
    expect(validate(form({ priceMajor: '1e400' })).priceMajor).toBe('notNumber');
    expect(validate(form({ priceMajor: '1e7' })).priceMajor).toBe('tooBig');
    expect(validate(form({ comparePriceMajor: '1e3' })).comparePriceMajor).toBeUndefined();
    expect(buildInput(form({ priceMajor: '1e3' })).priceMajor).toBe('1000');
    expect(buildInput(form({ priceMajor: '.5' })).priceMajor).toBe('0.5');
    expect(buildInput(form({ priceMajor: '12.50' })).priceMajor).toBe('12.50');
    expect(buildInput(form({ comparePriceMajor: '2e2' })).comparePriceMajor).toBe('200');
    expect(buildInput(form({ comparePriceMajor: ' ' })).comparePriceMajor).toBeNull();
  });
  it('trims text the Reference way before checking and posting it', () => {
    const f = form({ name: '\u200d Tee\u200b\u200d', description: ' \u200bsoft\u200d ' });
    expect(buildInput(f).name).toBe('Tee');
    expect(buildInput(f).description).toBe('soft');
    expect(validate(form({ name: '\u200b\u200d' })).name).toBe('required');
    expect(buildInput(form({ category: '\u200dApparel\u200d' })).category).toBe('Apparel');
  });
  it('refuses whole numbers with leading zeros, a sign or an exponent', () => {
    expect(validate(form({ stockQty: '007' })).stockQty).toBe('notWhole');
    expect(validate(form({ stockQty: '0' })).stockQty).toBeUndefined();
    expect(validate(form({ stockQty: '1e3' })).stockQty).toBe('notWhole');
    expect(validate(form({ stockQty: '+5' })).stockQty).toBe('notWhole');
    expect(validate(form({ sortOrder: '0' })).sortOrder).toBeUndefined();
  });
  it('checks the image urls and the gallery size', () => {
    expect(validate(form({ imageUrl: 'not a url' })).imageUrl).toBe('badUrl');
    expect(validate(form({ imageUrl: 'ftp://x/y.png' })).imageUrl).toBe('badUrl');
    expect(validate(form({ imageUrl: 'https://cdn.example.com/a.png' })).imageUrl).toBeUndefined();
    expect(validate(form({ galleryUrls: ['https://a/1.png', 'nope'] })).gallery).toBe('badUrl');
    expect(
      validate(form({ galleryUrls: Array.from({ length: 13 }, (_, i) => `https://a/${i}.png`) }))
        .gallery,
    ).toBe('tooMany');
    // a blank row is ignored, as the server drops it
    expect(validate(form({ galleryUrls: ['', 'https://a/1.png'] })).gallery).toBeUndefined();
  });
});

describe('buildInput', () => {
  it('satisfies the create and update contracts', () => {
    const body = buildInput(
      form({
        sku: ' ST-1 ',
        stockQty: '12',
        weightGrams: '250',
        comparePriceMajor: '599',
        tags: 'a, b',
        galleryUrls: ['', 'https://a/1.png'],
        imageUrl: 'https://a/main.png',
      }),
    );
    expect(body).toMatchObject({
      name: 'Spring Cotton Tee',
      sku: 'ST-1',
      priceMajor: '499',
      comparePriceMajor: '599',
      currencyCode: 'INR',
      stockQty: 12,
      weightGrams: 250,
      sortOrder: 0,
      inStock: true,
      status: 'active',
      tags: ['a', 'b'],
      galleryUrls: ['https://a/1.png'],
    });
    expect(createProductSchema.safeParse(body).success).toBe(true);
    expect(updateProductSchema.safeParse({ ...body, rowVersion: 2 }).success).toBe(true);
  });
  it('posts blank optional fields as null so an edit can clear them', () => {
    const body = buildInput(form());
    expect(body).toMatchObject({
      sku: null,
      description: null,
      bodyHtml: null,
      comparePriceMajor: null,
      stockQty: null,
      weightGrams: null,
      category: null,
      imageUrl: null,
      tags: [],
      galleryUrls: [],
    });
  });
  it('leaves stock unlimited when blank and keeps zero as zero', () => {
    expect(buildInput(form({ stockQty: '' })).stockQty).toBeNull();
    expect(buildInput(form({ stockQty: '0' })).stockQty).toBe(0);
  });
});

const product = (over: Partial<ProductResponse> = {}): ProductResponse => ({
  id: '00000000-0000-4000-8000-000000000001',
  sku: 'ST-1',
  name: 'Tee',
  slug: 'tee',
  description: 'Soft',
  bodyHtml: null,
  priceMinor: 129900,
  priceMajor: '1299',
  priceDisplay: '₹ 1,299',
  comparePriceMinor: 149900,
  comparePriceMajor: '1499',
  comparePriceDisplay: '₹ 1,499',
  onSale: true,
  currencyCode: 'INR',
  imageUrl: 'https://a/b.png',
  galleryUrls: ['https://a/1.png'],
  inStock: true,
  stockQty: null,
  reservedQty: 0,
  availableQty: null,
  sortOrder: 4,
  status: 'draft',
  weightGrams: 250,
  category: 'Apparel',
  tags: ['cotton', 'summer'],
  aliases: [],
  availability: 'in stock',
  effectiveAvailability: 'in stock',
  condition: 'new',
  brand: null,
  productUrl: null,
  googleProductCategory: null,
  storefrontId: null,
  retailerId: 'ST-1',
  metaRetailerId: null,
  metaSyncStatus: null,
  metaSyncedAt: null,
  metaLastError: null,
  options: [],
  variants: [],
  hasVariants: false,
  rowVersion: 5,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('formFromProduct', () => {
  it('shows prices with two decimals and stock blank when unlimited', () => {
    const f = formFromProduct(product());
    expect(f).toMatchObject({
      priceMajor: '1299.00',
      comparePriceMajor: '1499.00',
      stockQty: '',
      weightGrams: '250',
      sortOrder: '4',
      status: 'draft',
      tags: 'cotton, summer',
      category: 'Apparel',
    });
  });
  it('leaves compare-at blank when the product has none', () => {
    expect(
      formFromProduct(product({ comparePriceMinor: null, comparePriceMajor: null }))
        .comparePriceMajor,
    ).toBe('');
  });
  it('round trips to the same input', () => {
    const f = formFromProduct(product());
    expect(validate(f)).toEqual({});
    expect(buildInput(f).priceMajor).toBe('1299.00');
  });
});

describe('profitIndicator', () => {
  it('shows the discount when compare-at is above the price', () => {
    expect(profitIndicator('80', '100')).toEqual({ kind: 'off', percent: 20 });
    expect(profitIndicator('499', '599')).toEqual({ kind: 'off', percent: 17 });
  });
  it('flags a compare-at below the price and a tie', () => {
    expect(profitIndicator('100', '80')).toEqual({ kind: 'lower' });
    expect(profitIndicator('100', '100')).toEqual({ kind: 'same' });
  });
  it('is empty without a usable compare-at', () => {
    expect(profitIndicator('100', '')).toEqual({ kind: 'none' });
    expect(profitIndicator('', '100')).toEqual({ kind: 'none' });
    expect(profitIndicator('100', '0')).toEqual({ kind: 'none' });
  });
});

describe('preview', () => {
  it('formats the price as the saved price will read', () => {
    expect(previewPrice({ priceMajor: '1299', currencyCode: 'INR' })).toBe('₹ 1,299');
    expect(previewPrice({ priceMajor: '1299.5', currencyCode: 'USD' })).toBe('$ 1,299.50');
    expect(previewPrice({ priceMajor: '', currencyCode: 'EUR' })).toBe('€ 0');
  });
  it('shows the compare-at only above the price', () => {
    expect(
      previewCompare({ priceMajor: '80', comparePriceMajor: '100', currencyCode: 'USD' }),
    ).toBe('$ 100');
    expect(
      previewCompare({ priceMajor: '100', comparePriceMajor: '80', currencyCode: 'USD' }),
    ).toBeNull();
    expect(
      previewCompare({ priceMajor: '100', comparePriceMajor: '', currencyCode: 'USD' }),
    ).toBeNull();
  });
});

describe('fieldOfPath', () => {
  it('maps server paths to form fields', () => {
    expect(fieldOfPath('priceMajor')).toBe('priceMajor');
    expect(fieldOfPath('galleryUrls.2')).toBe('gallery');
    expect(fieldOfPath('rowVersion')).toBeNull();
  });
});
