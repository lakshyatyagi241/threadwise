import { describe, expect, it } from 'vitest';
import {
  buildMetaItem,
  buildMpmSections,
  changedSyncFields,
  CATALOG_MANAGEMENT_HINT,
  defaultCatalogLinkText,
  effectiveAvailability,
  assemblePhone,
  healthScore,
  mergeRecipients,
  metaRejectionMessage,
  nextFreeSlug,
  normalizeGallery,
  normalizeImportedAvailability,
  normalizeTags,
  ownedInSubmittedOrder,
  parseManualNumbers,
  productShareCaption,
  retailerIdOf,
  slugify,
  truncateError,
  waOrderText,
  type MetaItemSource,
} from '../../../src/modules/catalog-products/catalog-rules';

const product = (over: Partial<MetaItemSource> = {}): MetaItemSource => ({
  id: 7,
  sku: null,
  metaRetailerId: null,
  availability: 'in stock',
  status: 'active',
  stockQty: null,
  name: 'Spring Tee',
  slug: 'spring-tee',
  description: 'Soft cotton',
  condition: 'new',
  priceMinor: 129_900,
  currencyCode: 'INR',
  imageUrl: 'https://cdn.test/tee.jpg',
  galleryUrls: [],
  productUrl: null,
  brand: null,
  category: null,
  googleProductCategory: null,
  ...over,
});

describe('retailer id (TW-CAT-009 rule 2)', () => {
  it('the stored retailer id wins, then the SKU, then wsn-<id>', () => {
    expect(retailerIdOf({ id: 7, sku: 'SKU-1', metaRetailerId: 'R-9' })).toBe('R-9');
    expect(retailerIdOf({ id: 7, sku: 'SKU-1', metaRetailerId: null })).toBe('SKU-1');
    expect(retailerIdOf({ id: 7, sku: null, metaRetailerId: null })).toBe('wsn-7');
    expect(retailerIdOf({ id: 7, sku: '', metaRetailerId: '' })).toBe('wsn-7');
  });
});

describe('availability derivation (TW-CAT-033)', () => {
  it('the stored availability is what Meta is told', () => {
    expect(
      effectiveAvailability({ availability: 'available for order', status: 'draft', stockQty: 0 }),
    ).toBe('available for order');
  });
  it('without one: not active is discontinued, no stock left is out of stock, else in stock', () => {
    expect(effectiveAvailability({ availability: null, status: 'draft', stockQty: 5 })).toBe(
      'discontinued',
    );
    expect(effectiveAvailability({ availability: '', status: 'archived', stockQty: null })).toBe(
      'discontinued',
    );
    expect(effectiveAvailability({ availability: null, status: 'active', stockQty: 0 })).toBe(
      'out of stock',
    );
    expect(effectiveAvailability({ availability: null, status: 'active', stockQty: -1 })).toBe(
      'out of stock',
    );
    expect(effectiveAvailability({ availability: null, status: 'active', stockQty: 3 })).toBe(
      'in stock',
    );
    expect(effectiveAvailability({ availability: null, status: 'active', stockQty: null })).toBe(
      'in stock',
    );
  });
  it('an imported Meta availability word maps onto the four values the column holds', () => {
    expect(normalizeImportedAvailability('IN STOCK')).toBe('in stock');
    expect(normalizeImportedAvailability('out of stock')).toBe('out of stock');
    expect(normalizeImportedAvailability('Out')).toBe('out of stock');
    expect(normalizeImportedAvailability('preorder')).toBe('available for order');
    expect(normalizeImportedAvailability('discontinued')).toBe('discontinued');
    expect(normalizeImportedAvailability(null)).toBe('in stock');
    expect(normalizeImportedAvailability('whatever')).toBe('in stock');
  });
});

describe('the Meta item (TW-CAT-033)', () => {
  it('carries the retailer id, the converted price and only the values that are set', () => {
    const item = buildMetaItem(
      product({ sku: 'SKU-1', brand: 'Acme', stockQty: 12 }),
      'https://shop.test',
    );
    expect(item).toEqual({
      retailer_id: 'SKU-1',
      name: 'Spring Tee',
      description: 'Soft cotton',
      availability: 'in stock',
      condition: 'new',
      price: 129_900,
      currency: 'INR',
      image_url: 'https://cdn.test/tee.jpg',
      url: 'https://shop.test/p/spring-tee',
      brand: 'Acme',
      inventory: 12,
    });
  });
  it('converts a zero-decimal price and keeps inventory 0 (zero is a value, not blank)', () => {
    const item = buildMetaItem(
      product({ currencyCode: 'IDR', priceMinor: 39_500_000, stockQty: 0 }),
      '',
    );
    expect(item.price).toBe(395_000);
    expect(item.currency).toBe('IDR');
    expect(item.inventory).toBe(0);
    expect(item).not.toHaveProperty('url');
  });
  it("the product's own url wins over the shop page; the description falls back to the name", () => {
    const item = buildMetaItem(
      product({ productUrl: 'https://brand.test/tee', description: null }),
      'https://shop.test',
    );
    expect(item.url).toBe('https://brand.test/tee');
    expect(item.description).toBe('Spring Tee');
  });
  it('lists the gallery as additional_image_urls without blanks, and cuts the description at 9999 characters', () => {
    const item = buildMetaItem(
      product({ galleryUrls: ['https://a', '', 'https://b'], description: 'x'.repeat(12_000) }),
      '',
    );
    expect(item.additional_image_urls).toEqual(['https://a', 'https://b']);
    expect((item.description as string).length).toBe(9999);
  });
});

