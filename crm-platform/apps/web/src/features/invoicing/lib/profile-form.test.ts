import { describe, expect, it } from 'vitest';
import type { InvoiceProfile } from '@crm/contracts';
import {
  bankLabelSuggestions,
  bankRowsToRecord,
  checkTaxId,
  countrySuggestion,
  diffToPatch,
  formatNumberExample,
  gstinFacts,
  gstinStateMismatch,
  isDirty,
  normalizeRows,
  normalizeState,
  normalizedTaxId,
  numberExamples,
  numberFormatProblem,
  numberingInputOf,
  numberingWarnings,
  profileToForm,
  recordToRows,
  secretProblem,
  stateOptions,
  validateForm,
} from './profile-form';

const PROFILE: InvoiceProfile = {
  sellerName: null,
  sellerAddress: null,
  sellerCountry: null,
  sellerState: null,
  sellerTaxId: null,
  sellerRegistrationNo: null,
  sellerPhone: null,
  supportEmail: null,
  extraFields: [],
  logoUrl: null,
  brandColor: null,
  bankDetails: null,
  paymentInstructions: null,
  numberingPrefix: 'INV',
  proformaPrefix: 'PRO',
  receiptPrefix: 'RCT',
  creditNotePrefix: 'CRN',
  salesOrderPrefix: 'SO',
  numberFormat: '{PREFIX}-{YEAR}-{SEQ}',
  numberPadding: 6,
  yearlyReset: true,
  fiscalYearStartMonth: 1,
  dueDays: null,
  terms: null,
  footerNote: null,
  invoiceTitle: null,
  defaultTaxRegime: 'none',
  overdueReminders: true,
  currency: 'USD',
  rowVersion: null,
  updatedAt: null,
};
const form = (p: Partial<InvoiceProfile> = {}) => profileToForm({ ...PROFILE, ...p });

describe('diffToPatch', () => {
  it('sends nothing when nothing changed', () => {
    expect(diffToPatch(form(), form(), null)).toEqual({});
    expect(diffToPatch(form(), form(), 3)).toEqual({});
  });

  it('sends only the changed fields, trimmed', () => {
    const a = form();
    const b = { ...a, sellerName: '  Acme Ltd  ', numberPadding: '4', overdueReminders: false };
    expect(diffToPatch(a, b, null)).toEqual({
      sellerName: 'Acme Ltd',
      numberPadding: 4,
      overdueReminders: false,
    });
  });

  it('carries rowVersion only once the profile has been saved', () => {
    const a = form();
    const b = { ...a, footerNote: 'Thanks' };
    expect(diffToPatch(a, b, null)).toEqual({ footerNote: 'Thanks' });
    expect(diffToPatch(a, b, 5)).toEqual({ footerNote: 'Thanks', rowVersion: 5 });
  });

  it('clears an optional field with null', () => {
    const a = form({ supportEmail: 'a@b.co', dueDays: 30, logoUrl: 'https://x.test/l.png' });
    const b = { ...a, supportEmail: '  ', dueDays: '', logoUrl: '' };
    expect(diffToPatch(a, b, 2)).toEqual({
      supportEmail: null,
      dueDays: null,
      logoUrl: null,
      rowVersion: 2,
    });
  });

  it('upper-cases country, state and prefixes, and sends the due days as a number', () => {
    const a = form();
    const b = {
      ...a,
      sellerCountry: 'gb',
      sellerState: 'eng',
      numberingPrefix: 'inv2',
      dueDays: '30',
    };
    expect(diffToPatch(a, b, null)).toEqual({
      sellerCountry: 'GB',
      sellerState: 'ENG',
      numberingPrefix: 'INV2',
      dueDays: 30,
    });
  });

  it('keeps India states as GST codes and does not treat MH vs 27 as a change', () => {
    const a = form({ sellerCountry: 'IN', sellerState: 'MH' });
    expect(a.sellerState).toBe('27');
    expect(diffToPatch(a, { ...a, sellerState: 'MH' }, null)).toEqual({});
    expect(diffToPatch(a, { ...a, sellerState: '29' }, null)).toEqual({ sellerState: '29' });
  });

  it('sends extra fields as a whole list without blank or half-filled rows, and an empty list clears them', () => {
    const a = form({ extraFields: [{ label: 'CIN', value: 'U1' }] });
    const b = {
      ...a,
      extraFields: [
        ...a.extraFields,
        { label: 'LUT No', value: ' AD123 ' },
        { label: '', value: '' },
        { label: 'half', value: '' },
      ],
    };
    expect(diffToPatch(a, b, null)).toEqual({
      extraFields: [
        { label: 'CIN', value: 'U1' },
        { label: 'LUT No', value: 'AD123' },
      ],
    });
    expect(diffToPatch(a, { ...a, extraFields: [] }, null)).toEqual({ extraFields: [] });
  });

  it('sends bank details as a record, null when none are left, and ignores a reorder', () => {
    const a = form({ bankDetails: { IBAN: 'DE00', BIC: 'ABC' } });
    expect(diffToPatch(a, { ...a, bankRows: [...a.bankRows].reverse() }, null)).toEqual({});
    expect(
      diffToPatch(
        a,
        {
          ...a,
          bankRows: [
            { label: 'IBAN', value: 'DE11' },
            { label: 'BIC', value: 'ABC' },
          ],
        },
        null,
      ),
    ).toEqual({
      bankDetails: { IBAN: 'DE11', BIC: 'ABC' },
    });
    expect(diffToPatch(a, { ...a, bankRows: [] }, 1)).toEqual({ bankDetails: null, rowVersion: 1 });
  });

  it('does not send an emptied prefix or format (the form shows the error instead)', () => {
    const a = form();
    expect(diffToPatch(a, { ...a, numberingPrefix: '', numberFormat: '' }, null)).toEqual({});
  });
});

