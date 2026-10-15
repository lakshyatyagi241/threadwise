import { describe, expect, it } from 'vitest';
import type { OrderLine } from '@crm/contracts';
import {
  buildConfirmedText,
  buildSummary,
  cartRef,
  intentOf,
  looksLikePlaceholder,
  normalizeItems,
  offlineEnglish,
  reasonText,
  lineName,
  shippingText,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/ordering-rules';

const line = (name: string, qty: number, price: number): OrderLine => ({
  product_id: 1,
  retailer_id: 'sku',
  name,
  image_url: null,
  qty,
  price_minor: price,
  currency: 'INR',
});

describe('natural-language ordering rules (TW-FLR-042)', () => {
  it('keys a cart by workspace and the customer digits', () => {
    expect(cartRef(7, '+91 98765-43210')).toBe('ord:7:919876543210');
  });

  it('words why a line is unavailable', () => {
    expect(reasonText({ name: 'a', qty: 1, reason: 'not_found' })).toBe('not found');
    expect(reasonText({ name: 'a', qty: 1, reason: 'out_of_stock', available: 2 })).toBe(
      'only 2 in stock',
    );
    expect(reasonText({ name: 'a', qty: 1, reason: 'out_of_stock', available: 0 })).toBe(
      'out of stock',
    );
  });

  it('summarises a cart with line totals, the total and what was not available, with no confirm prompt', () => {
    const s = buildSummary(
      [line('Chicken wings', 2, 15000)],
      [{ name: 'Fish', qty: 1, reason: 'out_of_stock', available: 0 }],
      30000,
      'INR',
    );
    expect(s).toBe(
      '*Your order*\n• 2 × Chicken wings — ₹ 300\n\n*Total: ₹ 300*\n\n_Not available:_\n• 1 × Fish — out of stock',
    );
    expect(s.toLowerCase()).not.toContain('confirm');
  });

  it('apologises when nothing could be added', () => {
    const s = buildSummary([], [{ name: 'Fish', qty: 3, reason: 'not_found' }], 0, null);
    expect(s).toContain("Sorry, we can't take that order right now:");
    expect(s).toContain('• 3 × Fish — not found');
    expect(s).toContain('Please send your order again any time.');
  });

  it('recaps a confirmed order with the ship-to', () => {
    expect(
      buildConfirmedText(12, [line('Wings', 2, 15000)], 30000, 'INR', {
        name: 'Asha',
        company: '',
        address: '1 Main St',
      }),
    ).toBe('*New order #12*\n• 2 × Wings\n*Total: ₹ 300*\n*Ship to:* Asha, 1 Main St');
  });

  it('decisive words win anywhere, weak words only in a short reply', () => {
    expect(intentOf('please confirm my order')).toBe('confirm');
    expect(intentOf('I want to cancel this')).toBe('cancel');
    expect(intentOf('yes')).toBe('confirm');
    expect(intentOf('no thanks')).toBe('cancel');
    expect(intentOf('confirm and do not cancel')).toBe('confirm');
    expect(intentOf('there is no way my mother told me ok about this long story')).toBe('unclear');
    expect(intentOf('')).toBe('unclear');
  });

  it('keeps an offline word map for the common confirm and cancel words', () => {
    expect(offlineEnglish('确认')).toBe('confirm');
    expect(offlineEnglish('取消')).toBe('cancel');
    expect(offlineEnglish('hello')).toBeNull();
  });

  it('spots a media placeholder in place of a typed reply', () => {
    expect(looksLikePlaceholder('')).toBe(true);
    expect(looksLikePlaceholder('[Voice Note]')).toBe(true);
    expect(looksLikePlaceholder('3EB0ABCDEF123456')).toBe(true);
    expect(looksLikePlaceholder('wamid.HBgM123')).toBe(true);
    expect(looksLikePlaceholder('two chicken wings')).toBe(false);
  });

  it('reads the model item list tolerantly', () => {
    expect(
      normalizeItems({
        items: [
          { name: ' Wings ', qty: 3 },
          { product: 'Fries', quantity: '2' },
          { item: 'Soda' },
          { name: '   ' },
          'junk',
          { name: 'Zero', qty: 0 },
          { name: 'Hoodie', qty: 1, variant: ' M red ' },
        ],
      }),
    ).toEqual([
      { name: 'Wings', qty: 3, variant: '' },
      { name: 'Fries', qty: 2, variant: '' },
      { name: 'Soda', qty: 1, variant: '' },
      { name: 'Zero', qty: 1, variant: '' },
      { name: 'Hoodie', qty: 1, variant: 'M red' },
    ]);
    expect(normalizeItems(null)).toEqual([]);
    expect(normalizeItems({ items: 'x' })).toEqual([]);
  });

  it('names a variant line and asks for a missing option', () => {
    expect(lineName({ name: 'Hoodie', variant_title: 'M / Red' })).toBe('Hoodie (M / Red)');
    expect(lineName({ name: 'Hoodie' })).toBe('Hoodie');
    const ask = {
      name: 'Hoodie',
      qty: 1,
      reason: 'option_required' as const,
      options: [
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Colour', values: ['Red'] },
      ],
    };
    expect(reasonText(ask)).toBe('please tell us the Size: S, M and Colour: Red');
    expect(reasonText({ ...ask, options: [] })).toBe('please tell us which option');
    const item = { ...line('Hoodie', 2, 1000), variant_id: 'u', variant_title: 'M / Red' };
    expect(buildSummary([item], [ask], 2000, 'INR')).toContain('2 × Hoodie (M / Red)');
    expect(buildSummary([item], [ask], 2000, 'INR')).toContain(
      '1 × Hoodie — please tell us the Size',
    );
    expect(buildConfirmedText(5, [item], 2000, 'INR')).toContain('• 2 × Hoodie (M / Red)');
  });

  it('joins the ship-to on lines, dropping blanks', () => {
    expect(shippingText('Asha', ' ', '1 Main St')).toBe('Asha\n1 Main St');
  });
});
