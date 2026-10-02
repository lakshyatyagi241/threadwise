import { describe, expect, it } from 'vitest';
import { pickTotal, toMinorUnits } from './mappers';

describe('wire money to minor units', () => {
  it('reads decimal strings by currency', () => {
    expect(toMinorUnits('100.50', 'USD')).toBe(10050);
    expect(toMinorUnits('500', 'JPY')).toBe(500);
    expect(toMinorUnits('1.234', 'KWD')).toBe(1234);
    expect(toMinorUnits('garbage', 'USD')).toBe(0);
  });

  it('prefers the converted total, else the entry in the wanted currency, else zero', () => {
    const byCurrency = [
      { currency: 'INR', amount: '33876.00' },
      { currency: 'USD', amount: '120.50' },
    ];
    expect(pickTotal({ byCurrency, converted: { currency: 'INR', amount: '40000.00' } }, 'INR')).toBe(4_000_000);
    // a missing exchange rate leaves converted null: only the pipeline's own currency counts
    expect(pickTotal({ byCurrency, converted: null, unconverted: ['USD'] }, 'INR')).toBe(3_387_600);
    expect(pickTotal({ byCurrency }, 'EUR')).toBe(0);
    expect(pickTotal({ byCurrency: [] }, 'USD')).toBe(0);
    expect(pickTotal(undefined, 'USD')).toBe(0);
  });
});
