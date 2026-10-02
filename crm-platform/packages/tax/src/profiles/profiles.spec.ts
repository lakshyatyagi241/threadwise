import { describe, expect, it } from 'vitest';
import {
  formatInvoiceNumber,
  nextInvoiceNumber,
  sequenceScope,
  validateInvoiceNumber,
} from '../fiscal/invoice-number';
import { fiscalYearOf } from '../fiscal/fiscal-year';
import { calculateDocument } from '../totals/calculate';
import { checkInvoiceCompliance, applicableChecklist } from './compliance';
import { taxPresetsForCountry } from './presets';
import { getTaxProfile, TAX_PROFILES } from './registry';
import { resolveTaxForLine, type ResolveTaxInput } from './resolve';
import { INDIA_STATES, indiaState } from './countries/india';
import { isIsoDate, rateInForce } from './utils';

const D = '2026-10-02';
const resolve = (i: ResolveTaxInput) => resolveTaxForLine({ date: D, ...i });
const names = (r: ReturnType<typeof resolve>) => r.taxes.map((t) => t.name);

describe('India GST', () => {
  const MH = { region: 'MH', taxId: '27AAPFU0939F1ZV' };
  it('intra-state: CGST + SGST at half the rate each', () => {
    const r = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: '27', type: 'business' },
      product: { ratePercent: 18 },
      supplyType: 'services',
    });
    expect(names(r)).toEqual(['CGST 9%', 'SGST 9%']);
    expect(r.placeOfSupply).toEqual({ country: 'IN', region: '27' });
    expect(r.reasons.join(' ')).toMatch(/intra-state/);
    expect(r.documentNotes).toContain('Tax payable on reverse charge basis: No');
  });
  it('inter-state: IGST at the full rate', () => {
    const r = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'Karnataka', type: 'business' },
      product: { ratePercent: '18' },
      supplyType: 'goods',
    });
    expect(names(r)).toEqual(['IGST 18%']);
    expect(r.reasons.join(' ')).toMatch(/inter-state/);
  });
  it('union territory without a legislature charges UTGST', () => {
    const r = resolve({
      sellerProfile: 'IN',
      seller: { region: 'CH' },
      buyer: { country: 'IN', region: '04' },
      product: { ratePercent: 18 },
      supplyType: 'goods',
    });
    expect(names(r)).toEqual(['CGST 9%', 'UTGST 9%']);
    const dl = resolve({
      sellerProfile: 'IN',
      seller: { region: 'DL' },
      buyer: { country: 'IN', region: '07' },
      product: { ratePercent: 18 },
      supplyType: 'goods',
    });
    expect(names(dl)).toEqual(['CGST 9%', 'SGST 9%']);
  });
  it('odd slabs split into exact halves (0.25% -> 0.125%, 3% -> 1.5%)', () => {
    const r = resolve({
      sellerProfile: 'IN',
      seller: { region: 'MH' },
      buyer: { country: 'IN', region: 'MH' },
      product: { ratePercent: 3 },
    });
    expect(names(r)).toEqual(['CGST 1.5%', 'SGST 1.5%']);
    const r2 = resolve({
      sellerProfile: 'IN',
      seller: { region: 'MH' },
      buyer: { country: 'IN', region: 'MH' },
      product: { ratePercent: '0.25' },
    });
    expect(names(r2)).toEqual(['CGST 0.125%', 'SGST 0.125%']);
  });
  it('services to a registered business use the buyer GSTIN state as the place of supply', () => {
    const r = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', type: 'business', taxId: '29AABCT1332L1ZA' },
      product: { ratePercent: 18 },
      supplyType: 'services',
    });
    expect(names(r)).toEqual(['IGST 18%']);
    expect(r.placeOfSupply?.region).toBe('29');
  });
  it('goods follow the ship-to state even when the buyer GSTIN is elsewhere', () => {
    const r = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', type: 'business', region: 'MH', taxId: '29AABCT1332L1ZA' },
      product: { ratePercent: 18 },
      supplyType: 'goods',
    });
    expect(names(r)).toEqual(['CGST 9%', 'SGST 9%']);
  });
  it('export is zero-rated under LUT; SEZ is IGST', () => {
    const ex = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'US' },
      product: { ratePercent: 18 },
      supplyType: 'services',
    });
    expect(ex.taxes).toEqual([
      { code: 'IGST', name: 'IGST 0% (export)', rate: '0', category: 'zero' },
    ]);
    expect(ex.taxFree).toBe(true);
    expect(ex.documentNotes.join(' ')).toMatch(/LUT/);
    const sez = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'MH', isSez: true },
      product: { ratePercent: 18 },
    });
    expect(names(sez)).toEqual(['IGST 18%']);
  });
  it('composition scheme and unregistered sellers charge no tax and issue a bill of supply', () => {
    const c = resolve({
      sellerProfile: 'IN',
      seller: { ...MH, scheme: 'composition' },
      buyer: { country: 'IN', region: 'MH' },
    });
    expect(c.taxes).toEqual([]);
    expect(c.documentTypeHint).toBe('bill_of_supply');
    expect(c.documentNotes.join(' ')).toMatch(/Composition taxable person/);
    const u = resolve({
      sellerProfile: 'IN',
      seller: { registered: false },
      buyer: { country: 'IN' },
    });
    expect(u.taxes).toEqual([]);
    expect(u.documentTypeHint).toBe('bill_of_supply');
  });
  it('reverse charge flag and exempt supplies', () => {
    const rc = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'MH' },
      product: { ratePercent: 5, reverseCharge: true },
      supplyType: 'services',
    });
    expect(rc.reverseCharge).toBe(true);
    expect(rc.documentNotes).toContain('Tax payable on reverse charge basis: Yes');
    const ex = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'MH' },
      product: { category: 'exempt' },
    });
    expect(ex.documentTypeHint).toBe('bill_of_supply');
    expect(ex.taxes[0]).toMatchObject({ category: 'exempt' });
  });
  it('rates are effective-dated: the 12% slab existed until 21 Sep 2025', () => {
    const before = resolve({
      date: '2025-06-01',
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'KA' },
      product: { ratePercent: 12 },
    });
    expect(before.warnings.some((w) => /not a standard GST slab/.test(w))).toBe(false);
    const after = resolve({
      date: '2025-09-22',
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'KA' },
      product: { ratePercent: 12 },
    });
    expect(after.warnings.some((w) => /not a standard GST slab/.test(w))).toBe(true);
    const std = resolve({
      date: '2025-06-01',
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'KA' },
      product: { category: 'standard' },
    });
    expect(names(std)).toEqual(['IGST 18%']);
    const lux = resolve({
      date: '2026-01-01',
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'KA' },
      product: { category: 'special' },
    });
    expect(names(lux)).toEqual(['IGST 40%']);
  });
  it('warns when the product has no rate and when the buyer state is missing', () => {
    const r = resolve({ sellerProfile: 'IN', seller: MH, buyer: { country: 'IN' } });
    expect(r.warnings.join(' ')).toMatch(/No GST rate set on the product/);
    expect(r.warnings.join(' ')).toMatch(/buyer state is missing/);
  });
  it('TDS and TCS are optional, effective-dated withholding', () => {
    const r = resolve({
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'MH' },
      product: { ratePercent: 18 },
      supplyType: 'services',
      withholdingCodes: ['TDS_194J_10'],
    });
    expect(r.taxes.at(-1)).toMatchObject({
      code: 'TDS_194J_10',
      category: 'withholding',
      rate: '10',
    });
    const old = resolve({
      date: '2025-01-01',
      sellerProfile: 'IN',
      seller: MH,
      buyer: { country: 'IN', region: 'MH' },
      product: { ratePercent: 18 },
      withholdingCodes: ['TDS_194H_2', 'TDS_194H_5'],
    });
    expect(old.taxes.filter((t) => t.category === 'withholding').map((t) => t.code)).toEqual([
      'TDS_194H_5',
    ]);
    expect(old.warnings.join(' ')).toMatch(/TDS_194H_2/);
  });
  it('flags an invalid buyer or seller GSTIN', () => {
    const r = resolve({
      sellerProfile: 'IN',
      seller: { region: 'MH', taxId: '27AAPFU0939F1ZX' },
      buyer: { country: 'IN', region: 'MH', type: 'business', taxId: '27AAPFU0939F1ZX' },
      product: { ratePercent: 18 },
    });
    expect(r.warnings.filter((w) => /GSTIN/.test(w))).toHaveLength(2);
  });
  it('accepts state code, abbreviation or name', () => {
    expect(indiaState('27')?.name).toBe('Maharashtra');
    expect(indiaState('mh')?.code).toBe('27');
    expect(indiaState('tamil nadu')?.code).toBe('33');
    expect(indiaState('99')).toBeUndefined();
    expect(new Set(INDIA_STATES.map((s) => s.code)).size).toBe(INDIA_STATES.length);
  });
});