describe('which edits are pushed (TW-CAT-012 rule 1)', () => {
  const base = {
    name: 'a',
    description: null,
    priceMinor: 1,
    comparePriceMinor: null,
    currencyCode: 'INR',
    imageUrl: null,
    availability: 'in stock',
    inStock: true,
    stockQty: null,
    brand: null,
    category: null,
    status: 'active',
  };
  it('a price change is a sync field', () => {
    expect(changedSyncFields(base, { ...base, priceMinor: 2 })).toEqual(['priceMinor']);
  });
  it('a sort order, SKU, tags, gallery, slug or meta bookkeeping change is not', () => {
    expect(
      changedSyncFields(base, {
        ...base,
        sortOrder: 5,
        sku: 'x',
        tags: ['t'],
        slug: 's',
        metaSyncStatus: 'pending',
      } as never),
    ).toEqual([]);
  });
  it('lists every changed field', () => {
    expect(
      changedSyncFields(base, { ...base, name: 'b', status: 'draft', stockQty: 3 }).sort(),
    ).toEqual(['name', 'status', 'stockQty']);
  });
});

describe('slugs (TW-CAT-017, 020)', () => {
  it('lower-cases, drops accents and joins words with single dashes', () => {
    expect(slugify('Summer Sale')).toBe('summer-sale');
    expect(slugify('  Crème   Brûlée!! ')).toBe('creme-brulee');
    expect(slugify('Tee @ 50% off')).toBe('tee-at-50-off');
  });
  it('a name with no ASCII letters or digits gives an empty slug (callers fall back to "product" or "set")', () => {
    expect(slugify('夏のセール')).toBe('');
    expect(slugify('---')).toBe('');
  });
  it('the first free of base, base-2, base-3...', () => {
    expect(nextFreeSlug('summer-sale', new Set())).toBe('summer-sale');
    expect(nextFreeSlug('summer-sale', new Set(['summer-sale']))).toBe('summer-sale-2');
    expect(
      nextFreeSlug('summer-sale', new Set(['summer-sale', 'summer-sale-2', 'summer-sale-4'])),
    ).toBe('summer-sale-3');
  });
});

describe('health score (TW-CAT-007)', () => {
  it('10 products with 3 flagged score 70', () => {
    expect(healthScore(10, 3)).toBe(70);
  });
  it('rounds to a whole number and is null without products', () => {
    expect(healthScore(3, 1)).toBe(67);
    expect(healthScore(0, 0)).toBeNull();
    expect(healthScore(4, 0)).toBe(100);
  });
});

describe('connect error text (TW-CAT-002 rule 3)', () => {
  it("names Meta's message and code, and adds the catalog_management hint for code 100", () => {
    const msg = metaRejectionMessage({
      raw: '(#100) Unsupported get request.',
      code: 100,
      subcode: null,
    });
    expect(
      msg.startsWith('Meta rejected verification: (#100) Unsupported get request. (code 100)'),
    ).toBe(true);
    expect(msg.endsWith(CATALOG_MANAGEMENT_HINT)).toBe(true);
    expect(msg).toContain('catalog_management');
  });
  it('shows code/subcode and no hint for another error', () => {
    const msg = metaRejectionMessage({ raw: 'Session has expired', code: 190, subcode: 463 });
    expect(msg).toBe('Meta rejected verification: Session has expired (code 190/463)');
  });
  it('the hint also fires on the words "unsupported get request" with another code', () => {
    expect(
      metaRejectionMessage({ raw: 'Unsupported get request', code: 12, subcode: null }),
    ).toContain('catalog_management');
  });
  it('an empty message reads "unknown error"; no code shows none', () => {
    expect(metaRejectionMessage({ raw: null, code: null, subcode: null })).toBe(
      'Meta rejected verification: unknown error',
    );
  });
});

