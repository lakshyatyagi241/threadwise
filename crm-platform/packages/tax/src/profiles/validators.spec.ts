import { describe, expect, it } from 'vitest';
import { getTaxProfile, TAX_PROFILES } from './registry';
import {
  EU_VAT_FORMATS,
  euVatPrefix,
  gstinCheckChar,
  normalizeId,
  validateAbn,
  validateBahrainVat,
  validateCaGstHst,
  validateCaQst,
  validateCnpj,
  validateEuVatId,
  validateGstin,
  validateJpInvoiceNo,
  validateKePin,
  validateMexRfc,
  validateMySst,
  validateNgTin,
  validateNzIrd,
  validateOmanVat,
  validatePan,
  validateSaudiVat,
  validateSgGst,
  validateUaeTrn,
  validateUkVat,
  validateUsEin,
  validateZaVat,
} from './validators';

describe('GSTIN (India)', () => {
  it.each([
    '27AAPFU0939F1ZV',
    '24AAACC1206D1ZM',
    '07AAACG2115R1ZJ',
    '29AABCT1332L1ZA',
    '33AAACT2727Q1Z3',
    '06BZAHM6385P1Z5',
    '29AAGCB7383J1Z4',
  ])('accepts %s', (g) => {
    const r = validateGstin(g);
    expect(r.valid).toBe(true);
    expect(r.level).toBe('checksum');
  });
  it('accepts spaces, dashes and lower case and returns the canonical form', () => {
    const r = validateGstin(' 27-aapfu0939f 1zv ');
    expect(r).toMatchObject({ valid: true, normalized: '27AAPFU0939F1ZV' });
    expect(r.details).toMatchObject({
      stateCode: '27',
      pan: 'AAPFU0939F',
      holderType: 'Firm / LLP',
    });
  });
  it.each([
    ['27AAPFU0939F1ZX', 'check character'],
    ['29AABCT1332L1ZP', 'check character'],
    ['27AAPFU0939F1AV', 'Format'],
    ['00AAPFU0939F1ZV', 'state code'],
    ['39AAPFU0939F1ZV', 'state code'],
    ['27AAPFU0939F1Z', '15 characters'],
    ['27AAPFU0939F1ZVV', '15 characters'],
    ['27AAPFU09390F1ZV', '15 characters'],
    ['27AAPXU0939F1ZV', 'PAN'],
    ['', '15 characters'],
  ])('rejects %s (%s)', (g, why) => {
    const r = validateGstin(g);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain(why);
  });
  it('computes the check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
  });
  it('validates PAN', () => {
    expect(validatePan('AAPFU0939F').valid).toBe(true);
    expect(validatePan('AAPXU0939F').valid).toBe(false);
    expect(validatePan('AAPFU09391').valid).toBe(false);
  });
});

describe('Gulf IDs', () => {
  it('UAE TRN', () => {
    expect(validateUaeTrn('100123456789003').valid).toBe(true);
    expect(validateUaeTrn('1001-2345-6789-003').valid).toBe(true);
    expect(validateUaeTrn('200123456789003').valid).toBe(false);
    expect(validateUaeTrn('10012345678900').valid).toBe(false);
  });
  it('Saudi VAT number', () => {
    expect(validateSaudiVat('300000000000003').valid).toBe(true);
    expect(validateSaudiVat('310122393500003').valid).toBe(true);
    expect(validateSaudiVat('300000000000004').valid).toBe(false);
    expect(validateSaudiVat('400000000000003').valid).toBe(false);
  });
  it('Bahrain and Oman', () => {
    expect(validateBahrainVat('200000000000002').valid).toBe(true);
    expect(validateBahrainVat('20000000000000').valid).toBe(false);
    expect(validateOmanVat('OM1100123456').valid).toBe(true);
    expect(validateOmanVat('1100123456').valid).toBe(false);
  });
});