describe('Gulf', () => {
  const trn = '100123456789003';
  it('UAE: 5% domestic, zero-rated export, no tax when not registered', () => {
    const dom = resolve({
      sellerProfile: 'AE',
      seller: { taxId: trn },
      buyer: { country: 'AE', type: 'consumer' },
    });
    expect(dom.taxes).toEqual([
      { code: 'VAT_STD', name: 'VAT 5%', rate: '5', category: 'standard' },
    ]);
    const exp = resolve({
      sellerProfile: 'AE',
      seller: { taxId: trn },
      buyer: { country: 'GB' },
      supplyType: 'goods',
    });
    expect(exp.taxes[0]).toMatchObject({ rate: '0', category: 'zero' });
    expect(exp.taxFree).toBe(true);
    const un = resolve({
      sellerProfile: 'AE',
      seller: { registered: false },
      buyer: { country: 'AE' },
    });
    expect(un.taxes).toEqual([]);
    const z = resolve({
      sellerProfile: 'AE',
      seller: { taxId: trn },
      buyer: { country: 'AE' },
      product: { category: 'zero' },
    });
    expect(z.taxes[0]).toMatchObject({ category: 'zero' });
  });
  it('Saudi Arabia: 5% until 30 Jun 2020, 15% after', () => {
    const at = (date: string) =>
      resolve({
        date,
        sellerProfile: 'SA',
        seller: { taxId: '300000000000003' },
        buyer: { country: 'SA' },
      }).taxes[0]!.rate;
    expect(at('2020-06-30')).toBe('5');
    expect(at('2020-07-01')).toBe('15');
    expect(at(D)).toBe('15');
  });
  it('Bahrain 10% (3-decimal BHD) and Oman 5%', () => {
    expect(resolve({ sellerProfile: 'BH', buyer: { country: 'BH' } }).taxes[0]!.rate).toBe('10');
    expect(
      resolve({ date: '2021-06-01', sellerProfile: 'BH', buyer: { country: 'BH' } }).taxes[0]!.rate,
    ).toBe('5');
    expect(resolve({ sellerProfile: 'OM', buyer: { country: 'OM' } }).taxes[0]!.rate).toBe('5');
    expect(getTaxProfile('BH')!.currency).toBe('BHD');
  });
  it('Qatar and Kuwait are note-only: no tax added', () => {
    for (const c of ['QA', 'KW']) {
      const r = resolve({ sellerProfile: c, buyer: { country: c } });
      expect(r.taxes).toEqual([]);
      expect(r.reasons[0]).toMatch(/no general VAT/);
      expect(getTaxProfile(c)!.support).toBe('note_only');
    }
  });
});

describe('United Kingdom', () => {
  const S = { taxId: 'GB333289454' };
  it('20 / 5 / 0 by category, with the 17.5% history', () => {
    expect(
      resolve({ sellerProfile: 'GB', seller: S, buyer: { country: 'GB' } }).taxes[0],
    ).toMatchObject({ rate: '20' });
    expect(
      resolve({
        sellerProfile: 'GB',
        seller: S,
        buyer: { country: 'GB' },
        product: { category: 'reduced' },
      }).taxes[0],
    ).toMatchObject({ rate: '5' });
    expect(
      resolve({
        sellerProfile: 'GB',
        seller: S,
        buyer: { country: 'GB' },
        product: { category: 'zero' },
      }).taxes[0],
    ).toMatchObject({ rate: '0', category: 'zero' });
    expect(
      resolve({ date: '2010-06-01', sellerProfile: 'GB', seller: S, buyer: { country: 'GB' } })
        .taxes[0],
    ).toMatchObject({ rate: '17.5' });
  });
  it('export of goods is zero-rated; B2B services abroad are outside the scope with reverse-charge wording', () => {
    const g = resolve({
      sellerProfile: 'GB',
      seller: S,
      buyer: { country: 'US' },
      supplyType: 'goods',
    });
    expect(g.taxes[0]).toMatchObject({ rate: '0', category: 'zero' });
    const sv = resolve({
      sellerProfile: 'GB',
      seller: S,
      buyer: { country: 'DE', type: 'business', taxId: 'DE136695976' },
      supplyType: 'services',
    });
    expect(sv.taxes[0]).toMatchObject({ rate: '0', category: 'out_of_scope' });
    expect(sv.reverseCharge).toBe(true);
    expect(sv.documentNotes.join(' ')).toMatch(/reverse charge/i);
    const b2c = resolve({
      sellerProfile: 'GB',
      seller: S,
      buyer: { country: 'DE', type: 'consumer' },
      supplyType: 'services',
    });
    expect(b2c.taxes[0]).toMatchObject({ rate: '20' });
    expect(b2c.warnings.join(' ')).toMatch(/B2C services/);
  });
  it('domestic reverse charge for business customers (construction)', () => {
    const r = resolve({
      sellerProfile: 'GB',
      seller: S,
      buyer: { country: 'GB', type: 'business', taxId: 'GB980780684' },
      product: { reverseCharge: true },
      supplyType: 'services',
    });
    expect(r.taxes[0]).toMatchObject({ category: 'reverse_charge', rate: '0' });
    expect(r.documentNotes[0]).toMatch(/Reverse charge: Customer to pay the VAT to HMRC/);
  });
  it('flat rate scheme still charges standard VAT but warns', () => {
    const r = resolve({
      sellerProfile: 'GB',
      seller: { ...S, scheme: 'flat_rate' },
      buyer: { country: 'GB' },
    });
    expect(r.taxes[0]).toMatchObject({ rate: '20' });
    expect(r.warnings.join(' ')).toMatch(/Flat Rate Scheme/);
  });
  it('CIS withholding and an invalid buyer VAT number', () => {
    const r = resolve({
      sellerProfile: 'GB',
      seller: S,
      buyer: { country: 'GB', type: 'business', taxId: 'GB333289455' },
      withholdingCodes: ['CIS_20'],
    });
    expect(r.taxes.at(-1)).toMatchObject({ code: 'CIS_20', category: 'withholding' });
    expect(r.warnings.filter((w) => /buyer/.test(w))).toHaveLength(1);
  });
});

