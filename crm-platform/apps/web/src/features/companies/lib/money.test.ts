import { describe, expect, it } from 'vitest';
import { formatTotal, formatTotals } from './money';

describe('formatTotal (Reference divided every currency by 100 and printed no currency)', () => {
  it('uses the currency’s own decimals', () => {
    expect(formatTotal({ currency: 'USD', amount: '1250.5' }, 'en')).toBe('$1,250.50');
    expect(formatTotal({ currency: 'JPY', amount: '1000' }, 'en')).toBe('¥1,000');
    expect(formatTotal({ currency: 'KWD', amount: '1.5' }, 'en')).toContain('1.500');
  });

  it('falls back to "CODE amount" for a code the browser does not know', () => {
    expect(formatTotal({ currency: '???', amount: '5' }, 'en')).toBe('??? 5.00');
  });
});

describe('formatTotals', () => {
  it('is one line per currency, never added together', () => {
    expect(
      formatTotals(
        [
          { currency: 'EUR', amount: '10.00' },
          { currency: 'USD', amount: '40.00' },
        ],
        'en',
      ),
    ).toEqual(['€10.00', '$40.00']);
  });

  it('is empty for nothing and for a figure the caller may not see', () => {
    expect(formatTotals([], 'en')).toEqual([]);
    expect(formatTotals(null, 'en')).toEqual([]);
    expect(formatTotals(undefined, 'en')).toEqual([]);
  });
});
