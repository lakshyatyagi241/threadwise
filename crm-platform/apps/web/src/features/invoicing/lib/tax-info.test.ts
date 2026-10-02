import { describe, expect, it } from 'vitest';
import {
  checkBuyerTaxId,
  hsnRequired,
  lineTaxOfRate,
  placeOfSupplyOf,
  previewAutoTax,
  regionOptions,
  slabPercentOf,
  splitPlace,
} from './tax-info';

const seller = { sellerCountry: 'IN', sellerState: 'MH', sellerTaxId: '27AAPFU0939F1ZV', date: '2026-10-02' };

describe('HSN/SAC by country', () => {
  it('India asks for it on each line; most countries do not', () => {
    expect(hsnRequired('IN')).toBe(true);
    expect(hsnRequired('in')).toBe(true);
    for (const c of ['GB', 'DE', 'US', 'AE', 'AU', null, '', 'ZZ']) expect(hsnRequired(c), String(c)).toBe(false);
  });
});

describe('checking a buyer tax id', () => {
  it('a GSTIN is checked down to its check character', () => {
    const ok = checkBuyerTaxId('IN', null, '27AAPFU0939F1ZV');
    expect(ok).toMatchObject({ state: 'valid', level: 'checksum', label: 'GSTIN' });
    const bad = checkBuyerTaxId('IN', null, '27AAPFU0939F1ZX');
    expect(bad.state).toBe('invalid');
    expect(bad.level).toBe('checksum');
    expect(bad.reason).toBeTruthy();
  });
  it('an EU VAT number is checked by the buyer country', () => {
    expect(checkBuyerTaxId('DE', null, 'DE136695976').state).toBe('valid');
    expect(checkBuyerTaxId('DE', null, 'DE12').state).toBe('invalid');
  });
  it('the seller country stands in when the buyer has none', () => {
    expect(checkBuyerTaxId(null, 'GB', 'GB333289454').state).toBe('valid');
  });
  it('empty input says what is expected; an unknown country is only unchecked', () => {
    expect(checkBuyerTaxId('IN', null, '  ')).toMatchObject({ state: 'empty', label: 'GSTIN', example: expect.any(String) });
    expect(checkBuyerTaxId('ZZ', null, 'ABC123').state).toBe('unchecked');
  });
});

describe('place of supply', () => {
  it('builds and splits ISO 3166-2', () => {
    expect(placeOfSupplyOf('in', 'mh')).toBe('IN-MH');
    expect(placeOfSupplyOf('IN', '')).toBeNull();
    expect(placeOfSupplyOf('', 'MH')).toBeNull();
    expect(splitPlace('IN-MH')).toEqual({ country: 'IN', region: 'MH' });
    expect(splitPlace('de')).toEqual({ country: 'DE', region: '' });
    expect(splitPlace(null)).toEqual({ country: '', region: '' });
  });
  it('lists the states and provinces the engine knows', () => {
    const india = regionOptions('IN');
    expect(india.find((r) => r.code === 'MH')?.name).toBe('Maharashtra');
    expect(india.find((r) => r.code === 'UT')?.name).toBe('Uttarakhand');
    expect(regionOptions('US').find((r) => r.code === 'CA')).toBeTruthy();
    expect(regionOptions('CA').find((r) => r.code === 'ON')).toBeTruthy();
    expect(regionOptions('DE')).toEqual([]);
    expect(new Set(india.map((r) => r.code)).size).toBe(india.length);
  });
});

describe('the live "Why this tax?"', () => {
  it('splits an Indian sale inside the state into CGST and SGST, across states into IGST', () => {
    const intra = previewAutoTax(
      { ...seller, buyerCountry: 'IN', buyerTaxId: null, placeOfSupply: 'IN-MH', supplyType: 'goods' },
      [{ hsnSac: null, ratePercent: null }],
    );
    expect(intra.ok).toBe(true);
    if (!intra.ok) return;
    expect(intra.preview.lines[0]?.items.map((i) => i.code)).toEqual(['CGST', 'SGST']);
    expect(intra.preview.reasons.length).toBeGreaterThan(0);
    const inter = previewAutoTax(
      { ...seller, buyerCountry: 'IN', buyerTaxId: null, placeOfSupply: 'IN-KA', supplyType: 'goods' },
      [{ hsnSac: null, ratePercent: null }],
    );
    expect(inter.ok && inter.preview.lines[0]?.items.map((i) => i.code)).toEqual(['IGST']);
  });
  it('an intra-EU service to a registered business is a reverse charge', () => {
    const r = previewAutoTax(
      { sellerCountry: 'DE', sellerState: null, sellerTaxId: 'DE136695976', buyerCountry: 'FR', buyerTaxId: 'FR40303265045', placeOfSupply: null, supplyType: 'services', date: '2026-10-02' },
      [{ hsnSac: null, ratePercent: null }],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.reverseCharge).toBe(true);
    expect(r.preview.taxFree).toBe(true);
    expect(r.preview.documentNotes.join(' ')).toMatch(/reverse charge/i);
  });
  it('says each reason once, however many lines there are', () => {
    const r = previewAutoTax(
      { ...seller, buyerCountry: 'IN', buyerTaxId: null, placeOfSupply: 'IN-MH', supplyType: 'goods' },
      [{ hsnSac: null, ratePercent: null }, { hsnSac: null, ratePercent: null }],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.lines).toHaveLength(2);
    expect(new Set(r.preview.reasons).size).toBe(r.preview.reasons.length);
  });
  it('needs the seller country, and one the engine knows', () => {
    const line = [{ hsnSac: null, ratePercent: null }];
    const base = { ...seller, buyerCountry: null, buyerTaxId: null, placeOfSupply: null, supplyType: 'goods' as const };
    expect(previewAutoTax({ ...base, sellerCountry: null }, line)).toEqual({ ok: false, reason: 'noCountry' });
    expect(previewAutoTax({ ...base, sellerCountry: 'QQ' }, line)).toEqual({ ok: false, reason: 'noProfile' });
  });
});

describe('tax rates as line taxes', () => {
  const base = { name: 'GST 18%', rate: '18', inclusive: false };
  it('a plain rate is one item named after it', () => {
    expect(lineTaxOfRate({ ...base, components: null })).toEqual({
      name: 'GST 18%',
      inclusive: false,
      items: [{ code: 'GST 18%', name: 'GST 18%', rate: '18' }],
    });
  });
  it('a compound rate is its parts', () => {
    const t = lineTaxOfRate({ ...base, components: [{ type: 'CGST', rate: '9' }, { type: 'SGST', rate: '9' }] });
    expect(t.items.map((i) => [i.code, i.name, i.rate])).toEqual([
      ['CGST', 'CGST 9%', '9'],
      ['SGST', 'SGST 9%', '9'],
    ]);
  });
  it('only a single-tax rate can act as a slab for the engine', () => {
    expect(slabPercentOf({ rate: '5', components: null })).toBe('5');
    expect(slabPercentOf({ rate: '18', components: [{ type: 'CGST', rate: '9' }, { type: 'SGST', rate: '9' }] })).toBeNull();
    expect(slabPercentOf(null)).toBeNull();
  });
});