describe('EU VAT', () => {
  const DE = { taxId: 'DE136695976' };
  it('domestic rates per member state, by category', () => {
    expect(
      resolve({ sellerProfile: 'DE', seller: DE, buyer: { country: 'DE' } }).taxes[0],
    ).toMatchObject({ rate: '19' });
    expect(
      resolve({
        sellerProfile: 'DE',
        seller: DE,
        buyer: { country: 'DE' },
        product: { category: 'reduced' },
      }).taxes[0],
    ).toMatchObject({ rate: '7' });
    expect(
      resolve({
        sellerProfile: 'FR',
        seller: { taxId: 'FR40303265045' },
        buyer: { country: 'FR' },
        product: { category: 'super_reduced' },
      }).taxes[0],
    ).toMatchObject({ rate: '2.1' });
    expect(resolve({ sellerProfile: 'HU', buyer: { country: 'HU' } }).taxes[0]).toMatchObject({
      rate: '27',
    });
    expect(resolve({ sellerProfile: 'LU', buyer: { country: 'LU' } }).taxes[0]).toMatchObject({
      rate: '17',
    });
    expect(resolve({ sellerProfile: 'DK', buyer: { country: 'DK' } }).taxes[0]).toMatchObject({
      rate: '25',
    });
  });
  it('rate changes are effective-dated (EE 22 -> 24, FI 24 -> 25.5, SK 20 -> 23, RO 19 -> 21)', () => {
    const std = (c: string, date: string) =>
      resolve({ date, sellerProfile: c, buyer: { country: c } }).taxes[0]!.rate;
    expect(std('EE', '2025-06-30')).toBe('22');
    expect(std('EE', '2025-07-01')).toBe('24');
    expect(std('FI', '2024-08-31')).toBe('24');
    expect(std('FI', '2024-09-01')).toBe('25.5');
    expect(std('SK', '2024-12-31')).toBe('20');
    expect(std('SK', '2025-01-01')).toBe('23');
    expect(std('RO', '2025-07-31')).toBe('19');
    expect(std('RO', '2025-08-01')).toBe('21');
  });
  it('intra-EU B2B with a valid VAT id: zero-rated reverse charge', () => {
    const goods = resolve({
      sellerProfile: 'DE',
      seller: DE,
      buyer: { country: 'FR', type: 'business', taxId: 'FR40303265045' },
      supplyType: 'goods',
    });
    expect(goods.taxes[0]).toMatchObject({ rate: '0', category: 'reverse_charge' });
    expect(goods.reverseCharge).toBe(true);
    expect(goods.documentNotes[0]).toMatch(/Article 138/);
    const svc = resolve({
      sellerProfile: 'DE',
      seller: DE,
      buyer: { country: 'IT', type: 'business', taxId: 'IT00743110157' },
      supplyType: 'services',
    });
    expect(svc.documentNotes[0]).toMatch(/196/);
  });
  it('intra-EU B2B with an invalid id is treated as a consumer', () => {
    const r = resolve({
      sellerProfile: 'DE',
      seller: DE,
      buyer: { country: 'FR', type: 'business', taxId: 'FR41303265045' },
      supplyType: 'goods',
    });
    expect(r.taxes[0]).toMatchObject({ rate: '19' });
    expect(r.warnings.join(' ')).toMatch(/not valid/);
    const none = resolve({
      sellerProfile: 'DE',
      seller: DE,
      buyer: { country: 'FR', type: 'business' },
      supplyType: 'goods',
    });
    expect(none.warnings.join(' ')).toMatch(/No buyer VAT number/);
  });
  it('B2C cross-border: seller rate below the threshold, destination rate under OSS', () => {
    const below = resolve({
      sellerProfile: 'DE',
      seller: DE,
      buyer: { country: 'FR', type: 'consumer' },
      supplyType: 'goods',
    });
    expect(below.taxes[0]).toMatchObject({ rate: '19' });
    expect(below.warnings.join(' ')).toMatch(/OSS/);
    const oss = resolve({
      sellerProfile: 'DE',
      seller: { ...DE, scheme: 'oss' },
      buyer: { country: 'FR', type: 'consumer' },
      supplyType: 'digital',
    });
    expect(oss.taxes[0]).toMatchObject({ rate: '20' });
    expect(oss.placeOfSupply).toEqual({ country: 'FR' });
    expect(oss.documentNotes.join(' ')).toMatch(/One Stop Shop/);
    const ossRed = resolve({
      sellerProfile: 'DE',
      seller: { ...DE, scheme: 'oss' },
      buyer: { country: 'ES', type: 'consumer' },
      product: { category: 'reduced' },
    });
    expect(ossRed.taxes[0]).toMatchObject({ rate: '10' });
  });
  it('outside the EU: export of goods exempt, B2B services not subject', () => {
    expect(
      resolve({ sellerProfile: 'DE', seller: DE, buyer: { country: 'US' }, supplyType: 'goods' })
        .taxes[0],
    ).toMatchObject({ rate: '0', category: 'zero' });
    const s = resolve({
      sellerProfile: 'DE',
      seller: DE,
      buyer: { country: 'US', type: 'business' },
      supplyType: 'services',
    });
    expect(s.taxes[0]).toMatchObject({ category: 'out_of_scope' });
    const c = resolve({
      sellerProfile: 'DE',
      seller: DE,
      buyer: { country: 'US', type: 'consumer' },
      supplyType: 'services',
    });
    expect(c.taxes[0]).toMatchObject({ rate: '19' });
  });
  it('Greece uses the EL prefix', () => {
    const r = resolve({
      sellerProfile: 'GR',
      seller: { taxId: 'EL123456789' },
      buyer: { country: 'GR' },
    });
    expect(r.taxes[0]).toMatchObject({ rate: '24' });
    expect(r.warnings).toEqual([]);
  });
  it('small-business exemption charges no VAT', () => {
    const r = resolve({
      sellerProfile: 'DE',
      seller: { scheme: 'small_supplier' },
      buyer: { country: 'DE' },
    });
    expect(r.taxes).toEqual([]);
  });
  it('all 27 member states are present with a standard rate', () => {
    const eu = TAX_PROFILES.filter(
      (p) =>
        p.name.endsWith('(VAT)') &&
        p.rates.some((r) => r.code === 'VAT_ZERO') &&
        p.sellerTaxId.spec?.id === 'vat_id' &&
        p.code !== 'GB',
    );
    expect(eu).toHaveLength(27);
    for (const p of eu)
      expect(p.rates.some((r) => r.code === 'VAT_STD' && !r.effectiveTo)).toBe(true);
  });
});

