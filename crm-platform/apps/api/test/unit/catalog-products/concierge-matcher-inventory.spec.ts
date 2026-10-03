import { describe, expect, it } from 'vitest';
import {
  conciergeBody,
  extractIntent,
  looksLikeProductQuery,
  rankProducts,
} from '../../../src/modules/catalog-products/concierge-rules';
import {
  aliasStrings,
  matchProduct,
  similarity,
} from '../../../src/modules/catalog-products/product-matcher';
import {
  afterCommit,
  afterHold,
  afterRelease,
  canHold,
  clampRef,
  holdTtl,
} from '../../../src/modules/catalog-products/inventory-rules';
import {
  applyAutomation,
  buildOrderAck,
  orderAckEnabled,
  payUrl,
  readAutomation,
} from '../../../src/modules/catalog-products/catalog-automation';
import { saveAutomationSchema } from '@crm/contracts';

describe('concierge intent extraction (WD-CAT-028)', () => {
  it('"red shoes under 2000" is the keywords red and shoes with a ceiling of 2000', () => {
    expect(extractIntent('Got any red shoes under 2,000?')).toEqual({
      keywords: ['red', 'shoes'],
      priceMin: null,
      priceMax: 2000,
    });
  });
  it('a range in any of its three spellings is a band, smaller first', () => {
    expect(extractIntent('sofa between 5000 and 3000')).toMatchObject({
      priceMin: 3000,
      priceMax: 5000,
    });
    expect(extractIntent('sofa 1000 to 2000')).toMatchObject({ priceMin: 1000, priceMax: 2000 });
    expect(extractIntent('sofa 1000-2000')).toMatchObject({ priceMin: 1000, priceMax: 2000 });
  });
  it('a floor: above, over, more than, from, min', () => {
    expect(extractIntent('watch above ₹500')).toMatchObject({
      keywords: ['watch'],
      priceMin: 500,
      priceMax: null,
    });
    expect(extractIntent('watch more than 99')).toMatchObject({ priceMin: 99 });
  });
  it('stopwords, single letters and bare numbers are not keywords; duplicates collapse', () => {
    expect(extractIntent('please show me the Tee tee 2 x').keywords).toEqual(['tee']);
  });
  it('a message that is neither a keyword nor a price is not a product question', () => {
    expect(looksLikeProductQuery(extractIntent('hello please'))).toBe(false);
    expect(looksLikeProductQuery(extractIntent('under 500'))).toBe(true);
    expect(looksLikeProductQuery(extractIntent('shoes'))).toBe(true);
  });
});

describe('concierge ranking (WD-CAT-028)', () => {
  const p = (name: string, description: string | null, day: number, extra: object = {}) => ({
    name,
    description,
    category: null,
    brand: null,
    updatedAt: new Date(2026, 0, day),
    ...extra,
  });
  it('a keyword in the name, category or brand scores 3, in the description only 1; best first, ties keep the order', () => {
    const rows = [
      p('Blue cap', 'a red stripe', 1),
      p('Red shoes', null, 2),
      p('Mug', null, 3, { category: 'red things' }),
      p('Red red', null, 4),
    ];
    expect(rankProducts(rows, ['red'], 10).map((r) => r.name)).toEqual([
      'Red shoes',
      'Mug',
      'Red red',
      'Blue cap',
    ]);
  });
  it('honours the limit; without keywords the most recently updated come first', () => {
    const rows = [p('a', null, 1), p('b', null, 5), p('c', null, 3)];
    expect(rankProducts(rows, [], 2).map((r) => r.name)).toEqual(['b', 'c']);
  });
  it('the reply line counts the matches and cuts a long query', () => {
    expect(conciergeBody(1, 'red shoes')).toBe('I found 1 match for "red shoes":');
    expect(conciergeBody(3, 'red shoes')).toBe('I found 3 matches for "red shoes":');
    expect(conciergeBody(2, 'x'.repeat(80))).toBe(`I found 2 matches for "${'x'.repeat(60)}...":`);
  });
});

