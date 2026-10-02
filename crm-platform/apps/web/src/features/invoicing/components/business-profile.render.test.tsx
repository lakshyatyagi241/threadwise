import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InvoiceProfile } from '@crm/contracts';
import { profileToForm, type ProfileForm } from '../lib/profile-form';
import { BrandingSection } from './business-profile-branding';
import { BusinessSection } from './business-profile-business';
import { PaymentSection } from './business-profile-payment';
import type { EditorCtx } from './business-profile-ui';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'invoicing.x-settings.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const PROFILE: InvoiceProfile = {
  sellerName: 'Acme Traders',
  sellerAddress: '1 Main Road',
  sellerCountry: 'IN',
  sellerState: '29',
  sellerTaxId: '27AAPFU0939F1ZV',
  sellerRegistrationNo: null,
  sellerPhone: null,
  supportEmail: null,
  extraFields: [{ label: 'CIN', value: 'U123' }],
  logoUrl: 'https://x.test/logo.png',
  brandColor: '#0B3D2E',
  bankDetails: { IFSC: 'HDFC0001234', 'Account number': '1234567890' },
  paymentInstructions: 'Quote the invoice number.',
  numberingPrefix: 'INV',
  proformaPrefix: 'PRO',
  receiptPrefix: 'RCT',
  creditNotePrefix: 'CRN',
  salesOrderPrefix: 'SO',
  numberFormat: '{PREFIX}/{YEAR}/{SEQ}',
  numberPadding: 4,
  yearlyReset: true,
  fiscalYearStartMonth: 4,
  dueDays: 30,
  terms: null,
  footerNote: 'Thank you',
  invoiceTitle: 'Tax Invoice',
  defaultTaxRegime: 'in',
  overdueReminders: true,
  currency: 'INR',
  rowVersion: 2,
  updatedAt: null,
};

const ctx = (form: ProfileForm, over: Partial<EditorCtx> = {}): EditorCtx => ({
  form,
  set: () => undefined,
  err: () => undefined,
  readOnly: false,
  profile: PROFILE,
  ...over,
});

describe('business profile sections render', () => {
  it('shows the seller, the GSTIN result with its state and PAN, and warns when the state differs', () => {
    const out = html(<BusinessSection {...ctx(profileToForm(PROFILE))} />);
    expect(out).toContain('Acme Traders');
    expect(out).toContain('Tax ID (GSTIN)');
    expect(out).toContain('check digits are correct');
    expect(out).toContain('Maharashtra (27)');
    expect(out).toContain('AAPFU0939F');
    expect(out).toContain('not the state chosen above');
    expect(out).toContain('checks the format only');
    expect(out).toContain('U123');
  });

  it('warns, without blocking, on a failed GSTIN and shows the reason', () => {
    const out = html(
      <BusinessSection {...ctx({ ...profileToForm(PROFILE), sellerTaxId: '27AAPFU0939F1ZX' })} />,
    );
    expect(out).toContain('check digits do not match');
    expect(out).toContain('You can still save it');
  });

  it('is read-only when the person cannot edit', () => {
    const out = html(<BusinessSection {...ctx(profileToForm(PROFILE), { readOnly: true })} />);
    expect(out).toMatch(/<input[^>]*disabled/);
    expect(out).not.toContain('Add row');
  });

  it('previews the branding and the printed bank details', () => {
    const form = profileToForm(PROFILE);
    expect(html(<BrandingSection {...ctx(form)} />)).toContain('https://x.test/logo.png');
    const pay = html(<PaymentSection {...ctx(form)} />);
    expect(pay).toContain('HDFC0001234');
    expect(pay).toContain('Tax Invoice');
    expect(pay).toContain('Quote the invoice number.');
    expect(pay).toContain('Thank you');
  });
});