describe('United States sales tax', () => {
  const TX = { region: 'TX', taxId: '12-3456789' };
  it('same state: the state base rate, with a local-tax warning', () => {
    const r = resolve({
      sellerProfile: 'US',
      seller: TX,
      buyer: { country: 'US', region: 'TX' },
      supplyType: 'goods',
    });
    expect(r.taxes[0]).toMatchObject({ code: 'SALES_TAX', rate: '6.25' });
    expect(r.warnings.join(' ')).toMatch(/Counties/);
  });
  it('another state without nexus: nothing collected; with nexus: destination rate', () => {
    const none = resolve({
      sellerProfile: 'US',
      seller: TX,
      buyer: { country: 'US', region: 'CA' },
      supplyType: 'goods',
    });
    expect(none.taxes[0]).toMatchObject({ rate: '0' });
    expect(none.reasons.join(' ')).toMatch(/no nexus/);
    expect(none.warnings.join(' ')).toMatch(/Economic nexus/);
    const nx = resolve({
      sellerProfile: 'US',
      seller: { ...TX, registeredRegions: ['CA'] },
      buyer: { country: 'US', region: 'California' },
      supplyType: 'goods',
    });
    expect(nx.taxes[0]).toMatchObject({ rate: '7.25' });
  });
  it('manual override wins (combined local rate)', () => {
    const r = resolve({
      sellerProfile: 'US',
      seller: TX,
      buyer: { country: 'US', region: 'TX' },
      overrideRatePercent: '8.25',
    });
    expect(r.taxes[0]).toMatchObject({ rate: '8.25', name: 'Sales tax 8.25%' });
  });
  it('exempt customers, exempt products, services and exports are not taxed', () => {
    expect(
      resolve({
        sellerProfile: 'US',
        seller: TX,
        buyer: { country: 'US', region: 'TX', taxExempt: true },
      }).taxes[0],
    ).toMatchObject({ category: 'exempt' });
    expect(
      resolve({
        sellerProfile: 'US',
        seller: TX,
        buyer: { country: 'US', region: 'TX' },
        product: { category: 'exempt' },
      }).taxes[0],
    ).toMatchObject({ category: 'exempt' });
    const svc = resolve({
      sellerProfile: 'US',
      seller: TX,
      buyer: { country: 'US', region: 'TX' },
      supplyType: 'services',
    });
    expect(svc.taxFree).toBe(true);
    const taxableSvc = resolve({
      sellerProfile: 'US',
      seller: TX,
      buyer: { country: 'US', region: 'TX' },
      supplyType: 'services',
      product: { category: 'standard' },
    });
    expect(taxableSvc.taxes[0]).toMatchObject({ rate: '6.25' });
    expect(resolve({ sellerProfile: 'US', seller: TX, buyer: { country: 'CA' } }).taxFree).toBe(
      true,
    );
  });
  it('states without a sales tax, and Louisiana by date', () => {
    expect(
      resolve({
        sellerProfile: 'US',
        seller: { region: 'OR' },
        buyer: { country: 'US', region: 'OR' },
      }).taxFree,
    ).toBe(true);
    const la = (date: string) =>
      resolve({
        date,
        sellerProfile: 'US',
        seller: { region: 'LA' },
        buyer: { country: 'US', region: 'LA' },
      }).taxes[0]!.rate;
    expect(la('2024-12-31')).toBe('4.45');
    expect(la('2025-01-01')).toBe('5');
  });
  it('covers 50 states + DC', () => {
    expect(getTaxProfile('US')!.regions).toHaveLength(51);
  });
});

describe('Canada', () => {
  const S = { region: 'ON', taxId: '123456782RT0001' };
  const r = (buyerRegion: string, extra: Partial<ResolveTaxInput> = {}) =>
    resolve({
      sellerProfile: 'CA',
      seller: S,
      buyer: { country: 'CA', region: buyerRegion },
      ...extra,
    });
  it('HST provinces', () => {
    expect(names(r('ON'))).toEqual(['HST 13% (Ontario)']);
    expect(r('NB').taxes[0]).toMatchObject({ rate: '15' });
    expect(r('PE').taxes[0]).toMatchObject({ rate: '15' });
    expect(r('NL').taxes[0]).toMatchObject({ rate: '15' });
  });
  it('Nova Scotia HST dropped to 14% on 1 Apr 2025', () => {
    expect(r('NS', { date: '2025-03-31' }).taxes[0]).toMatchObject({ rate: '15' });
    expect(r('NS', { date: '2025-04-01' }).taxes[0]).toMatchObject({ rate: '14' });
  });
  it('GST only in AB and the territories', () => {
    for (const p of ['AB', 'NT', 'NU', 'YT']) expect(names(r(p))).toEqual(['GST 5%']);
  });
  it('PST/QST only when the seller is registered in that province', () => {
    const notReg = r('BC');
    expect(names(notReg)).toEqual(['GST 5%']);
    expect(notReg.warnings.join(' ')).toMatch(/not registered there/);
    const reg = resolve({
      sellerProfile: 'CA',
      seller: { ...S, registeredRegions: ['BC', 'QC'] },
      buyer: { country: 'CA', region: 'BC' },
    });
    expect(reg.taxes.map((t) => t.rate)).toEqual(['5', '7']);
    const qc = resolve({
      sellerProfile: 'CA',
      seller: { ...S, registeredRegions: ['QC'] },
      buyer: { country: 'CA', region: 'QC' },
    });
    expect(qc.taxes.map((t) => [t.code, t.rate])).toEqual([
      ['GST', '5'],
      ['QST', '9.975'],
    ]);
    expect(qc.taxes[1]!.compound).toBeUndefined(); // additive since 2013
  });
  it('exports and small suppliers', () => {
    expect(
      resolve({ sellerProfile: 'CA', seller: S, buyer: { country: 'US' } }).taxes[0],
    ).toMatchObject({ rate: '0', category: 'zero' });
    expect(
      resolve({
        sellerProfile: 'CA',
        seller: { ...S, scheme: 'small_supplier' },
        buyer: { country: 'CA', region: 'ON' },
      }).taxes,
    ).toEqual([]);
  });
});