describe('order-text matching (WD-CAT-032)', () => {
  const catalog = [
    {
      sku: 'CHK-DRUM',
      name: 'Chicken Drumsticks',
      aliases: ['鸡腿', { alias: 'Ayam Peha' }, { name: 'drumstick' }],
    },
    { sku: null, name: 'Basmati Rice 5kg', aliases: null },
    { sku: 'TEA-1', name: 'Masala Tea', aliases: [] },
  ];
  it('exact SKU first, ignoring case and spacing', () => {
    expect(matchProduct(catalog, '  chk-drum ')).toMatchObject({ matchedOn: 'sku', confidence: 1 });
  });
  it('then the exact name', () => {
    expect(matchProduct(catalog, 'basmati   rice 5KG')).toMatchObject({
      matchedOn: 'name',
      confidence: 1,
    });
  });
  it('then an exact alias in any language, as string or object', () => {
    expect(matchProduct(catalog, '鸡腿')).toMatchObject({ matchedOn: 'alias', confidence: 0.98 });
    expect(matchProduct(catalog, 'ayam peha').product?.name).toBe('Chicken Drumsticks');
    expect(matchProduct(catalog, 'DRUMSTICK').matchedOn).toBe('alias');
  });
  it('then containment scores 0.85', () => {
    expect(matchProduct(catalog, 'two chicken drumsticks please')).toMatchObject({
      matchedOn: 'contains',
      confidence: 0.85,
    });
  });
  it('then a similar spelling above the 0.62 threshold; below it nothing matches', () => {
    expect(matchProduct(catalog, 'masala tee').product?.name).toBe('Masala Tea');
    expect(matchProduct(catalog, 'zzzz qqqq')).toEqual({
      product: null,
      matchedOn: 'none',
      confidence: 0,
    });
  });
  it('an empty text matches nothing', () => {
    expect(matchProduct(catalog, '   ')).toEqual({
      product: null,
      matchedOn: 'empty',
      confidence: 0,
    });
  });
  it('similarity is PHP similar_text: 2 x common / (len a + len b)', () => {
    expect(similarity('world', 'word')).toBeCloseTo((2 * 4) / 9, 5);
    expect(similarity('', 'abc')).toBe(0);
    expect(similarity('abc', 'abc')).toBe(1);
  });
  it('aliases are lower-cased, trimmed, blanks dropped; non-lists are none', () => {
    expect(aliasStrings([' Foo ', '', { alias: 'BAR' }, { other: 1 }, null])).toEqual([
      'foo',
      'bar',
    ]);
    expect(aliasStrings('x')).toEqual([]);
  });
});

describe('stock hold arithmetic (WD-CAT-025)', () => {
  it('a hold needs stock minus holds to cover it; unlimited stock always can', () => {
    expect(canHold({ stockQty: 10, reservedQty: 4 }, 6)).toBe(true);
    expect(canHold({ stockQty: 10, reservedQty: 4 }, 7)).toBe(false);
    expect(canHold({ stockQty: null, reservedQty: 999 }, 500)).toBe(true);
    expect(canHold({ stockQty: 10, reservedQty: 0 }, 0)).toBe(false);
    expect(canHold({ stockQty: 2, reservedQty: 5 }, 1)).toBe(false);
  });
  it('hold raises reserved; commit lowers stock and reserved (never below 0); release lowers reserved only', () => {
    expect(afterHold({ stockQty: 10, reservedQty: 2 }, 3)).toEqual({
      stockQty: 10,
      reservedQty: 5,
    });
    expect(afterCommit({ stockQty: 10, reservedQty: 5 }, 3)).toEqual({
      stockQty: 7,
      reservedQty: 2,
    });
    expect(afterCommit({ stockQty: 2, reservedQty: 1 }, 3)).toEqual({
      stockQty: 0,
      reservedQty: 0,
    });
    expect(afterCommit({ stockQty: null, reservedQty: 3 }, 3)).toEqual({
      stockQty: null,
      reservedQty: 0,
    });
    expect(afterRelease({ stockQty: 10, reservedQty: 5 }, 3)).toEqual({
      stockQty: 10,
      reservedQty: 2,
    });
    expect(afterRelease({ stockQty: 10, reservedQty: 1 }, 3)).toEqual({
      stockQty: 10,
      reservedQty: 0,
    });
  });
  it('a hold lasts at least 60 seconds and a ref is cut at 128 characters', () => {
    expect(holdTtl(10)).toBe(60);
    expect(holdTtl(1800)).toBe(1800);
    expect(clampRef('r'.repeat(300))).toHaveLength(128);
  });
});

