import { describe, expect, it } from 'vitest';
import { afterPaymentPath, safeReturnPath } from './return-path';

describe('where the buyer lands after paying', () => {
  it('accepts a Marketplace app page only', () => {
    expect(safeReturnPath('/marketplace/app/quote-pro')).toBe('/marketplace/app/quote-pro');
    expect(safeReturnPath(' /marketplace/app/quote-pro ')).toBe('/marketplace/app/quote-pro');
    for (const bad of [
      null,
      '',
      'https://evil.test/marketplace/app/x',
      '//evil.test',
      '/marketplace/app/x/install',
      '/marketplace/app/',
      '/billing/orders',
      '/marketplace/app/x?y=1',
      '/marketplace/app/../../etc',
      '/marketplace/app/a b',
    ])
      expect(safeReturnPath(bad), String(bad)).toBeNull();
  });

  it('falls back to the order history', () => {
    expect(afterPaymentPath('success', 'WSN-1', null)).toBe(
      '/billing/orders?payment=success&order=WSN-1',
    );
    expect(afterPaymentPath('success', 'WSN-1', '/marketplace/app/quote-pro')).toBe(
      '/marketplace/app/quote-pro?payment=success&order=WSN-1',
    );
  });
});