describe('isDirty', () => {
  it('is false for the loaded form and ignores an untouched blank row', () => {
    const a = form();
    expect(isDirty(a, a)).toBe(false);
    expect(isDirty(a, { ...a, bankRows: [{ label: '', value: '' }] })).toBe(false);
  });
  it('is true for any edit, including a half-filled row', () => {
    const a = form();
    expect(isDirty(a, { ...a, sellerName: 'x' })).toBe(true);
    expect(isDirty(a, { ...a, bankRows: [{ label: 'IBAN', value: '' }] })).toBe(true);
  });
});

describe('number format', () => {
  it.each([
    ['{PREFIX}-{YEAR}-{SEQ}', true, null],
    ['{PREFIX}/{YY}/{SEQ}', true, null],
    ['{SEQ}', false, null],
    ['{PREFIX}{SEQ}', true, 'year'],
    ['{PREFIX}-{YEAR}', false, 'seq'],
    ['{PREFIX}-{FY}-{SEQ}', false, 'token'],
    ['{prefix}-{SEQ}', false, null],
    ['{PREFIX}#{SEQ}', false, 'charset'],
    ['', false, 'empty'],
    ['{PREFIX}-{SEQ}'.padEnd(61, '-'), false, 'tooLong'],
  ] as const)('%s (yearly %s) -> %s', (format, yearly, problem) => {
    expect(numberFormatProblem(format, yearly)).toBe(problem);
  });

  it('formats the way the server does', () => {
    const n = numberingInputOf(form());
    expect(formatNumberExample('invoice', n, '2026-10-02', 7)).toBe('INV-2026-000007');
    expect(formatNumberExample('creditNote', n, '2026-10-02', 1)).toBe('CRN-2026-000001');
    expect(
      formatNumberExample(
        'invoice',
        { ...n, numberFormat: '{PREFIX}/{YY}/{SEQ}', padding: 3 },
        '2027-01-05',
        1234,
      ),
    ).toBe('INV/27/1234');
  });

  it('uses the year the fiscal year started in', () => {
    const f = { ...form(), fiscalYearStartMonth: '4', numberFormat: '{PREFIX}/{YEAR}/{SEQ}' };
    const n = numberingInputOf(f);
    expect(formatNumberExample('invoice', n, '2026-03-31', 1)).toBe('INV/2025/000001');
    expect(formatNumberExample('invoice', n, '2026-04-01', 1)).toBe('INV/2026/000001');
  });

  it('gives an example for each of the five document types', () => {
    const ex = numberExamples(form(), '2026-10-02');
    expect(ex.map((e) => e.number)).toEqual([
      'INV-2026-000001',
      'PRO-2026-000001',
      'RCT-2026-000001',
      'CRN-2026-000001',
      'SO-2026-000001',
    ]);
  });

  it("warns about India's 16 characters and character set", () => {
    const long = numberExamples({ ...form(), numberingPrefix: 'INVOICE' }, '2026-10-02');
    expect(numberingWarnings('IN', long)).toEqual([
      { kind: 'invoice', code: 'tooLong', max: 16, length: 'INVOICE-2026-000001'.length },
    ]);
    expect(numberingWarnings('IN', numberExamples(form(), '2026-10-02'))).toEqual([]);
    const odd = numberExamples(
      { ...form(), numberFormat: '{PREFIX}.{YEAR}.{SEQ}', numberPadding: '2' },
      '2026-10-02',
    );
    expect(numberingWarnings('IN', odd).map((w) => w.code)).toContain('chars');
    expect(numberingWarnings('', long)).toEqual([]);
    expect(numberingWarnings('US', long)).toEqual([]);
  });
});

