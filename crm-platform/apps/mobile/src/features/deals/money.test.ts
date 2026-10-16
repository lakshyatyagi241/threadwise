import { amountFromInput, currencyChoices, formatMoney, formatTotals } from './money';

describe('formatMoney', () => {
  it('writes an amount with the currency and the decimals that currency has', () => {
    expect(formatMoney('12500.00', 'USD', 'en')).toBe('$12,500.00');
    expect(formatMoney('5000', 'JPY', 'en')).toBe('¥5,000');
    expect(formatMoney('1.500', 'KWD', 'en')).toContain('1.500');
  });

  it('shortens an amount for a tight header', () => {
    expect(formatMoney('12500.00', 'USD', 'en', { compact: true })).toBe('$12.5K');
  });

  it('falls back to the code and the amount when the amount or the code is not usable', () => {
    expect(formatMoney('abc', 'USD', 'en')).toBe('USD abc');
    expect(formatMoney('10.00', 'US', 'en')).toBe('US 10.00');
  });

  it('prints ordinary digits in a language that has its own', () => {
    expect(formatMoney('1250.50', 'USD', 'mr')).toMatch(/1,250\.50/);
  });
});

describe('formatTotals', () => {
  it('shows one currency as one amount', () => {
    expect(formatTotals([{ currency: 'USD', amount: '1250.00' }], 'en')).toBe('$1,250.00');
  });

  it('keeps several currencies apart instead of adding them together', () => {
    expect(
      formatTotals(
        [
          { currency: 'USD', amount: '1250.00' },
          { currency: 'EUR', amount: '800.00' },
        ],
        'en',
      ),
    ).toBe('$1,250.00 · €800.00');
  });

  it('shows a dash when there is nothing, or only zeros', () => {
    expect(formatTotals([], 'en')).toBe('—');
    expect(formatTotals([{ currency: 'USD', amount: '0.00' }], 'en')).toBe('—');
  });
});

describe('amountFromInput', () => {
  it("turns what was typed into the amount the API takes, with the currency's own decimals", () => {
    expect(amountFromInput('1250.5', 'USD')).toBe('1250.50');
    expect(amountFromInput(' 1,250 ', 'USD')).toBe('1250.00');
    expect(amountFromInput('.5', 'USD')).toBe('0.50');
    expect(amountFromInput('5000', 'JPY')).toBe('5000');
    expect(amountFromInput('1.250', 'KWD')).toBe('1.250');
  });

  it('reads blank as zero', () => {
    expect(amountFromInput('', 'USD')).toBe('0');
    expect(amountFromInput('   ', 'USD')).toBe('0');
  });

  it('refuses text that is not an amount', () => {
    for (const bad of ['abc', '-5', '1.2.3', '.', '12e3', '1 000']) {
      expect(amountFromInput(bad, 'USD')).toBeNull();
    }
  });

  it('refuses more decimals than the currency has instead of rounding', () => {
    expect(amountFromInput('1.005', 'USD')).toBeNull();
    expect(amountFromInput('5000.5', 'JPY')).toBeNull();
    expect(amountFromInput('1.500', 'USD')).toBe('1.50');
  });

  it('refuses an amount above the largest a deal can carry', () => {
    expect(amountFromInput('99999999', 'USD')).toBe('99999999.00');
    expect(amountFromInput('100000000', 'USD')).toBeNull();
  });
});

describe('currencyChoices', () => {
  it("puts the pipeline's own currency first and never lists a code twice", () => {
    expect(currencyChoices('USD')[0]).toBe('USD');
    expect(currencyChoices('USD').filter((c) => c === 'USD')).toHaveLength(1);
    expect(currencyChoices('NOK')[0]).toBe('NOK');
    expect(currencyChoices('NOK')).toContain('USD');
  });
});