describe('recipients (TW-CAT-014, 015)', () => {
  it('pasted numbers split on whitespace, commas and semicolons and keep 8 or more digits', () => {
    expect(parseManualNumbers('919876543210, 12345; abc\n+447700900123')).toEqual([
      '919876543210',
      '447700900123',
    ]);
  });
  it('a number typed with spaces is split into short pieces and dropped (Reference splits on whitespace first)', () => {
    expect(parseManualNumbers('+91 98765 43210')).toEqual([]);
  });
  it('3 pasted numbers with one duplicate and one of 6 digits yield 2 unique recipients', () => {
    const manual = parseManualNumbers('919876543210\n+919876543210\n123456\n447700900123');
    expect(mergeRecipients(manual)).toEqual(['919876543210', '447700900123']);
  });
  it('merges manual, contacts and groups in that order, de-duplicated, digits only', () => {
    expect(
      mergeRecipients(
        ['911111111111'],
        ['+91 22222 22222', '911111111111'],
        ['333333333333', '1234'],
      ),
    ).toEqual(['911111111111', '912222222222', '333333333333']);
  });
  it('a stored number is whole with a +, else the country code goes in front unless it is already there', () => {
    expect(assemblePhone('+44 7700 900123', '91')).toBe('447700900123');
    expect(assemblePhone('9876543210', '91')).toBe('919876543210');
    expect(assemblePhone('919876543210', '91')).toBe('919876543210');
    expect(assemblePhone('', '91')).toBe('');
  });
});

describe('message content (TW-CAT-015)', () => {
  it('groups products into sections by category, "Featured" without one, in first-seen order', () => {
    expect(
      buildMpmSections([
        { retailerId: 'a', category: 'Shirts' },
        { retailerId: 'b', category: null },
        { retailerId: 'c', category: 'Shirts' },
      ]),
    ).toEqual([
      { title: 'Shirts', productRetailerIds: ['a', 'c'] },
      { title: 'Featured', productRetailerIds: ['b'] },
    ]);
  });
  it("the default catalog link uses the catalog's phone number id, else the recipient's number (Reference quirk kept)", () => {
    expect(defaultCatalogLinkText('1012345', '919876543210')).toBe(
      'Check out our catalog: https://wa.me/c/1012345',
    );
    expect(defaultCatalogLinkText(null, '919876543210')).toBe(
      'Check out our catalog: https://wa.me/c/919876543210',
    );
  });
  it('the product share caption: name and price, 300 characters of description, the link', () => {
    const caption = productShareCaption({
      name: 'Tee',
      priceMinor: 129_900,
      currencyCode: 'INR',
      description: 'd'.repeat(400),
      link: 'https://shop.test/p/tee',
    });
    expect(caption.startsWith('*Tee* — ₹ 1,299\n\n')).toBe(true);
    expect(caption).toContain('d'.repeat(300));
    expect(caption).not.toContain('d'.repeat(301));
    expect(caption.endsWith('\n\nhttps://shop.test/p/tee')).toBe(true);
    expect(
      productShareCaption({
        name: 'Tee',
        priceMinor: 100,
        currencyCode: 'USD',
        description: '  ',
        link: null,
      }),
    ).toBe('*Tee* — $ 1');
  });
  it('the wa.me order text', () => {
    expect(
      waOrderText({
        name: 'Tee',
        priceMinor: 129_950,
        currencyCode: 'INR',
        imageUrl: 'https://i/x.jpg',
      }),
    ).toBe('Hi! I want to order:\n\n*Tee* — ₹ 1,299.50\nhttps://i/x.jpg\n\nQty: 1');
    expect(waOrderText({ name: 'Tee', priceMinor: 100, currencyCode: 'USD', imageUrl: null })).toBe(
      'Hi! I want to order:\n\n*Tee* — $ 1\n\nQty: 1',
    );
  });
});

describe('small normalisers', () => {
  it('tags and gallery are trimmed, de-duplicated and blanks dropped; the gallery holds 12', () => {
    expect(normalizeTags([' a ', 'b', 'a', ''])).toEqual(['a', 'b']);
    const many = Array.from({ length: 20 }, (_, i) => `https://x/${i}`);
    expect(normalizeGallery(['', ' https://x/0 ', ...many])).toHaveLength(12);
  });
  it('a stored failure text is cut at 500 characters', () => {
    expect(truncateError('e'.repeat(900))).toHaveLength(500);
    expect(truncateError('short')).toBe('short');
  });
  it('a collection keeps the submitted order, drops foreign ids and repeats', () => {
    const owned = [{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }];
    expect(ownedInSubmittedOrder(['c', 'x', 'a', 'c', 'b'], owned).map((o) => o.uuid)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(ownedInSubmittedOrder(['x', 'y'], owned)).toEqual([]);
  });
});