describe('country defaults', () => {
  it('suggests the tax preset id and the fiscal year start of the country', () => {
    expect(countrySuggestion('IN')).toMatchObject({ regime: 'in', fiscalYearStartMonth: 4 });
    expect(countrySuggestion('gb')).toMatchObject({ regime: 'gb', fiscalYearStartMonth: 4 });
    expect(countrySuggestion('DE')).toMatchObject({ regime: 'de', fiscalYearStartMonth: 1 });
    expect(countrySuggestion('')).toBeNull();
    expect(countrySuggestion('ZZ')).toBeNull();
  });

  it('offers state lists for India, the US and Canada only', () => {
    expect(stateOptions('IN')?.find((s) => s.code === '27')?.name).toBe('Maharashtra');
    expect(stateOptions('us')?.some((s) => s.code === 'TX')).toBe(true);
    expect(stateOptions('CA')?.some((s) => s.code === 'ON')).toBe(true);
    expect(stateOptions('GB')).toBeNull();
    expect(normalizeState('IN', 'Maharashtra')).toBe('27');
    expect(normalizeState('US', 'tx')).toBe('TX');
  });
});

describe('tax id check', () => {
  it.each([
    ['IN', '27AAPFU0939F1ZV', 'GSTIN'],
    ['GB', 'GB333289454', 'VAT registration number'],
    ['DE', 'DE136695976', 'VAT identification number'],
    ['US', '12-3456789', 'EIN'],
    ['AU', '51 824 753 556', 'ABN'],
    ['AE', '100123456789003', 'TRN'],
    ['SG', '201912345A', 'GST registration number / UEN'],
  ])('%s accepts %s', (country, id, label) => {
    const c = checkTaxId(country, id);
    expect(c.state).toBe('checked');
    expect(c.label).toBe(label);
    expect(c.result?.valid).toBe(true);
  });

  it.each([
    ['IN', '27AAPFU0939F1ZX'],
    ['GB', 'GB333289455'],
    ['DE', 'DE136695977'],
    ['US', '12-345678'],
    ['AU', '51 824 753 557'],
    ['AE', '200123456789003'],
    ['SG', '12345'],
  ])('%s rejects %s with a reason', (country, id) => {
    const c = checkTaxId(country, id);
    expect(c.result?.valid).toBe(false);
    expect(c.result?.reason).toBeTruthy();
  });

  it('reports the level: checksum for GSTIN and UK VAT, format only for the US EIN', () => {
    expect(checkTaxId('IN', '27AAPFU0939F1ZV').result?.level).toBe('checksum');
    expect(checkTaxId('GB', 'GB333289454').result?.level).toBe('checksum');
    expect(checkTaxId('US', '12-3456789').result?.level).toBe('format');
    expect(checkTaxId('IN', '27AAPFU0939F1ZX').result?.level).toBe('checksum');
  });

  it('says what is missing instead of validating blindly', () => {
    expect(checkTaxId('', '123').state).toBe('no_country');
    expect(checkTaxId('IN', '  ').state).toBe('empty');
    expect(checkTaxId('IN', '  ').label).toBe('GSTIN');
    expect(checkTaxId('QA', '123').state).toBe('no_spec');
  });

  it('normalises the id for the field', () => {
    expect(normalizedTaxId('IN', ' 27-aapfu0939f 1zv ')).toBe('27AAPFU0939F1ZV');
    expect(normalizedTaxId('', ' abc ')).toBe('abc');
  });

  it('reads the state and PAN from a GSTIN and flags a different chosen state', () => {
    const c = checkTaxId('IN', '27AAPFU0939F1ZV');
    expect(gstinFacts(c)).toEqual({ stateCode: '27', stateName: 'Maharashtra', pan: 'AAPFU0939F' });
    expect(gstinStateMismatch(c, 'IN', '27')).toBe(false);
    expect(gstinStateMismatch(c, 'IN', 'MH')).toBe(false);
    expect(gstinStateMismatch(c, 'IN', '29')).toBe(true);
    expect(gstinStateMismatch(c, 'IN', '')).toBe(false);
    expect(gstinFacts(checkTaxId('IN', '27AAPFU0939F1ZX'))).toBeNull();
  });
});

