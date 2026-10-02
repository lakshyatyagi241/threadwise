import { describe, expect, it } from 'vitest';
import { pick, randInt, rng } from '../test-utils';
import { applyCashRounding, cashRoundingFor } from './cash';
import { currencyExponent, isKnownCurrency, KNOWN_CURRENCIES, minorPerMajor } from './currency';
import {
  bpToPercent,
  formatQty,
  formatRate,
  minorToMajorString,
  parseMoney,
  parseQty,
  parseRate,
  parseScaled,
  percentToBp,
} from './decimal';
import { formatDecimalLocale, formatMoney } from './format';
import { allocate, divRound, ROUNDING_MODES, roundToMultiple, type RoundingMode } from './rounding';

describe('divRound', () => {
  const table: Array<[bigint, bigint, RoundingMode, bigint]> = [
    // 2.5 and -2.5, 3.5, 0.4, 0.6
    [5n, 2n, 'half_up', 3n],
    [-5n, 2n, 'half_up', -3n],
    [5n, 2n, 'half_down', 2n],
    [-5n, 2n, 'half_down', -2n],
    [5n, 2n, 'half_even', 2n],
    [7n, 2n, 'half_even', 4n],
    [-5n, 2n, 'half_even', -2n],
    [-7n, 2n, 'half_even', -4n],
    [4n, 10n, 'half_up', 0n],
    [6n, 10n, 'half_up', 1n],
    [1n, 3n, 'up', 1n],
    [-1n, 3n, 'up', -1n],
    [1n, 3n, 'down', 0n],
    [-1n, 3n, 'down', 0n],
    [1n, 3n, 'ceil', 1n],
    [-1n, 3n, 'ceil', 0n],
    [1n, 3n, 'floor', 0n],
    [-1n, 3n, 'floor', -1n],
    [6n, 3n, 'up', 2n],
    [0n, 7n, 'half_up', 0n],
  ];
  it.each(table)('%s / %s by %s = %s', (n, d, mode, want) => {
    expect(divRound(n, d, mode)).toBe(want);
  });

  it('normalises a negative divisor and rejects zero', () => {
    expect(divRound(5n, -2n, 'half_up')).toBe(-3n);
    expect(() => divRound(1n, 0n)).toThrow(RangeError);
  });

  it('every mode stays within one unit of the exact quotient (property)', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const n = BigInt(randInt(r, -100000, 100000));
      const d = BigInt(randInt(r, 1, 997));
      for (const mode of ROUNDING_MODES) {
        const q = divRound(n, d, mode);
        expect(q * d - n < d && n - q * d < d).toBe(true);
      }
    }
  });

  it('half_even is unbiased: the sum of n.5 ties is exact over a pair', () => {
    expect(divRound(1n, 2n, 'half_even') + divRound(3n, 2n, 'half_even')).toBe(2n); // 0 + 2
    expect(divRound(1n, 2n, 'half_up') + divRound(3n, 2n, 'half_up')).toBe(3n); // 1 + 2
  });
});

describe('roundToMultiple', () => {
  it('rounds to a step', () => {
    expect(roundToMultiple(123456n, 5n)).toBe(123455n);
    expect(roundToMultiple(123458n, 5n)).toBe(123460n);
    expect(roundToMultiple(123457n, 5n)).toBe(123455n);
    expect(roundToMultiple(-123458n, 5n)).toBe(-123460n);
    expect(roundToMultiple(125n, 5n, 'half_even')).toBe(125n);
  });
  it('rejects a non-positive step', () => {
    expect(() => roundToMultiple(1n, 0n)).toThrow(RangeError);
  });
});