describe('Asia-Pacific, Africa, Latin America', () => {
  it('Australia GST 10%, GST-free, export', () => {
    const S = { taxId: '51824753556' };
    expect(
      resolve({ sellerProfile: 'AU', seller: S, buyer: { country: 'AU' } }).taxes[0],
    ).toMatchObject({ rate: '10', name: 'GST 10%' });
    expect(
      resolve({
        sellerProfile: 'AU',
        seller: S,
        buyer: { country: 'AU' },
        product: { category: 'zero' },
      }).taxes[0],
    ).toMatchObject({ category: 'zero' });
    expect(
      resolve({ sellerProfile: 'AU', seller: S, buyer: { country: 'NZ' }, supplyType: 'goods' })
        .taxes[0],
    ).toMatchObject({ rate: '0' });
  });
  it('New Zealand GST 15%', () => {
    expect(
      resolve({ sellerProfile: 'NZ', seller: { taxId: '49-091-850' }, buyer: { country: 'NZ' } })
        .taxes[0],
    ).toMatchObject({ rate: '15' });
  });
  it('Singapore GST by year: 7 / 8 / 9', () => {
    const at = (date: string) =>
      resolve({ date, sellerProfile: 'SG', buyer: { country: 'SG' } }).taxes[0]!.rate;
    expect(at('2022-12-31')).toBe('7');
    expect(at('2023-06-01')).toBe('8');
    expect(at('2024-01-01')).toBe('9');
  });
  it('Malaysia: sales tax on goods, service tax on services (6% -> 8% on 1 Mar 2024)', () => {
    expect(
      resolve({ sellerProfile: 'MY', buyer: { country: 'MY' }, supplyType: 'goods' }).taxes[0],
    ).toMatchObject({ code: 'SST_SALES', rate: '10' });
    expect(
      resolve({
        sellerProfile: 'MY',
        buyer: { country: 'MY' },
        supplyType: 'goods',
        product: { category: 'reduced' },
      }).taxes[0],
    ).toMatchObject({ rate: '5' });
    expect(
      resolve({
        date: '2024-02-29',
        sellerProfile: 'MY',
        buyer: { country: 'MY' },
        supplyType: 'services',
      }).taxes[0],
    ).toMatchObject({ code: 'SST_SVC', rate: '6' });
    expect(
      resolve({
        date: '2024-03-01',
        sellerProfile: 'MY',
        buyer: { country: 'MY' },
        supplyType: 'services',
      }).taxes[0],
    ).toMatchObject({ code: 'SST_SVC', rate: '8' });
    expect(
      resolve({
        sellerProfile: 'MY',
        buyer: { country: 'MY' },
        supplyType: 'services',
        product: { category: 'reduced' },
      }).taxes[0],
    ).toMatchObject({ rate: '6' });
  });
  it('South Africa 15% (14% before 1 Apr 2018), Nigeria 7.5%, Kenya 16%', () => {
    expect(resolve({ sellerProfile: 'ZA', buyer: { country: 'ZA' } }).taxes[0]).toMatchObject({
      rate: '15',
    });
    expect(
      resolve({ date: '2018-03-31', sellerProfile: 'ZA', buyer: { country: 'ZA' } }).taxes[0],
    ).toMatchObject({ rate: '14' });
    expect(resolve({ sellerProfile: 'NG', buyer: { country: 'NG' } }).taxes[0]).toMatchObject({
      rate: '7.5',
    });
    expect(
      resolve({ date: '2020-01-31', sellerProfile: 'NG', buyer: { country: 'NG' } }).taxes[0],
    ).toMatchObject({ rate: '5' });
    expect(
      resolve({ sellerProfile: 'KE', seller: { taxId: 'P051234567Z' }, buyer: { country: 'KE' } })
        .taxes[0],
    ).toMatchObject({ rate: '16' });
  });
  it('Mexico IVA 16% with retentions; exports 0%', () => {
    const r = resolve({
      sellerProfile: 'MX',
      seller: { taxId: 'XAXX010101000' },
      buyer: { country: 'MX' },
      supplyType: 'services',
      withholdingCodes: ['RET_IVA_2_3', 'RET_ISR_10'],
    });
    expect(r.taxes.map((t) => [t.code, t.rate])).toEqual([
      ['IVA_STD', '16'],
      ['RET_IVA_2_3', '10.6667'],
      ['RET_ISR_10', '10'],
    ]);
    expect(
      resolve({ sellerProfile: 'MX', buyer: { country: 'US' }, supplyType: 'goods' }).taxes[0],
    ).toMatchObject({ rate: '0' });
  });
  it('Japan 10% / 8% reduced, with the 8% standard history', () => {
    expect(
      resolve({
        sellerProfile: 'JP',
        seller: { taxId: 'T1180301018771' },
        buyer: { country: 'JP' },
      }).taxes[0],
    ).toMatchObject({ rate: '10' });
    expect(
      resolve({ sellerProfile: 'JP', buyer: { country: 'JP' }, product: { category: 'reduced' } })
        .taxes[0],
    ).toMatchObject({ rate: '8' });
    expect(
      resolve({ date: '2019-09-30', sellerProfile: 'JP', buyer: { country: 'JP' } }).taxes[0],
    ).toMatchObject({ rate: '8' });
    expect(getTaxProfile('JP')!.rounding).toMatchObject({ level: 'on_total', dictatedByLaw: true });
  });
  it('Brazil is note-only, taking a manual rate; custom takes the rate from the product', () => {
    const br = resolve({ sellerProfile: 'BR', buyer: { country: 'BR' } });
    expect(br.taxes).toEqual([]);
    expect(br.warnings.join(' ')).toMatch(/NF-e/);
    expect(
      resolve({ sellerProfile: 'BR', buyer: { country: 'BR' }, overrideRatePercent: '17' })
        .taxes[0],
    ).toMatchObject({ rate: '17' });
    const cu = resolve({
      sellerProfile: 'CUSTOM',
      buyer: { country: 'XX' },
      product: { ratePercent: 12.5, taxName: 'Service levy' },
    });
    expect(cu.taxes[0]).toMatchObject({ name: 'Service levy 12.5%', rate: '12.5' });
    expect(resolve({ sellerProfile: 'CUSTOM', buyer: { country: 'XX' } }).taxes).toEqual([]);
  });
  it('an explicit malformed rate is rejected, and an unknown profile too', () => {
    expect(() =>
      resolve({ sellerProfile: 'AE', buyer: { country: 'AE' }, overrideRatePercent: 'abc' }),
    ).toThrow(RangeError);
    expect(() => resolve({ sellerProfile: 'XQ', buyer: { country: 'AE' } })).toThrow(
      /No tax profile/,
    );
    expect(() =>
      resolve({ sellerProfile: 'AE', buyer: { country: 'AE' }, date: '2026-13-40' }),
    ).toThrow(RangeError);
  });
  it('not-registered sellers charge no tax in every full-support profile', () => {
    for (const p of TAX_PROFILES.filter((x) => x.support === 'full')) {
      const r = resolve({
        sellerProfile: p.code,
        seller: { registered: false },
        buyer: { country: p.code },
      });
      expect(r.taxes, p.code).toEqual([]);
    }
  });
});