describe('bank rows', () => {
  it('trims, drops blank and half-filled rows, and keeps the last of a repeated label', () => {
    expect(
      normalizeRows([
        { label: ' IBAN ', value: ' DE00 ' },
        { label: '', value: '' },
        { label: 'BIC', value: '' },
      ]),
    ).toEqual([{ label: 'IBAN', value: 'DE00' }]);
    expect(
      bankRowsToRecord([
        { label: 'A', value: '1' },
        { label: 'A', value: '2' },
      ]),
    ).toEqual({ A: '2' });
    expect(bankRowsToRecord([{ label: '', value: '' }])).toBeNull();
    expect(recordToRows({ IBAN: 'x' })).toEqual([{ label: 'IBAN', value: 'x' }]);
    expect(recordToRows(null)).toEqual([]);
  });

  it('suggests labels by country', () => {
    expect(bankLabelSuggestions('IN')).toEqual(expect.arrayContaining(['IFSC', 'UPI ID']));
    expect(bankLabelSuggestions('GB')).toEqual(expect.arrayContaining(['Sort code']));
    expect(bankLabelSuggestions('AU')).toContain('BSB');
    expect(bankLabelSuggestions('US')).toContain('Routing number');
    expect(bankLabelSuggestions('DE')).toEqual(expect.arrayContaining(['IBAN', 'BIC']));
    expect(bankLabelSuggestions('')).toContain('IBAN');
  });
});

describe('validateForm', () => {
  it('accepts the defaults', () => {
    expect(validateForm(form())).toEqual({});
  });

  it('flags each rule the API enforces', () => {
    const f = {
      ...form(),
      supportEmail: 'nope',
      logoUrl: 'http://x.test/l.png',
      brandColor: 'red',
      numberingPrefix: 'IN-V',
      numberFormat: '{PREFIX}-{SEQ}',
      numberPadding: '11',
      fiscalYearStartMonth: '13',
      dueDays: '400',
      sellerCountry: 'IND',
      sellerState: 'ABCD',
    };
    const v = validateForm(f);
    expect(Object.keys(v).sort()).toEqual(
      [
        'brandColor',
        'dueDays',
        'fiscalYearStartMonth',
        'logoUrl',
        'numberPadding',
        'numberingPrefix',
        'sellerCountry',
        'sellerState',
        'supportEmail',
        'yearlyReset',
      ].sort(),
    );
    expect(v['yearlyReset']?.code).toBe('format.year');
  });

  it('checks rows: incomplete, too many, too long, repeated bank labels', () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `L${i}`, value: 'v' }));
    expect(validateForm({ ...form(), extraFields: rows(9) })['extraFields']?.code).toBe(
      'tooManyRows',
    );
    expect(validateForm({ ...form(), bankRows: rows(13) })['bankDetails']?.code).toBe(
      'tooManyRows',
    );
    expect(
      validateForm({ ...form(), bankRows: [{ label: 'IBAN', value: '' }] })['bankDetails.0.value']
        ?.code,
    ).toBe('rowIncomplete');
    expect(
      validateForm({ ...form(), bankRows: [{ label: 'x'.repeat(41), value: 'v' }] })[
        'bankDetails.0.label'
      ]?.code,
    ).toBe('tooLong');
    expect(
      validateForm({ ...form(), bankRows: [{ label: 'x', value: 'y'.repeat(121) }] })[
        'bankDetails.0.value'
      ]?.code,
    ).toBe('tooLong');
    expect(
      validateForm({
        ...form(),
        bankRows: [
          { label: 'IBAN', value: '1' },
          { label: 'iban', value: '2' },
        ],
      })['bankDetails.1.label']?.code,
    ).toBe('duplicate');
    expect(
      validateForm({ ...form(), extraFields: [{ label: 'CIN', value: 'z'.repeat(81) }] })[
        'extraFields.0.value'
      ]?.code,
    ).toBe('tooLong');
  });
});

describe('gateway secret', () => {
  it('needs 16 to 256 characters', () => {
    expect(secretProblem('short')).toBe('short');
    expect(secretProblem('x'.repeat(16))).toBeNull();
    expect(secretProblem('x'.repeat(257))).toBe('long');
  });
});
