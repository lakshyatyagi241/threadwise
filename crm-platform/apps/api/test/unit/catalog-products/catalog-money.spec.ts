import { describe, expect, it } from 'vitest';
import {
  currencyDecimals,
  majorStringToMinor,
  metaCatalogPrice,
  minorToMajorString,
  parseMetaPriceMinor,
} from '../../../src/modules/catalog-products/catalog-money';

describe("metaCatalogPrice: our price_minor (always major x 100) to Meta's own minor unit (WD-CAT-026)", () => {
  it('a 2-decimal currency is sent as stored', () => {
    expect(metaCatalogPrice(129900, 'INR')).toBe(129900);
    expect(metaCatalogPrice(129900, 'usd')).toBe(129900);
  });
  it('a zero-decimal currency drops our x100: IDR 395,000 is 395000 on Meta, not 39,500,000', () => {
    expect(metaCatalogPrice(39_500_000, 'IDR')).toBe(395_000);
    expect(metaCatalogPrice(150_000, 'JPY')).toBe(1500);
    expect(metaCatalogPrice(99, 'VND')).toBe(0);
  });
  it('a three-decimal currency is x10: KWD 12.500 is 12500', () => {
    expect(metaCatalogPrice(1250, 'KWD')).toBe(12_500);
    expect(metaCatalogPrice(100, 'bhd')).toBe(1000);
  });
  it('a missing currency is treated as INR (two decimals)', () => {
    expect(metaCatalogPrice(500, null)).toBe(500);
    expect(metaCatalogPrice(500, '')).toBe(500);
  });
  it('knows every zero- and three-decimal currency of the WaDesk lists', () => {
    for (const c of [
      'BIF',
      'CLP',
      'DJF',
      'GNF',
      'IDR',
      'ISK',
      'JPY',
      'KMF',
      'KRW',
      'MGA',
      'PYG',
      'RWF',
      'UGX',
      'VND',
      'VUV',
      'XAF',
      'XOF',
      'XPF',
      'HUF',
      'TWD',
    ]) {
      expect(currencyDecimals(c)).toBe(0);
    }
    for (const c of ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']) {
      expect(currencyDecimals(c)).toBe(3);
    }
    expect(currencyDecimals('EUR')).toBe(2);
  });
});

describe("parseMetaPriceMinor: Meta's catalog price back to price_minor (WD-CAT-011 rule 3)", () => {
  it('Rp33.900.000 in IDR is whole rupiah with dot groupers: price_minor 3390000000', () => {
    expect(parseMetaPriceMinor('Rp33.900.000', 'IDR')).toBe(3_390_000_000);
  });
  it('1,234.56 in USD is 123456 (comma groups, dot decimal)', () => {
    expect(parseMetaPriceMinor('1,234.56', 'USD')).toBe(123_456);
  });
  it('1.234,56 reads the same: the rightmost separator is the decimal point', () => {
    expect(parseMetaPriceMinor('1.234,56', 'EUR')).toBe(123_456);
  });
  it('a symbol and a code around the number are ignored', () => {
    expect(parseMetaPriceMinor('$12.50 USD', 'USD')).toBe(1250);
    expect(parseMetaPriceMinor('₹ 1,299', 'INR')).toBe(129_900);
  });
  it('a lone separator is a decimal point only with exactly `decimals` digits after it', () => {
    expect(parseMetaPriceMinor('12.5', 'USD')).toBe(12_500); // one digit after the dot: a grouper, as WaDesk
    expect(parseMetaPriceMinor('1.234', 'USD')).toBe(123_400); // three digits: a grouper
    expect(parseMetaPriceMinor('12.50', 'USD')).toBe(1250);
    expect(parseMetaPriceMinor('12,50', 'USD')).toBe(1250);
    expect(parseMetaPriceMinor('1.234', 'KWD')).toBe(123); // three-decimal: it IS the decimal point, 1.234 x 100 rounded
  });
  it('a repeated lone separator is always a grouper', () => {
    expect(parseMetaPriceMinor('1.234.567', 'USD')).toBe(123_456_700);
  });
  it("a bare integer is already in the currency's own minor unit (the inverse of the push)", () => {
    expect(parseMetaPriceMinor(129_900, 'INR')).toBe(129_900);
    expect(parseMetaPriceMinor(395_000, 'IDR')).toBe(39_500_000);
    expect(parseMetaPriceMinor(12_500, 'KWD')).toBe(1250);
  });
  it('null, empty and digit-less values give no price', () => {
    expect(parseMetaPriceMinor(null, 'USD')).toBeNull();
    expect(parseMetaPriceMinor('', 'USD')).toBeNull();
    expect(parseMetaPriceMinor('free', 'USD')).toBeNull();
    expect(parseMetaPriceMinor(undefined, 'USD')).toBeNull();
  });
  it('round trip: pushing then reading back returns the stored price for every decimals class', () => {
    for (const [minor, cur] of [
      [129_900, 'INR'],
      [39_500_000, 'IDR'],
      [1250, 'KWD'],
    ] as const) {
      expect(parseMetaPriceMinor(metaCatalogPrice(minor, cur), cur)).toBe(minor);
    }
  });
  it('rounds half up on the third decimal exactly, without float drift', () => {
    expect(parseMetaPriceMinor('1,234.565', 'USD')).toBe(123_457);
    expect(parseMetaPriceMinor('1,234.564', 'USD')).toBe(123_456);
    expect(parseMetaPriceMinor('0.995,0', 'USD')).toBe(99_500);
  });
});

describe('major strings and minor integers (WD-CAT-020)', () => {
  it('a typed major amount is stored x100, rounded half up on the third decimal', () => {
    expect(majorStringToMinor('1299')).toBe(129_900);
    expect(majorStringToMinor('1299.5')).toBe(129_950);
    expect(majorStringToMinor('1299.50')).toBe(129_950);
    expect(majorStringToMinor('0.005')).toBe(1);
    expect(majorStringToMinor('0.004')).toBe(0);
    expect(majorStringToMinor('19.999')).toBe(2000);
  });
  it('shows the stored price back as the plain decimal the form had', () => {
    expect(minorToMajorString(129_900)).toBe('1299');
    expect(minorToMajorString(129_950)).toBe('1299.5');
    expect(minorToMajorString(129_905)).toBe('1299.05');
    expect(minorToMajorString(0)).toBe('0');
    expect(minorToMajorString(5)).toBe('0.05');
  });
});
