import { describe, expect, it } from 'vitest';
import {
  createDealSchema,
  currencyExponent,
  majorToMinor,
  minorToMajor,
  type DealTotals,
} from '@crm/contracts';
import {
  addTo,
  convertMinor,
  parseRate,
  rateTableOf,
  sortKey,
  totalsOf,
  weightedMinor,
  type CurrencySums,
} from '../../../src/modules/crm/deals/deal-money';

describe('deal money: exact minor units (TW-DEAL-006)', () => {
  it('TW-DEAL-006 #1: 100.50 is 10050 minor units and reads back as "100.50"', () => {
    expect(majorToMinor('100.50', 'USD')).toBe(10050n);
    expect(minorToMajor(10050n, 'USD')).toBe('100.50');
    expect(majorToMinor('100.5', 'USD')).toBe(10050n);
    expect(majorToMinor('100', 'USD')).toBe(10000n);
  });

  it('TW-DEAL-006: no float is involved (0.1 + 0.2 style sums stay exact)', () => {
    expect(majorToMinor('0.10', 'USD')! + majorToMinor('0.20', 'USD')!).toBe(30n);
    expect(minorToMajor(30n, 'USD')).toBe('0.30');
    expect(majorToMinor('99999999', 'USD')).toBe(9999999900n);
    expect(majorToMinor('99999999.01', 'USD')).toBeNull();
  });

  it('TW-DEAL-006 #3: 100,000,000 is above the cap and is refused', () => {
    expect(majorToMinor('100000000', 'USD')).toBeNull();
    expect(createDealSchema.safeParse({ title: 'x', value: '100000000' }).success).toBe(false);
    expect(createDealSchema.safeParse({ title: 'x', value: '99999999' }).success).toBe(true);
  });

  it('TW-DEAL-006 port decision: the decimals follow the currency (JPY has none, KWD has three)', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('INR')).toBe(2);
    expect(majorToMinor('500', 'JPY')).toBe(500n);
    expect(majorToMinor('500.5', 'JPY')).toBeNull();
    expect(majorToMinor('500.00', 'JPY')).toBe(500n);
    expect(majorToMinor('1.234', 'KWD')).toBe(1234n);
    expect(majorToMinor('1.234', 'USD')).toBeNull();
    expect(minorToMajor(500n, 'JPY')).toBe('500');
    expect(minorToMajor(1234n, 'KWD')).toBe('1.234');
    expect(minorToMajor(5n, 'USD')).toBe('0.05');
  });

  it('TW-DEAL-006 port decision: a currency is three letters and is upper-cased (Reference took any ten characters)', () => {
    expect(createDealSchema.parse({ title: 'x', currency: 'eur' }).currency).toBe('EUR');
    expect(createDealSchema.safeParse({ title: 'x', currency: 'EURO' }).success).toBe(false);
    expect(createDealSchema.safeParse({ title: 'x', currency: '12$' }).success).toBe(false);
  });

  it('TW-DEAL-006 #4: a weighted value is minor x probability / 100, rounded half up', () => {
    expect(weightedMinor(30000n, 25)).toBe(7500n);
    expect(weightedMinor(10001n, 50)).toBe(5001n);
    expect(weightedMinor(10000n, 0)).toBe(0n);
    expect(weightedMinor(12345n, 100)).toBe(12345n);
  });
});

describe('currency conversion (TW-DEAL-005, 006, D-05)', () => {
  const rates = rateTableOf([
    { code: 'USD', exchange_rate: '1.000000' },
    { code: 'INR', exchange_rate: '83.000000' },
    { code: 'JPY', exchange_rate: '150.000000' },
    { code: 'ZZZ', exchange_rate: '0.000000' },
  ]);

  it('TW-DEAL-006 #2: a EUR-priced amount is converted by amount / rate(from) * rate(to)', () => {
    // 100.00 USD -> INR at 83: 8300.00 INR
    expect(convertMinor(10000n, 'USD', 'INR', rates)).toBe(830000n);
    // 8300.00 INR -> USD
    expect(convertMinor(830000n, 'INR', 'USD', rates)).toBe(10000n);
  });

  it('TW-DEAL-006: the minor-unit exponents of both currencies are respected (USD cents -> JPY whole yen)', () => {
    // 100.00 USD = 10000 cents; at 150 JPY per USD = 15000 yen
    expect(convertMinor(10000n, 'USD', 'JPY', rates)).toBe(15000n);
    expect(convertMinor(15000n, 'JPY', 'USD', rates)).toBe(10000n);
  });

  it('TW-DEAL-006: the same currency converts to itself even with no rate', () => {
    expect(convertMinor(123n, 'EUR', 'EUR', new Map())).toBe(123n);
  });

  it('TW-DEAL-005 / D-05: a currency with no usable rate is not converted (Reference treated it as 1.0)', () => {
    expect(convertMinor(100n, 'EUR', 'USD', rates)).toBeNull();
    expect(convertMinor(100n, 'USD', 'EUR', rates)).toBeNull();
    expect(rates.has('ZZZ')).toBe(false); // a zero rate is no rate
  });

  it('TW-DEAL-005: rates are parsed exactly from the numeric(16,6) text', () => {
    expect(parseRate('83.5')).toBe(83500000n);
    expect(parseRate('0.000001')).toBe(1n);
    expect(parseRate('0')).toBeNull();
    expect(parseRate('abc')).toBeNull();
  });

  it('TW-DEAL-019 / D-05: totals are per currency, and converted only on request', () => {
    const sums: CurrencySums = new Map();
    addTo(sums, 'USD', 10000n);
    addTo(sums, 'INR', 830000n);
    addTo(sums, 'USD', 5n);

    const plain = totalsOf(sums, null, rates);
    expect(plain).toEqual<DealTotals>({
      byCurrency: [
        { currency: 'INR', amount: '8300.00' },
        { currency: 'USD', amount: '100.05' },
      ],
    });

    const inUsd = totalsOf(sums, 'USD', rates);
    expect(inUsd.converted).toEqual({ currency: 'USD', amount: '200.05' });
    expect(inUsd.unconverted).toEqual([]);
  });

  it('TW-DEAL-019: with a currency that has no rate there is no converted figure, and it is named', () => {
    const sums: CurrencySums = new Map();
    addTo(sums, 'USD', 10000n);
    addTo(sums, 'EUR', 5000n);
    const out = totalsOf(sums, 'USD', rates);
    expect(out.converted).toBeNull();
    expect(out.unconverted).toEqual(['EUR']);
    expect(out.byCurrency).toHaveLength(2);
  });

  it('TW-DEAL-019 #5: leaders are ordered by the converted amount when asked, else by the first currency', () => {
    const a: CurrencySums = new Map([['INR', 830000n]]); // 100 USD
    const b: CurrencySums = new Map([['USD', 5000n]]); // 50 USD
    expect(sortKey(a, 'USD', rates) > sortKey(b, 'USD', rates)).toBe(true);
    expect(sortKey(new Map(), null, rates)).toBe(0n);
  });
});