describe('allocate (largest remainder)', () => {
  it('splits exactly with ties to the earlier index', () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocate(1n, [1n, 1n])).toEqual([1n, 0n]);
    expect(allocate(10n, [0n, 0n])).toEqual([0n, 0n]);
    expect(allocate(0n, [5n, 5n])).toEqual([0n, 0n]);
  });
  it('allocates in proportion', () => {
    expect(allocate(1000n, [100n, 300n])).toEqual([250n, 750n]);
    expect(allocate(7n, [1n, 2n])).toEqual([2n, 5n]);
  });
  it('a zero weight gets nothing even when remainders are left', () => {
    expect(allocate(5n, [0n, 1n, 1n])).toEqual([0n, 3n, 2n]);
  });
  it('sum of parts equals the total (property)', () => {
    const r = rng(42);
    for (let i = 0; i < 3000; i++) {
      const n = randInt(r, 1, 12);
      const weights = Array.from({ length: n }, () => BigInt(randInt(r, 0, 100000)));
      const total = BigInt(randInt(r, -5_000_000, 5_000_000));
      const parts = allocate(total, weights);
      const sumW = weights.reduce((a, b) => a + b, 0n);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(sumW === 0n ? 0n : total);
      parts.forEach((p, k) => {
        if (weights[k] === 0n) expect(p).toBe(0n);
      });
    }
  });
  it('is antisymmetric and never off by more than one from the exact share', () => {
    const r = rng(9);
    for (let i = 0; i < 500; i++) {
      const weights = Array.from({ length: 5 }, () => BigInt(randInt(r, 1, 1000)));
      const t = BigInt(randInt(r, 1, 100000));
      const pos = allocate(t, weights);
      const neg = allocate(-t, weights);
      expect(neg).toEqual(pos.map((x) => -x));
      const sum = weights.reduce((a, b) => a + b, 0n);
      pos.forEach((p, k) => {
        const exact = (t * weights[k]!) / sum;
        expect(p === exact || p === exact + 1n).toBe(true);
      });
    }
  });
});

describe('currency exponents (ISO 4217)', () => {
  it.each([
    ['USD', 2],
    ['EUR', 2],
    ['INR', 2],
    ['GBP', 2],
    ['JPY', 0],
    ['KRW', 0],
    ['VND', 0],
    ['ISK', 0],
    ['UGX', 0],
    ['XOF', 0],
    ['KWD', 3],
    ['BHD', 3],
    ['OMR', 3],
    ['JOD', 3],
    ['TND', 3],
    ['CLF', 4],
    ['HUF', 2],
    ['TWD', 2],
    ['IDR', 2],
    ['jpy', 0],
    ['kwd', 3],
  ])('%s has %i decimals', (code, exp) => {
    expect(currencyExponent(code)).toBe(exp);
  });
  it('knows the minor-per-major factor and the code list', () => {
    expect(minorPerMajor('KWD')).toBe(1000n);
    expect(minorPerMajor('JPY')).toBe(1n);
    expect(isKnownCurrency('inr')).toBe(true);
    expect(isKnownCurrency('XXZ')).toBe(false);
    expect(new Set(KNOWN_CURRENCIES).size).toBe(KNOWN_CURRENCIES.length);
  });
});

describe('decimal parsing and formatting', () => {
  it('parses exactly with no float', () => {
    expect(parseMoney('100.50', 'USD')).toBe(10050n);
    expect(parseMoney('1500', 'JPY')).toBe(1500n);
    expect(parseMoney('1500.00', 'JPY')).toBe(1500n);
    expect(parseMoney('1500.5', 'JPY')).toBeNull();
    expect(parseMoney('12.5', 'KWD')).toBe(12500n);
    expect(parseMoney('12.5005', 'KWD')).toBeNull();
    expect(parseMoney('0.1', 'USD')).toBe(10n);
    expect(parseMoney('abc', 'USD')).toBeNull();
    expect(parseMoney('-1', 'USD')).toBeNull();
    expect(parseMoney('-1', 'USD', { allowNegative: true })).toBe(-100n);
    expect(parseMoney('999999999999999.99', 'USD')).toBe(99999999999999999n);
  });
  it('formats minor units as a major-unit string with the full exponent', () => {
    expect(minorToMajorString(10050n, 'USD')).toBe('100.50');
    expect(minorToMajorString(5n, 'USD')).toBe('0.05');
    expect(minorToMajorString(1500n, 'JPY')).toBe('1500');
    expect(minorToMajorString(12500n, 'KWD')).toBe('12.500');
    expect(minorToMajorString(-250n, 'USD')).toBe('-2.50');
  });
  it('round-trips parse -> format for every exponent', () => {
    const r = rng(11);
    for (const cur of ['USD', 'JPY', 'KWD', 'CLF']) {
      for (let i = 0; i < 200; i++) {
        const minor = BigInt(randInt(r, 0, 2_000_000_000));
        expect(parseMoney(minorToMajorString(minor, cur), cur)).toBe(minor);
      }
    }
  });
  it('quantities carry 4 decimals', () => {
    expect(parseQty('2.5')).toBe(25000n);
    expect(parseQty('0.3333')).toBe(3333n);
    expect(parseQty('0.33333')).toBeNull();
    expect(formatQty(25000n)).toBe('2.5');
    expect(formatQty(10000n)).toBe('1');
  });
  it('rates are exact to 4 decimals of a percent', () => {
    expect(parseRate('18')).toBe(180000n);
    expect(parseRate('9.975')).toBe(99750n);
    expect(parseRate(7.5)).toBe(75000n);
    expect(parseRate('-10')).toBe(-100000n);
    expect(parseRate('10.66667')).toBeNull();
    expect(parseRate('1e2')).toBeNull();
    expect(parseRate(Number.NaN)).toBeNull();
    expect(formatRate(99750n)).toBe('9.975');
    expect(formatRate(-100000n)).toBe('-10');
    expect(bpToPercent(1850)).toBe('18.5');
    expect(percentToBp('9.975')).toBe(997.5);
    expect(parseScaled('12.50', 1)).toBe(125n);
  });
});