describe('UK VAT number', () => {
  it.each([
    'GB333289454',
    '333289454',
    'GB 980 7806 84',
    'GB434031494',
    'XI333289454',
    'GBGD001',
    'GBHA599',
    'GB333289454000',
  ])('accepts %s', (v) => {
    expect(validateUkVat(v).valid).toBe(true);
  });
  it.each([
    ['GB333289455'],
    ['GB33328945'],
    ['GBGD500'],
    ['GBHA499'],
    ['GB333289454 00'],
    ['GB12345678X'],
  ])('rejects %s', (v) => {
    expect(validateUkVat(v).valid).toBe(false);
  });
  it('reports the check-digit failure as a checksum level', () => {
    expect(validateUkVat('GB333289455')).toMatchObject({ valid: false, level: 'checksum' });
  });
});

describe('EU VAT ids (VIES style)', () => {
  it.each([
    ['DE136695976', 'checksum'],
    ['FR40303265045', 'checksum'],
    ['IT00743110157', 'checksum'],
    ['BE0403019261', 'checksum'],
    ['PL5260250995', 'checksum'],
    ['ATU12345675', 'format'],
    ['NL123456789B01', 'format'],
    ['ESA12345674', 'format'],
    ['EL123456789', 'format'],
    ['IE1234567T', 'format'],
    ['SE123456789001', 'format'],
    ['CZ12345678', 'format'],
    ['DK12345678', 'format'],
    ['de 136 695 976', 'checksum'],
  ])('accepts %s (%s)', (v, level) => {
    const r = validateEuVatId(v);
    expect(r.valid).toBe(true);
    expect(r.level).toBe(level);
  });
  it('uses the country hint when the prefix is missing, and maps GR to EL', () => {
    expect(validateEuVatId('136695976', 'DE').valid).toBe(true);
    expect(validateEuVatId('123456789', 'GR')).toMatchObject({
      valid: true,
      normalized: 'EL123456789',
    });
    expect(euVatPrefix('gr')).toBe('EL');
  });
  it.each([
    ['DE136695977', 'check digits'],
    ['FR41303265045', 'check digits'],
    ['IT00743110158', 'check digits'],
    ['BE0403019262', 'check digits'],
    ['PL5260250996', 'check digits'],
    ['DE12345', 'format'],
    ['NL123456789A01', 'format'],
    ['ATX12345675', 'format'],
    ['12345678', 'prefix'],
    ['XX123456789', 'prefix'],
  ])('rejects %s (%s)', (v, why) => {
    const r = validateEuVatId(v);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain(why);
  });
  it('rejects a prefix that does not match the stated country', () => {
    expect(validateEuVatId('FR40303265045', 'DE')).toMatchObject({ valid: false });
  });
  it('every member-state profile has a validator whose own example is valid', () => {
    for (const p of TAX_PROFILES.filter((x) => x.code in EU_VAT_FORMATS || x.code === 'GR')) {
      const spec = p.sellerTaxId.spec!;
      expect(spec.validate(spec.example), `${p.code} ${spec.example}`).toMatchObject({
        valid: true,
      });
    }
  });
});

describe('Americas', () => {
  it('US EIN', () => {
    expect(validateUsEin('12-3456789').valid).toBe(true);
    expect(validateUsEin('123-45-6789').valid).toBe(true); // 9 digits: shape only
    expect(validateUsEin('12-345678').valid).toBe(false);
  });
  it('Canada GST/HST number (Luhn on the business number)', () => {
    expect(validateCaGstHst('123456782RT0001')).toMatchObject({ valid: true, level: 'checksum' });
    expect(validateCaGstHst('123456782')).toMatchObject({ valid: true });
    expect(validateCaGstHst('123456789RT0001')).toMatchObject({ valid: false });
    expect(validateCaGstHst('123456782RX0001').valid).toBe(false);
    expect(validateCaQst('1234567890TQ0001').valid).toBe(true);
    expect(validateCaQst('1234567890TQ001').valid).toBe(false);
  });
  it('Mexico RFC', () => {
    expect(validateMexRfc('XAXX010101000')).toMatchObject({
      valid: true,
      details: { holder: 'individual' },
    });
    expect(validateMexRfc('ABC 850101 AB1')).toMatchObject({
      valid: true,
      details: { holder: 'company' },
    });
    expect(validateMexRfc('XAXX011301000').valid).toBe(false);
    expect(validateMexRfc('XAXX0101').valid).toBe(false);
  });
  it('Brazil CNPJ', () => {
    expect(validateCnpj('11.222.333/0001-81')).toMatchObject({ valid: true, level: 'checksum' });
    expect(validateCnpj('45.997.418/0001-53').valid).toBe(true);
    expect(validateCnpj('11.222.333/0001-82').valid).toBe(false);
    expect(validateCnpj('11111111111111').valid).toBe(false);
  });
});