describe('profile data integrity', () => {
  it('every rate row has a valid percent, valid dates and no overlapping period for the same code and region', () => {
    for (const p of TAX_PROFILES) {
      for (const list of [p.rates, p.withholding ?? []]) {
        const seen = new Map<string, Array<[string, string]>>();
        for (const r of list) {
          expect(/^\d{1,3}(\.\d{1,4})?$/.test(r.ratePercent), `${p.code} ${r.code}`).toBe(true);
          expect(isIsoDate(r.effectiveFrom), `${p.code} ${r.code} from`).toBe(true);
          if (r.effectiveTo) {
            expect(isIsoDate(r.effectiveTo)).toBe(true);
            expect(r.effectiveTo >= r.effectiveFrom, `${p.code} ${r.code} range`).toBe(true);
          }
          const key = `${r.code}|${r.region ?? ''}`;
          const spans = seen.get(key) ?? [];
          const to = r.effectiveTo ?? '9999-12-31';
          for (const [a, b] of spans)
            expect(r.effectiveFrom > b || to < a, `${p.code} ${key} overlaps`).toBe(true);
          spans.push([r.effectiveFrom, to]);
          seen.set(key, spans);
        }
      }
    }
  });
  it('each profile has a unique code, sources, a checklist and a fiscal year', () => {
    expect(new Set(TAX_PROFILES.map((p) => p.code)).size).toBe(TAX_PROFILES.length);
    for (const p of TAX_PROFILES) {
      expect(p.notes.length, p.code).toBeGreaterThan(0);
      expect(p.checklist.length, p.code).toBeGreaterThan(0);
      expect(p.fiscalYear.startMonth >= 1 && p.fiscalYear.startMonth <= 12).toBe(true);
      expect(p.code === 'CUSTOM' || p.sources.length > 0, p.code).toBe(true);
    }
  });
  it('the profile list covers every requested market', () => {
    const want = [
      'IN',
      'AE',
      'SA',
      'BH',
      'OM',
      'QA',
      'KW',
      'GB',
      'US',
      'CA',
      'AU',
      'NZ',
      'SG',
      'MY',
      'ZA',
      'NG',
      'KE',
      'MX',
      'BR',
      'JP',
      'CUSTOM',
      'DE',
      'FR',
      'IT',
      'ES',
      'NL',
      'SE',
      'PL',
      'IE',
      'GR',
    ];
    for (const c of want) expect(getTaxProfile(c), c).toBeDefined();
    expect(TAX_PROFILES).toHaveLength(48); // 7 Gulf + GB + 27 EU + US + CA + AU NZ SG MY + ZA NG KE + MX BR + JP + CUSTOM
  });
});

describe('golden fixtures: resolve then total, per country', () => {
  const total = (
    profile: string,
    resolveIn: Omit<ResolveTaxInput, 'sellerProfile'>,
    lines: Array<{ unit: bigint; qty?: bigint }>,
    opts: { currency: string; incl?: boolean; level?: 'per_line' | 'on_total' },
  ) => {
    const taxes = resolve({ sellerProfile: profile, ...resolveIn }).taxes;
    return calculateDocument({
      currency: opts.currency,
      pricesIncludeTax: opts.incl ?? false,
      rounding: { level: opts.level ?? getTaxProfile(profile)!.rounding.level },
      lines: lines.map((l) => ({ unitPriceMinor: l.unit, qtyScaled: l.qty ?? 10000n, taxes })),
    });
  };
  it('India intra-state: two lines of INR 1,000 + 18% = 2,360, CGST 180 + SGST 180 in the footer', () => {
    const r = total(
      'IN',
      {
        seller: { region: 'MH', taxId: '27AAPFU0939F1ZV' },
        buyer: { country: 'IN', region: 'MH' },
        product: { ratePercent: 18 },
      },
      [{ unit: 100000n }, { unit: 100000n }],
      { currency: 'INR' },
    );
    expect(r.taxSummary.map((s) => [s.code, s.baseMinor, s.taxMinor])).toEqual([
      ['CGST', 200000n, 18000n],
      ['SGST', 200000n, 18000n],
    ]);
    expect(r.totalMinor).toBe(236000n);
  });
  it('India inter-state with TDS: IGST 18% on 1,00,000 and 10% TDS', () => {
    const taxes = resolve({
      sellerProfile: 'IN',
      seller: { region: 'MH' },
      buyer: { country: 'IN', region: 'KA' },
      product: { ratePercent: 18 },
      supplyType: 'services',
      withholdingCodes: ['TDS_194J_10'],
    }).taxes;
    const r = calculateDocument({ currency: 'INR', lines: [{ unitPriceMinor: 10000000n, taxes }] });
    expect(r.taxMinor).toBe(1800000n);
    expect(r.totalMinor).toBe(11800000n);
    expect(r.withholdingMinor).toBe(1000000n);
    expect(r.payableMinor).toBe(10800000n);
  });
  it('UK: GBP 99.99 net at 20% = 19.998 -> 20.00', () => {
    const r = total(
      'GB',
      { seller: { taxId: 'GB333289454' }, buyer: { country: 'GB' } },
      [{ unit: 9999n }],
      { currency: 'GBP' },
    );
    expect(r.taxMinor).toBe(2000n);
    expect(r.totalMinor).toBe(11999n);
  });
  it('Germany B2C retail, tax-inclusive: EUR 119.00 gross = 100.00 net + 19.00 VAT', () => {
    const r = total(
      'DE',
      { seller: { taxId: 'DE136695976' }, buyer: { country: 'DE', type: 'consumer' } },
      [{ unit: 11900n }],
      { currency: 'EUR', incl: true },
    );
    expect(r.taxSummary[0]).toMatchObject({ baseMinor: 10000n, taxMinor: 1900n, inclusive: true });
    expect(r.totalMinor).toBe(11900n);
  });
  it('Japan: three JPY 5 lines at 10% round once on the total (qualified invoice)', () => {
    const r = total(
      'JP',
      { buyer: { country: 'JP' } },
      [{ unit: 5n }, { unit: 5n }, { unit: 5n }],
      { currency: 'JPY' },
    );
    expect(r.roundingLevel).toBe('on_total');
    expect(r.taxMinor).toBe(2n);
  });
  it('Canada Quebec: GST 5 + QST 9.975 on CAD 100.00', () => {
    const r = total(
      'CA',
      {
        seller: { region: 'QC', taxId: '123456782RT0001', registeredRegions: ['QC'] },
        buyer: { country: 'CA', region: 'QC' },
      },
      [{ unit: 10000n }],
      { currency: 'CAD' },
    );
    expect(r.taxSummary.map((s) => [s.code, s.taxMinor])).toEqual([
      ['GST', 500n],
      ['QST', 998n],
    ]);
    expect(r.totalMinor).toBe(11498n);
  });
  it('US Texas goods with a manual combined rate of 8.25% on USD 59.99 = 4.95', () => {
    const r = total(
      'US',
      {
        seller: { region: 'TX' },
        buyer: { country: 'US', region: 'TX' },
        overrideRatePercent: '8.25',
      },
      [{ unit: 5999n }],
      { currency: 'USD' },
    );
    expect(r.taxMinor).toBe(495n); // 494.9175 -> 495
    expect(r.totalMinor).toBe(6494n);
  });
  it('Kuwait (3 decimals, no VAT): KWD 12.500 stays 12.500', () => {
    const r = total('KW', { buyer: { country: 'KW' } }, [{ unit: 12500n }], { currency: 'KWD' });
    expect(r.totalMinor).toBe(12500n);
  });
  it('Saudi Arabia 15% on SAR 1,000.00 = 1,150.00; UAE 5% on AED 333.33 = 16.67', () => {
    expect(
      total('SA', { buyer: { country: 'SA' } }, [{ unit: 100000n }], { currency: 'SAR' })
        .totalMinor,
    ).toBe(115000n);
    expect(
      total('AE', { buyer: { country: 'AE' } }, [{ unit: 33333n }], { currency: 'AED' }).taxMinor,
    ).toBe(1667n);
  });
  it('Australia GST-inclusive retail: AUD 110.00 includes 10.00 GST; with CHF-style cash rounding on AUD', () => {
    const r = total('AU', { buyer: { country: 'AU' } }, [{ unit: 11000n }], {
      currency: 'AUD',
      incl: true,
    });
    expect(r.taxMinor).toBe(1000n);
  });
});

