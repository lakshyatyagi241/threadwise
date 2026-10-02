import { describe, expect, it } from 'vitest';
import {
  BSP_CREDIT_CURRENCIES,
  normalizeCurrencyInput,
  normalizeGraphVersion,
  updateBspSettingsSchema,
} from '@crm/contracts';
import {
  currencyProblem,
  isPayPerMessage,
  monthWindow,
  normalizeCountry,
  normalizeRateCategory,
  pickAttachCurrency,
  resolveRate,
  subtractDecimal,
  wabaTail,
  type RateRow,
} from '../../../src/modules/bsp-billing-engine/reseller-rules';

const row = (
  countryCode: string,
  category: string,
  credits: number,
  metaCostMinor: string | null,
): RateRow => ({ countryCode, category, credits, metaCostMinor });

describe('Meta cost resolution (TW-BSP-016)', () => {
  const rates = [
    row('IN', 'marketing', 100, '72'),
    row('US', 'marketing', 1200, null),
    row('', 'marketing', 500, '400'),
    row('', '', 1, '10'),
  ];

  it('#1 uses the cost of the country+category row', () => {
    expect(resolveRate(rates, 'IN', 'marketing')).toEqual({ credits: 100, costMinor: '72' });
  });

  it('#3 a specific row without a cost falls through to the next row that has one, but keeps its own price', () => {
    // US marketing has a price but no cost; the any-country marketing row carries 400.
    expect(resolveRate(rates, 'US', 'marketing')).toEqual({ credits: 1200, costMinor: '400' });
  });

  it('#2 no row carries a cost: unknown is null, never 0', () => {
    expect(resolveRate([row('', '', 1, null)], 'DE', 'utility')).toEqual({ credits: 1, costMinor: null });
  });

  it('a free destination (cost 0) is a known cost, distinct from unknown', () => {
    expect(resolveRate([row('IN', 'utility', 0, '0'), row('', '', 1, '10')], 'IN', 'utility').costMinor).toBe('0');
  });

  it('no rows at all prices nothing', () => {
    expect(resolveRate([], 'IN', 'marketing')).toEqual({ credits: null, costMinor: null });
  });

  it('a category outside Meta four, or a missing one, resolves to the any-category row; a bad country to any-country', () => {
    expect(normalizeRateCategory('Promo')).toBe('');
    expect(normalizeRateCategory(' Marketing ')).toBe('marketing');
    expect(normalizeCountry('india')).toBe('');
    expect(normalizeCountry('in')).toBe('IN');
    expect(resolveRate(rates, 'zz', 'promo')).toEqual({ credits: 1, costMinor: '10' });
  });

  it('prefers country with any category over any country with the category', () => {
    const r = [row('IN', '', 7, '5'), row('', 'utility', 9, '6'), row('', '', 1, '1')];
    expect(resolveRate(r, 'IN', 'utility')).toEqual({ credits: 7, costMinor: '5' });
  });
});

describe('who is billed (TW-BSP-012 rule 1)', () => {
  it('a reseller workspace is wallet billed whatever the switch says', () => {
    expect(isPayPerMessage(true, false)).toBe(true);
  });
  it('a direct workspace follows the platform switch', () => {
    expect(isPayPerMessage(false, false)).toBe(false);
    expect(isPayPerMessage(false, true)).toBe(true);
  });
});

describe('credit line currency (TW-BSP-004, -006)', () => {
  it('"usd1" is stored as USD', () => {
    expect(normalizeCurrencyInput('usd1')).toBe('USD');
    expect(normalizeCurrencyInput('  ')).toBe('');
    expect(normalizeCurrencyInput('abcdefghijkl')).toBe('ABCDEFGH');
  });

  it('refuses everything Meta does not accept, naming the six', () => {
    for (const ok of BSP_CREDIT_CURRENCIES) expect(currencyProblem(ok, BSP_CREDIT_CURRENCIES)).toBeNull();
    const msg = currencyProblem('THB', BSP_CREDIT_CURRENCIES);
    expect(msg).toContain('AUD, EUR, GBP, IDR, INR, USD');
    expect(msg).toContain('cannot be changed');
  });

  it('an explicit choice wins even when Meta would refuse it (the failure is then recorded)', () => {
    expect(pickAttachCurrency('thb', ['INR'])).toBe('THB');
  });

  it('otherwise the first candidate Meta accepts wins, skipping an unusable one', () => {
    expect(pickAttachCurrency(null, ['THB', 'inr', 'USD'])).toBe('INR');
    expect(pickAttachCurrency(null, [null, '', 'EUR'])).toBe('EUR');
  });

  it('with nothing usable it falls back to the first candidate, then to USD', () => {
    expect(pickAttachCurrency(null, ['THB'])).toBe('THB');
    expect(pickAttachCurrency(null, [])).toBe('USD');
  });
});

describe('settings validation (TW-BSP-004)', () => {
  const base = { businessId: '123', extendedCreditId: '', ratesEndpoint: '', autoAttach: false };

  it('blank graph version means the default; a malformed one is refused on the server', () => {
    expect(normalizeGraphVersion('')).toBe('v26.0');
    expect(normalizeGraphVersion('v25.0')).toBe('v25.0');
    expect(normalizeGraphVersion('25')).toBeNull();
    const r = updateBspSettingsSchema.safeParse({ ...base, graphVersion: 'latest' });
    expect(r.success).toBe(false);
  });

  it('refuses a rates endpoint that is not a URL, and one that is not https', () => {
    expect(updateBspSettingsSchema.safeParse({ ...base, ratesEndpoint: 'not a url' }).success).toBe(false);
    expect(updateBspSettingsSchema.safeParse({ ...base, ratesEndpoint: 'http://x.test/r' }).success).toBe(false);
    expect(updateBspSettingsSchema.safeParse({ ...base, ratesEndpoint: 'https://x.test/r' }).success).toBe(true);
  });

  it('an auto-attach currency Meta refuses is rejected up front; "usd1" is accepted', () => {
    expect(updateBspSettingsSchema.safeParse({ ...base, autoAttachCurrency: 'THB' }).success).toBe(false);
    expect(updateBspSettingsSchema.safeParse({ ...base, autoAttachCurrency: 'usd1' }).success).toBe(true);
  });

  it('sending a token and clearing it in one request is contradictory', () => {
    expect(updateBspSettingsSchema.safeParse({ ...base, systemUserToken: 'abc', clearToken: true }).success).toBe(false);
  });
});

describe('the P&L window and decimal money (TW-BSP-014)', () => {
  it('the default is the month containing now, as a half-open UTC interval', () => {
    const w = monthWindow(undefined, new Date('2026-10-17T12:00:00Z'));
    expect(w.month).toBe('2026-10');
    expect(w.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('December rolls into the next year', () => {
    expect(monthWindow('2026-12', new Date()).to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('subtracts decimal strings without floats: revenue 100.00 - cost 72.00 = 28.00', () => {
    expect(subtractDecimal('100.00', '72.00')).toBe('28.00');
    expect(subtractDecimal('0.10', '0.30')).toBe('-0.20');
    expect(subtractDecimal('5', '5')).toBe('0');
    expect(subtractDecimal('90071992547409.93', '0.01')).toBe('90071992547409.92');
  });

  it('shows the tail of a WABA id as the register does', () => {
    expect(wabaTail('1234567890', 6)).toBe('...567890');
  });
});
