import { describe, expect, it } from 'vitest';
import { en, missingKeys } from './test-messages';
import { DOC_KINDS, profileToForm, validateForm, type ProfileForm } from './lib/profile-form';
import type { InvoiceProfile } from '@crm/contracts';

/** Keys the Business profile screen builds at run time, in English and Arabic. */
describe('business profile messages', () => {
  it('has the section menu, the document names and the tax id requirement lines', () => {
    expect(
      missingKeys([
        ...['business', 'branding', 'payment', 'numbering', 'defaults', 'online'].map((s) => `settings.nav.${s}`),
        ...DOC_KINDS.map((k) => `settings.numbering.docs.${k}`),
        ...['required', 'required_if_registered', 'b2b_only'].map((r) => `settings.taxId.requirement.${r}`),
        'settings.online.secretShort',
        'settings.online.secretLong',
        'errors.codes.PAY_GATEWAY_NOT_CONFIGURED',
      ]),
    ).toEqual([]);
  });

  it('has a message for every validation code the form can produce', () => {
    const profile: InvoiceProfile = {
      sellerName: null, sellerAddress: null, sellerCountry: null, sellerState: null, sellerTaxId: null, sellerRegistrationNo: null,
      sellerPhone: null, supportEmail: null, extraFields: [], logoUrl: null, brandColor: null, bankDetails: null, paymentInstructions: null,
      numberingPrefix: 'INV', proformaPrefix: 'PRO', receiptPrefix: 'RCT', creditNotePrefix: 'CRN', salesOrderPrefix: 'SO',
      numberFormat: '{PREFIX}-{YEAR}-{SEQ}', numberPadding: 6, yearlyReset: true, fiscalYearStartMonth: 1, dueDays: null, terms: null,
      footerNote: null, invoiceTitle: null, defaultTaxRegime: 'none', overdueReminders: true, currency: 'USD', rowVersion: null, updatedAt: null,
    };
    const base = profileToForm(profile);
    const long = 'x'.repeat(20000);
    const bad: ProfileForm[] = [
      { ...base, sellerName: long, sellerCountry: 'IND', sellerState: 'ABCD', supportEmail: 'x', logoUrl: 'http://x', brandColor: 'r', numberingPrefix: '', numberPadding: '0', fiscalYearStartMonth: '0', dueDays: '999', defaultTaxRegime: 'No' },
      ...['', '{PREFIX}', '{SEQ}'.padEnd(80, '-'), '{PREFIX}#{SEQ}', '{FY}{SEQ}', '{SEQ}'].map((numberFormat) => ({ ...base, numberFormat })),
      {
        ...base,
        extraFields: [...Array.from({ length: 9 }, (_, i) => ({ label: `a${i}`, value: 'v' })), { label: 'half', value: '' }],
        bankRows: [
          ...Array.from({ length: 13 }, (_, i) => ({ label: `L${i}`, value: 'v' })),
          { label: 'L1', value: 'dup' },
          { label: 'y'.repeat(41), value: 'v' },
        ],
      },
    ];
    const codes = new Set<string>();
    for (const f of bad) for (const issue of Object.values(validateForm(f))) codes.add(issue.code);
    expect(codes.size).toBeGreaterThan(12);
    expect(missingKeys([...codes].map((c) => `settings.v.${c}`))).toEqual([]);
  });

  it('keeps the format examples literal: braces are quoted so they print as written', () => {
    expect(en['invoicing.settings.v.format.seq']).toContain("'{SEQ}'");
    expect(en['invoicing.settings.numbering.formatHint']).toContain("'{PREFIX}'");
  });
});