describe('formatMoney', () => {
  it('formats with the right decimals per currency and locale', () => {
    expect(formatMoney(1250050n, 'USD')).toBe('$12,500.50');
    expect(formatMoney(1500n, 'JPY', { locale: 'ja-JP' })).toMatch(/1,500/);
    expect(formatMoney(1500n, 'JPY')).not.toMatch(/\./);
    expect(formatMoney(12500n, 'KWD')).toMatch(/12\.500/);
    const inr = formatMoney(1250050n, 'INR', { locale: 'en-IN' });
    expect(inr).toMatch(/12,500\.50/);
    expect(formatMoney(12345678900n, 'INR', { locale: 'en-IN' })).toMatch(/12,34,56,789\.00/);
    expect(formatMoney(-500n, 'USD')).toMatch(/-.*5\.00/);
  });
  it('can show the code and trim whole decimals', () => {
    expect(formatMoney(10000n, 'USD', { trimWholeDecimals: true })).toBe('$100');
    expect(formatMoney(10050n, 'USD', { trimWholeDecimals: true })).toBe('$100.50');
    expect(formatMoney(10000n, 'EUR', { display: 'code' })).toMatch(/EUR/);
  });
  it('is exact for amounts beyond a double', () => {
    expect(formatMoney(99999999999999999n, 'USD')).toBe('$999,999,999,999,999.99');
  });
  it('falls back when the locale or currency is rejected', () => {
    expect(formatMoney(123456n, 'USD', { locale: 'not a locale' })).toBe('USD 1,234.56');
  });
  it('formats plain decimals', () => {
    expect(formatDecimalLocale(25000n, 4)).toBe('2.5');
    expect(formatDecimalLocale(12345670000n, 4, 'de-DE')).toBe('1.234.567');
  });
});

describe('cash rounding', () => {
  it('CHF rounds to 0.05', () => {
    const c = cashRoundingFor('CHF')!;
    expect(applyCashRounding(123456n, c)).toEqual({ roundedMinor: 123455n, adjustmentMinor: -1n });
    expect(applyCashRounding(123458n, c)).toEqual({ roundedMinor: 123460n, adjustmentMinor: 2n });
    expect(applyCashRounding(123455n, c)).toEqual({ roundedMinor: 123455n, adjustmentMinor: 0n });
  });
  it('NZD rounds to 0.10 and unknown currencies have no cash rounding', () => {
    expect(applyCashRounding(1005n, cashRoundingFor('NZD')!).roundedMinor).toBe(1010n);
    expect(cashRoundingFor('USD')).toBeNull();
  });
  it('adjustment never exceeds half the step (property)', () => {
    const r = rng(5);
    for (let i = 0; i < 500; i++) {
      const step = BigInt(pick(r, [5, 10, 50, 100]));
      const t = BigInt(randInt(r, -1_000_000, 1_000_000));
      const { adjustmentMinor, roundedMinor } = applyCashRounding(t, { incrementMinor: step });
      expect(roundedMinor % step).toBe(0n);
      expect((adjustmentMinor < 0n ? -adjustmentMinor : adjustmentMinor) * 2n <= step).toBe(true);
    }
  });
});
