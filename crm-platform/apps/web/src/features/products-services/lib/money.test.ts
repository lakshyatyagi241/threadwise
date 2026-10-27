import { describe, expect, it } from 'vitest';
import { formatPrice, parsePrice, priceToInput, taxText } from './money';

describe('a price a person types', () => {
  it('is read in minor units, by the currency decimals', () => {
    expect(parsePrice('1250.50', 'INR')).toBe(125050);
    expect(parsePrice('1,250', 'USD')).toBe(125000);
    expect(parsePrice('1500', 'JPY')).toBe(1500);
    expect(parsePrice('1.5', 'KWD')).toBe(1500);
  });
  it('rounds an extra decimal half up and refuses what is not an amount', () => {
    expect(parsePrice('0.005', 'USD')).toBe(1);
    expect(parsePrice('0.004', 'USD')).toBe(0);
    expect(parsePrice('abc', 'USD')).toBeNull();
    expect(parsePrice('-5', 'USD')).toBeNull();
    expect(parsePrice('', 'USD')).toBeNull();
  });
  it('goes back into the box the way it was typed', () => {
    expect(priceToInput(125050, 'INR')).toBe('1250.50');
    expect(priceToInput(5, 'USD')).toBe('0.05');
    expect(priceToInput(1500, 'JPY')).toBe('1500');
  });
  it('is shown for the locale, and a code Intl does not know still shows', () => {
    expect(formatPrice(125000, 'USD', 'en')).toBe('$1,250.00');
    expect(formatPrice(125000, 'ZZZZ', 'en')).toBe('ZZZZ 1250.00');
  });
  it('writes a tax as a short number, or nothing', () => {
    expect(taxText(18)).toBe('18');
    expect(taxText(12.5)).toBe('12.5');
    expect(taxText(null)).toBe('');
  });
});