describe('presets for the tax_rates table', () => {
  it('India: slabs in force on 2026-10-02 only, with the CGST/SGST/IGST split', () => {
    const rows = taxPresetsForCountry('IN', { asOf: D });
    const codes = rows.map((r) => r.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'GST_18',
        'GST_5',
        'GST_40',
        'GST_3',
        'GST_0_25',
        'GST_0',
        'GST_EXEMPT',
      ]),
    );
    expect(codes).not.toContain('GST_12');
    expect(codes).not.toContain('GST_28');
    const g18 = rows.find((r) => r.code === 'GST_18')!;
    expect(g18).toMatchObject({
      name: 'GST 18%',
      ratePercent: '18',
      rateBp: 1800,
      rateBpExact: true,
      type: 'gst',
      inclusive: false,
      effectiveFrom: '2017-07-01',
      effectiveTo: null,
      isDefault: true,
      countryCode: 'IN',
      region: null,
    });
    expect(g18.components!.intra.map((c) => c.name)).toEqual(['CGST 9%', 'SGST 9%']);
    expect(g18.components!.inter.map((c) => c.name)).toEqual(['IGST 18%']);
    const hist = taxPresetsForCountry('IN', { asOf: '2025-01-01' }).map((r) => r.code);
    expect(hist).toContain('GST_12');
    expect(hist).not.toContain('GST_40');
    const all = taxPresetsForCountry('IN', { includeHistorical: true }).map((r) => r.code);
    expect(all).toEqual(expect.arrayContaining(['GST_12', 'GST_28', 'GST_40']));
  });
  it('withholding rows are off unless asked for', () => {
    expect(taxPresetsForCountry('IN', { asOf: D }).some((r) => r.isWithholding)).toBe(false);
    const w = taxPresetsForCountry('IN', { asOf: D, includeWithholding: true }).filter(
      (r) => r.isWithholding,
    );
    expect(w.map((r) => r.code)).toContain('TDS_194J_10');
    expect(w.map((r) => r.code)).not.toContain('TCS_206C1H_0_1'); // ended 2025-03-31
  });
  it('Canada flags the QST rate that basis points cannot hold', () => {
    const qst = taxPresetsForCountry('CA', { asOf: D }).find((r) => r.code === 'QST')!;
    expect(qst).toMatchObject({
      ratePercent: '9.975',
      rateBpExact: false,
      region: 'QC',
      type: 'qst',
    });
    expect(taxPresetsForCountry('CA', { asOf: D }).find((r) => r.code === 'HST_NS')).toMatchObject({
      ratePercent: '14',
    });
  });
  it('every row of every profile fits the tax_rates table: name 1-60 chars, rate_bp 0-10000', () => {
    for (const p of TAX_PROFILES) {
      for (const row of taxPresetsForCountry(p.code, {
        includeHistorical: true,
        includeWithholding: true,
      })) {
        expect(row.name.length >= 1 && row.name.length <= 60, `${p.code} ${row.code} name`).toBe(
          true,
        );
        expect(
          row.rateBp >= 0 && row.rateBp <= 10000 && Number.isInteger(row.rateBp),
          `${p.code} ${row.code}`,
        ).toBe(true);
      }
    }
  });
  it('only rates a basis point cannot hold are flagged inexact', () => {
    const inexact = new Set<string>();
    for (const p of TAX_PROFILES)
      for (const r of taxPresetsForCountry(p.code, {
        includeHistorical: true,
        includeWithholding: true,
      }))
        if (!r.rateBpExact) inexact.add(`${p.code}:${r.code}`);
    expect([...inexact].sort()).toEqual([
      'CA:QST',
      'MX:RET_IVA_2_3',
      'US:ST_MN',
      'US:ST_MO',
      'US:ST_NJ',
      'US:ST_NM',
    ]);
  });
  it('unknown countries return nothing; the US yields one row per state', () => {
    expect(taxPresetsForCountry('ZZZ')).toEqual([]);
    expect(taxPresetsForCountry('US', { asOf: D }).filter((r) => r.region !== null)).toHaveLength(
      51,
    );
    expect(taxPresetsForCountry('de', { asOf: D }).find((r) => r.isDefault)).toMatchObject({
      ratePercent: '19',
    });
  });
  it('only one default row per country and date', () => {
    for (const p of TAX_PROFILES) {
      const defaults = p.rates.filter(
        (r) => r.isDefault && r.effectiveFrom <= D && (!r.effectiveTo || r.effectiveTo >= D),
      );
      const groups = new Set(defaults.map((r) => (r.appliesTo ?? ['any']).join(',')));
      expect(defaults.length, p.code).toBe(groups.size); // at most one per kind of supply
    }
  });
});

describe('rateInForce', () => {
  it('picks the latest effective row and respects the end date', () => {
    const p = getTaxProfile('SA')!;
    expect(rateInForce(p.rates, { code: 'VAT_STD', date: '2020-06-30' })?.ratePercent).toBe('5');
    expect(rateInForce(p.rates, { code: 'VAT_STD', date: '2020-07-01' })?.ratePercent).toBe('15');
    expect(rateInForce(p.rates, { code: 'VAT_STD', date: '2017-01-01' })).toBeUndefined();
  });
});