describe('Asia-Pacific and Africa', () => {
  it('Australian ABN checksum', () => {
    expect(validateAbn('51 824 753 556').valid).toBe(true);
    expect(validateAbn('53004085616').valid).toBe(true);
    expect(validateAbn('83 914 571 673').valid).toBe(true);
    expect(validateAbn('51 824 753 557')).toMatchObject({ valid: false, level: 'checksum' });
    expect(validateAbn('1234').valid).toBe(false);
  });
  it('New Zealand IRD checksum', () => {
    for (const ok of ['49-091-850', '35-901-981', '136-410-132', '35901981'])
      expect(validateNzIrd(ok).valid, ok).toBe(true);
    expect(validateNzIrd('49-091-851').valid).toBe(false);
    expect(validateNzIrd('12345678').valid).toBe(false);
    expect(validateNzIrd('5000').valid).toBe(false);
    expect(validateNzIrd('999999999').valid).toBe(false);
  });
  it('Singapore GST / UEN', () => {
    for (const ok of ['201912345A', '53012345B', 'T08LL0001A', 'M2-0012345-6', 'M90012345X'])
      expect(validateSgGst(ok).valid, ok).toBe(true);
    expect(validateSgGst('12345').valid).toBe(false);
  });
  it('Malaysia SST', () => {
    expect(validateMySst('W10-1808-32000123').valid).toBe(true);
    expect(validateMySst('B16-1808-3200012').valid).toBe(false);
  });
  it('Japan registration number (corporate-number check digit)', () => {
    expect(validateJpInvoiceNo('T1180301018771')).toMatchObject({ valid: true, level: 'checksum' });
    expect(validateJpInvoiceNo('T7000012050002').valid).toBe(true);
    expect(validateJpInvoiceNo('T1180301018772').valid).toBe(false);
    expect(validateJpInvoiceNo('1180301018771').valid).toBe(false);
  });
  it('South Africa, Nigeria, Kenya', () => {
    expect(validateZaVat('4123456789').valid).toBe(true);
    expect(validateZaVat('3123456789').valid).toBe(false);
    expect(validateNgTin('12345678-0001').valid).toBe(true);
    expect(validateNgTin('1234').valid).toBe(false);
    expect(validateKePin('P051234567Z').valid).toBe(true);
    expect(validateKePin('A000000000B').valid).toBe(true);
    expect(validateKePin('X051234567Z').valid).toBe(false);
  });
});

describe('every profile id spec is self-consistent', () => {
  it('its documented example validates', () => {
    for (const p of TAX_PROFILES) {
      for (const spec of [p.sellerTaxId.spec, p.buyerTaxId.spec, ...(p.otherIds ?? [])]) {
        if (!spec) continue;
        expect(spec.validate(spec.example), `${p.code} ${spec.id} ${spec.example}`).toMatchObject({
          valid: true,
        });
      }
    }
  });
  it('looks profiles up by code, alias and case', () => {
    expect(getTaxProfile('in')!.code).toBe('IN');
    expect(getTaxProfile('UK')!.code).toBe('GB');
    expect(getTaxProfile('EL')!.code).toBe('GR');
    expect(getTaxProfile('zz')!.code).toBe('CUSTOM');
    expect(getTaxProfile('FR-XX')).toBeUndefined();
  });
  it('normalizeId strips separators', () => {
    expect(normalizeId(' ab-12.3/4_5 ')).toBe('AB12345');
  });
});
