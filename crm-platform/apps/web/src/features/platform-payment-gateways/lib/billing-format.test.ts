import { describe, expect, it } from 'vitest';
import { currencyDigits, minorToMajor, toMinorUnits } from './billing-format';

describe('refund amounts in minor units', () => {
  it('knows how many decimals a currency has', () => {
    expect(currencyDigits('INR')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
    expect(currencyDigits('nope')).toBe(2);
  });

  it('shows minor units as the right major amount', () => {
    expect(minorToMajor('1250', 'INR')).toBe('12.50');
    expect(minorToMajor('5', 'INR')).toBe('0.05');
    expect(minorToMajor('1250', 'JPY')).toBe('1250');
    expect(minorToMajor('12345', 'KWD')).toBe('12.345');
  });

  it('turns what a person typed into minor units, per currency', () => {
    expect(toMinorUnits('12.50', 'INR')).toBe('1250');
    expect(toMinorUnits('12,5', 'INR')).toBe('1250');
    expect(toMinorUnits('1250', 'JPY')).toBe('1250');
    expect(toMinorUnits('12.5', 'JPY')).toBeNull();
    expect(toMinorUnits('12.345', 'INR')).toBeNull();
    expect(toMinorUnits('0', 'INR')).toBeNull();
    expect(toMinorUnits('abc', 'INR')).toBeNull();
  });
});