describe('financial year and invoice numbers', () => {
  const IN = getTaxProfile('IN')!;
  it('India runs 1 April to 31 March and labels it 2026-27', () => {
    expect(fiscalYearOf('2026-04-01', IN.fiscalYear)).toEqual({
      startYear: 2026,
      start: '2026-04-01',
      end: '2027-03-31',
      label: '2026-27',
    });
    expect(fiscalYearOf('2026-03-31', IN.fiscalYear)).toMatchObject({
      startYear: 2025,
      label: '2025-26',
      end: '2026-03-31',
    });
    expect(fiscalYearOf('2027-01-15', IN.fiscalYear).label).toBe('2026-27');
  });
  it('UK personal tax year starts 6 April; the default elsewhere is 1 January', () => {
    const gb = getTaxProfile('GB')!.fiscalYear;
    expect(fiscalYearOf('2026-04-05', gb)).toMatchObject({ startYear: 2025, end: '2026-04-05' });
    expect(fiscalYearOf('2026-04-06', gb)).toMatchObject({
      startYear: 2026,
      start: '2026-04-06',
      label: '2026-27',
    });
    const us = getTaxProfile('US')!.fiscalYear;
    expect(fiscalYearOf('2026-12-31', us)).toEqual({
      startYear: 2026,
      start: '2026-01-01',
      end: '2026-12-31',
      label: '2026',
    });
    expect(getTaxProfile('AU')!.fiscalYear.startMonth).toBe(1);
  });
  it('rejects a malformed date and handles leap-year ends', () => {
    expect(() => fiscalYearOf('2026-02-30', IN.fiscalYear)).toThrow(RangeError);
    expect(
      fiscalYearOf('2027-03-01', { startMonth: 3, startDay: 1, labelFormat: 'YYYY-YYYY' }).end,
    ).toBe('2028-02-29');
  });
  it('formats numbers from a pattern', () => {
    expect(
      formatInvoiceNumber({
        pattern: '{PREFIX}/{FY}/{SEQ}',
        prefix: 'INV',
        seq: 7,
        date: '2026-10-02',
        fiscalYear: IN.fiscalYear,
      }),
    ).toBe('INV/2026-27/0007');
    expect(
      formatInvoiceNumber({
        prefix: 'A',
        seq: 12,
        date: '2026-10-02',
        fiscalYear: IN.fiscalYear,
        seqPad: 6,
      }),
    ).toBe('A-2026-000012');
    expect(
      formatInvoiceNumber({
        pattern: '{YY}{MM}-{SEQ}',
        prefix: '',
        seq: 1,
        date: '2026-10-02',
        fiscalYear: IN.fiscalYear,
        seqPad: 3,
      }),
    ).toBe('2610-001');
  });
  it('resets the counter by policy', () => {
    const fy = IN.fiscalYear;
    expect(sequenceScope('2026-03-31', 'fiscal_year', fy)).toBe('FY2025-26');
    expect(sequenceScope('2026-04-01', 'fiscal_year', fy)).toBe('FY2026-27');
    expect(sequenceScope('2026-04-01', 'yearly', fy)).toBe('2026');
    expect(sequenceScope('2026-04-01', 'monthly', fy)).toBe('2026-04');
    expect(sequenceScope('2026-04-01', 'never', fy)).toBe('all');
    const a = nextInvoiceNumber(IN.numbering, fy, { date: '2026-03-30' });
    expect(a.number).toBe('INV/2025-26/0001');
    const b = nextInvoiceNumber(IN.numbering, fy, { date: '2026-03-31', state: a.state });
    expect(b.number).toBe('INV/2025-26/0002');
    const c = nextInvoiceNumber(IN.numbering, fy, { date: '2026-04-01', state: b.state });
    expect(c.number).toBe('INV/2026-27/0001');
    const never = nextInvoiceNumber(IN.numbering, fy, {
      date: '2030-01-01',
      state: b.state,
      reset: 'never',
    });
    expect(never.state.seq).toBe(1); // scope changed from FY to "all"
    const d = nextInvoiceNumber(
      { ...IN.numbering, reset: 'never', pattern: '{PREFIX}-{SEQ}' },
      fy,
      { date: '2030-01-01', state: { scope: 'all', seq: 41 }, prefix: 'X' },
    );
    expect(d.number).toBe('X-0042');
  });
  it('enforces the Indian limits: 16 characters, letters, digits, "-" and "/"', () => {
    const rules = IN.numbering;
    expect(validateInvoiceNumber(rules, 'INV/2026-27/0001')).toEqual({ valid: true, issues: [] });
    expect(validateInvoiceNumber(rules, 'INV/2026-27/00001').valid).toBe(false);
    expect(validateInvoiceNumber(rules, 'INV 2026#1').valid).toBe(false);
    expect(validateInvoiceNumber(rules, '').valid).toBe(false);
    expect(validateInvoiceNumber(getTaxProfile('GB')!.numbering, 'INV-2026-0001').valid).toBe(true);
  });
  it('the default India pattern fits the 16-character limit', () => {
    const n = nextInvoiceNumber(IN.numbering, IN.fiscalYear, { date: '2026-10-02' }).number;
    expect(n.length).toBeLessThanOrEqual(16);
  });
});

describe('invoice compliance checklist', () => {
  const IN = getTaxProfile('IN')!;
  const base = {
    document_title: 'TAX INVOICE',
    invoice_number: 'INV/2026-27/0001',
    issue_date: true,
    seller_name: true,
    seller_address: true,
    seller_tax_id: true,
    buyer_name: true,
    line_description: true,
    line_quantity: true,
    line_unit_price: true,
    line_tax_rate: true,
    tax_summary: true,
    total_amount: true,
    taxable_value: true,
    reverse_charge_wording: 'Tax payable on reverse charge basis: No',
    authorised_signature: true,
  };
  it('a complete B2C intra-state invoice passes (required items only)', () => {
    expect(
      checkInvoiceCompliance(IN, { fields: base }, { b2b: false, interState: false }).filter(
        (i) => i.level === 'required',
      ),
    ).toEqual([]);
  });
  it('B2B needs the buyer GSTIN, address and HSN; inter-state needs the place of supply', () => {
    const issues = checkInvoiceCompliance(
      IN,
      { fields: base },
      { b2b: true, interState: true },
    ).map((i) => i.field);
    expect(issues).toEqual(
      expect.arrayContaining(['buyer_tax_id', 'buyer_address', 'line_hsn_sac', 'place_of_supply']),
    );
  });
  it('checks mandatory wording', () => {
    const issues = checkInvoiceCompliance(
      IN,
      { fields: { ...base, document_title: 'Invoice' } },
      {},
    );
    expect(issues.find((i) => i.field === 'document_title')).toMatchObject({
      problem: 'wrong_text',
      expected: 'TAX INVOICE',
    });
    const missing = checkInvoiceCompliance(IN, { fields: { ...base, document_title: '' } }, {});
    expect(missing.find((i) => i.field === 'document_title')).toMatchObject({ problem: 'missing' });
  });
  it('composition suppliers need the "BILL OF SUPPLY" title; exports need the export wording', () => {
    expect(
      applicableChecklist(IN, { composition: true }).some(
        (i) => i.mustContain === 'BILL OF SUPPLY',
      ),
    ).toBe(true);
    expect(applicableChecklist(IN, {}).some((i) => i.mustContain === 'BILL OF SUPPLY')).toBe(false);
    expect(
      applicableChecklist(IN, { export: true }).some((i) => i.field === 'export_wording'),
    ).toBe(true);
  });
  it('amount thresholds use the currency exponent (Australia: buyer details from AUD 1,000)', () => {
    const au = getTaxProfile('AU')!;
    const below = applicableChecklist(au, { totalMinor: 99999n }).some(
      (i) => i.when === 'above_threshold',
    );
    const above = applicableChecklist(au, { totalMinor: 100000n }).some(
      (i) => i.when === 'above_threshold',
    );
    expect([below, above]).toEqual([false, true]);
    expect(applicableChecklist(getTaxProfile('JP')!, {}).length).toBeGreaterThan(0);
  });
  it('reverse-charge wording is required on EU reverse-charge invoices', () => {
    const de = getTaxProfile('DE')!;
    const issues = checkInvoiceCompliance(
      de,
      { fields: {} },
      { b2b: true, reverseCharge: true },
    ).map((i) => i.field);
    expect(issues).toEqual(
      expect.arrayContaining(['reverse_charge_wording', 'buyer_tax_id', 'seller_tax_id']),
    );
  });
});