describe('automation settings (WD-CAT-006, 029)', () => {
  it('a workspace that never saved the form gets the acknowledgement ON, the concierge OFF, 10 products', () => {
    expect(readAutomation(null)).toEqual({
      orderAckEnabled: true,
      orderAckPayUrl: null,
      conciergeEnabled: false,
      conciergeHeader: null,
      conciergeMax: 10,
      conciergeReplyOnEmpty: false,
      conciergeEmptyText: null,
    });
  });
  it('nothing ticked and blank fields save both flags false, text keys null and max 10', () => {
    const input = saveAutomationSchema.parse({});
    const meta = applyAutomation({}, input);
    expect(meta).toMatchObject({
      order_ack_enabled: false,
      order_ack_pay_url: null,
      concierge_enabled: false,
      concierge_header: null,
      concierge_max: 10,
      concierge_reply_on_empty: false,
      concierge_empty_text: null,
    });
    expect(readAutomation(meta).orderAckEnabled).toBe(false);
  });
  it('keys without a control (footer, template id, catalog id) survive a save', () => {
    const meta = applyAutomation(
      { concierge_footer: 'bye', order_ack_template_id: 7, catalog_id: 'c1' },
      saveAutomationSchema.parse({ conciergeEnabled: true, conciergeHeader: '  Hi  ' }),
    );
    expect(meta).toMatchObject({
      concierge_footer: 'bye',
      order_ack_template_id: 7,
      catalog_id: 'c1',
      concierge_enabled: true,
      concierge_header: 'Hi',
    });
  });
  it('concierge max above 30 is refused', () => {
    expect(saveAutomationSchema.safeParse({ conciergeMax: 50 }).success).toBe(false);
    expect(saveAutomationSchema.safeParse({ conciergeMax: 0 }).success).toBe(false);
    expect(saveAutomationSchema.safeParse({ conciergeMax: 30 }).success).toBe(true);
  });
  it('the acknowledgement is on unless it is explicitly false', () => {
    expect(orderAckEnabled(undefined)).toBe(true);
    expect(orderAckEnabled({})).toBe(true);
    expect(orderAckEnabled({ order_ack_enabled: false })).toBe(false);
    expect(orderAckEnabled({ order_ack_enabled: true })).toBe(true);
  });
});

describe('order acknowledgement text (WD-CAT-029)', () => {
  const base = {
    customerName: 'Asha',
    orderNumber: '42',
    itemCount: 3,
    currencyCode: 'INR',
    totalMinor: 129_950,
    payUrlBase: null,
    orderRef: '42',
  };
  it('thanks the customer, counts the items, totals with two decimals and promises payment details without a pay link', () => {
    expect(buildOrderAck(base)).toBe(
      "Thank you, Asha! We've received your order #42.\n3 items · Total: INR 1,299.50\nWe'll confirm your order and share payment details shortly.",
    );
  });
  it('one item is singular; no name reads "there"', () => {
    expect(buildOrderAck({ ...base, customerName: ' ', itemCount: 1 })).toContain(
      'Thank you, there!',
    );
    expect(buildOrderAck({ ...base, itemCount: 1 })).toContain('1 item · Total');
  });
  it('a pay link base gets the order appended with ? or &', () => {
    expect(payUrl('https://pay.test/checkout/', '42')).toBe('https://pay.test/checkout?order=42');
    expect(payUrl('https://pay.test/c?x=1', '42')).toBe('https://pay.test/c?x=1&order=42');
    expect(payUrl(null, '42')).toBe('');
    expect(buildOrderAck({ ...base, payUrlBase: 'https://pay.test/c' })).toContain(
      'Complete your payment securely here: https://pay.test/c?order=42',
    );
  });
});
