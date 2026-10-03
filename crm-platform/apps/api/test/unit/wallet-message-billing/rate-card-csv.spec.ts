import { describe, expect, it } from 'vitest';
import {
  convertMicros,
  parseCsv,
  parseRateCardCsv,
} from '../../../src/modules/wallet-message-billing/rate-card-csv';
import { parseLive } from '../../../src/modules/wallet-message-billing/platform-rates.service';

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, CRLF, a BOM and the semicolon delimiter', () => {
    expect(parseCsv('\u{FEFF}a,b\r\n"x,1","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x,1', 'say "hi"'],
    ]);
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops empty lines', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toHaveLength(2);
  });
});

describe('parseRateCardCsv (WD-WALLET-006)', () => {
  it("reads Meta's wide shape: one row per country, one column per category", () => {
    const r = parseRateCardCsv('country,currency,marketing,utility\nIndia,INR,0.7846,0.115\n');
    expect(r.shape).toBe('wide');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      countryCode: 'IN',
      category: 'marketing',
      costMicros: 784_600,
      currency: 'INR',
    });
    expect(r.rows[1]).toMatchObject({ category: 'utility', costMicros: 115_000 });
  });

  it('skips and reports a country it does not know', () => {
    const r = parseRateCardCsv('country,marketing\nNarnia,0.5\nUS,0.025\n');
    expect(r.rows).toHaveLength(1);
    expect(r.problems).toEqual([{ line: 2, reason: 'Unknown country "Narnia"' }]);
  });

  it('reads the long shape, keeps 3 decimals of cost, and leaves price untouched when absent', () => {
    const r = parseRateCardCsv('country_code,category,cost\nUS,marketing,0.0250\n,utility,0.004\n');
    expect(r.shape).toBe('long');
    expect(r.rows[0]).toMatchObject({
      countryCode: 'US',
      category: 'marketing',
      costMicros: 25_000,
      priceMinor: undefined,
    });
    expect(r.rows[1]).toMatchObject({ countryCode: '', category: 'utility', costMicros: 4_000 });
  });

  it('takes a customer price from a credits column in money and reports a bad one', () => {
    const r = parseRateCardCsv(
      'country,category,cost,credits\nUS,marketing,0.025,12.00\nIN,marketing,0.01,abc\n',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.priceMinor).toBe(1200);
    expect(r.problems[0]!.reason).toMatch(/not an amount/);
  });

  it('rejects an unknown category and a file with no country column', () => {
    expect(parseRateCardCsv('country,category,cost\nUS,vip,1\n').problems[0]!.reason).toMatch(
      /Unknown category/,
    );
    expect(parseRateCardCsv('foo,bar\n1,2\n').problems[0]!.reason).toMatch(/No country column/);
  });

  it('reports an empty file', () => {
    expect(parseRateCardCsv('').problems).toHaveLength(1);
  });
});

describe('convertMicros', () => {
  it('converts through the per-USD rates and leaves the amount alone for a missing or equal rate', () => {
    expect(convertMicros(1_000_000, 83, 1)).toBe(12_048);
    expect(convertMicros(1_000_000, 1, 83)).toBe(83_000_000);
    expect(convertMicros(500, 0, 1)).toBe(500);
    expect(convertMicros(500, 5, 5)).toBe(500);
  });
});

describe('parseLive (WD-WALLET-007 rule 1)', () => {
  it('accepts the folded shape', () => {
    const r = parseLive({
      version: '2026-Q4',
      rates: [{ country: 'US', currency: 'USD', marketing: 0.025, utility: 0.004 }],
    });
    expect(r.version).toBe('2026-Q4');
    expect(r.rows[0]).toMatchObject({ country: 'US', marketing: 0.025, utility: 0.004 });
  });

  it('folds a flat list of one amount per row, also when wrapped in data', () => {
    const r = parseLive({
      data: [
        { country_code: 'US', category: 'marketing', rate: 0.025 },
        { country_code: 'US', category: 'utility', amount: 0.004 },
        { country: 'IN', category: 'authentication', price: 0.003 },
      ],
    });
    expect(r.rows).toHaveLength(2);
    expect(r.rows.find((x) => x.country === 'US')).toMatchObject({
      marketing: 0.025,
      utility: 0.004,
    });
  });

  it('answers no rows for anything else', () => {
    expect(parseLive(null).rows).toEqual([]);
    expect(parseLive({ foo: 1 }).rows).toEqual([]);
  });
});
