import { describe, expect, it } from 'vitest';
import {
  barPercent,
  formatInt,
  formatMoney,
  formatOrderTotal,
  formatWhen,
  orderTone,
  shopHref,
  shopLabel,
} from './format';

describe('formatMoney', () => {
  it('divides the minor amount by 100 and always keeps two decimals', () => {
    expect(formatMoney(300000, 'USD', 'en')).toBe('$3,000.00');
    expect(formatMoney(150050, 'USD', 'en')).toBe('$1,500.50');
    expect(formatMoney(0, 'USD', 'en')).toBe('$0.00');
  });
  it('falls back to the code for an unknown currency', () => {
    expect(formatMoney(12345, 'ZZZZ', 'en')).toBe('ZZZZ 123.45');
  });
});

describe('formatOrderTotal', () => {
  it('prints symbol, space and two decimals for the four known currencies, the code for the rest', () => {
    expect(formatOrderTotal(299800, 'INR', 'en')).toBe('₹ 2,998.00');
    expect(formatOrderTotal(1050, 'USD', 'en')).toBe('$ 10.50');
    expect(formatOrderTotal(1050, 'KES', 'en')).toBe('KES 10.50');
  });
});

describe('formatInt', () => {
  it('groups thousands', () => {
    expect(formatInt(12345, 'en')).toBe('12,345');
  });
});

describe('formatWhen', () => {
  it('returns an empty string for garbage', () => {
    expect(formatWhen('nope', 'en')).toBe('');
  });
  it('formats a real instant', () => {
    expect(formatWhen('2026-10-02T14:05:00.000Z', 'en')).toMatch(/Oct/);
  });
});

describe('orderTone', () => {
  it('maps paid, cancelled and the rest', () => {
    expect(orderTone('paid')).toBe('success');
    expect(orderTone('cancelled')).toBe('danger');
    expect(orderTone('new')).toBe('neutral');
  });
});

describe('barPercent', () => {
  it('is the share of the leader with a floor of 2', () => {
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(3, 0)).toBe(2);
  });
});

describe('shopHref and shopLabel', () => {
  it('adds the shop id only when there is one', () => {
    expect(shopHref('/store', 'abc')).toBe('/store?shop=abc');
    expect(shopHref('/store', null)).toBe('/store');
  });
  it('labels an unnamed shop with a short id', () => {
    expect(shopLabel({ id: 'abcdef123', shopName: ' Mine ' }, 'Shop')).toBe('Mine');
    expect(shopLabel({ id: 'abcdef123', shopName: null }, 'Shop')).toBe('Shop abcdef');
  });
});
