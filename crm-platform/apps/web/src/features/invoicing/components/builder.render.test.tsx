import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  publicInvoiceSchema,
  type InvoiceProfile,
  type InvoiceResponse,
  type TaxRateResponse,
} from '@crm/contracts';
import {
  TAX_NONE,
  emptyDraft,
  emptyLine,
  pricingOf,
  type DraftLine,
  type InvoiceDraft,
} from '../lib/builder';
import { paperFromDraft, paperFromInvoice, paperFromPublic } from '../lib/paper';
import { AdjustmentsSection, DetailsSection, TaxSection } from './builder-sections';
import { InvoicePaper } from './invoice-paper';
import { InvoiceLinesEditor } from './line-items-editor';
import { PublicInvoiceView } from './public-invoice';
import { TaxWhy, TaxWhyPreview } from './tax-why';
import { TotalsCard } from './totals-card';

type Tree = { [k: string]: string | Tree };
const merge = (a: Tree, b: Tree): Tree => {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] =
      typeof v === 'object' && typeof out[k] === 'object' ? merge(out[k] as Tree, v as Tree) : v;
  return out;
};
const load = (locale: string): Tree =>
  readdirSync(join(process.cwd(), 'messages', locale))
    .filter((f) => f === 'invoicing.json' || /^invoicing\..+\.json$/.test(f))
    .sort()
    .reduce<Tree>(
      (acc, f) =>
        merge(
          acc,
          JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, f), 'utf8')) as Tree,
        ),
      {},
    );
const MESSAGES = { en: load('en'), ar: load('ar') };

const html = (el: ReactElement, locale: 'en' | 'ar' = 'en') =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale]}
        timeZone="UTC"
        onError={(e) => {
          throw e;
        }}
      >
        {el}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const UUID = '11111111-1111-4111-8111-111111111111';
const profile = {
  currency: 'INR',
  dueDays: 14,
  terms: null,
  sellerCountry: 'IN',
  sellerState: 'MH',
  sellerTaxId: '27AAPFU0939F1ZV',
  sellerName: 'Seller Co',
  sellerAddress: '2 Side St',
  sellerRegistrationNo: 'U123',
  sellerPhone: null,
  supportEmail: null,
  extraFields: [{ label: 'PAN', value: 'AAPFU0939F' }],
  logoUrl: null,
  brandColor: '#0B3D2E',
  bankDetails: { IFSC: 'HDFC0001234' },
  invoiceTitle: null,
  footerNote: 'Thank you',
} as unknown as InvoiceProfile;
const rate: TaxRateResponse = {
  id: UUID,
  name: 'GST 18%',
  type: 'gst',
  rate: '18',
  inclusive: false,
  isDefault: true,
  isActive: true,
  description: null,
  country: 'IN',
  region: null,
  components: [
    { type: 'CGST', rate: '9' },
    { type: 'SGST', rate: '9' },
  ],
  effectiveFrom: null,
  effectiveTo: null,
  defaultHsnSac: '998314',
  usedBy: 0,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  ...emptyLine(),
  description: 'Discovery workshop',
  price: '1000',
  hsnSac: '998314',
  ...over,
});
const draft = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  ...emptyDraft(profile, '2026-10-02'),
  buyerName: 'Acme Ltd',
  lines: [line()],
  ...over,
});

for (const locale of ['en', 'ar'] as const) {
  describe(`builder pieces render in ${locale}`, () => {
    const ctx = { rates: [rate], profile, today: '2026-10-02' };

    it('the paper for a live draft (HSN column for an Indian seller, tax summary, bank details)', () => {
      const d = draft({ shipping: '50', reference: 'PO-1' });
      const out = html(
        <InvoicePaper model={paperFromDraft(d, pricingOf(d, ctx), { profile, rates: [rate] })} />,
        locale,
      );
      expect(out).toContain('Seller Co');
      expect(out).toContain('998314');
      expect(out).toContain('CGST 9%');
      expect(out).toContain('SGST 9%');
      expect(out).toContain('HDFC0001234');
      expect(out).toContain('Thank you');
      expect(out).toContain('PO-1');
      expect(out).toContain('border-top:4px solid #0B3D2E');
    });

    it('no HSN column for a seller whose country does not ask for it', () => {
      const p = { ...profile, sellerCountry: 'GB' };
      const d = draft({ lines: [line({ hsnSac: '', taxRateId: TAX_NONE })] });
      const out = html(
        <InvoicePaper
          model={paperFromDraft(d, pricingOf(d, { ...ctx, profile: p }), {
            profile: p,
            rates: [rate],
          })}
        />,
        locale,
      );
      expect(out).not.toContain('HSN/SAC');
    });

    it('the totals card lists a tax row per rate with its base', () => {
      const d = draft();
      const out = html(
        <TotalsCard totals={pricingOf(d, ctx).result.totals} currency="INR" />,
        locale,
      );
      expect(out).toContain('CGST 9%');
      expect(out).toContain('SGST 9%');
    });

    it('"Why this tax?" shows a saved explanation and renders nothing without one', () => {
      const base = {
        reverseCharge: false,
        placeOfSupply: null,
        taxExplanation: null,
      } as unknown as InvoiceResponse;
      expect(html(<TaxWhy invoice={base} />, locale)).toBe('');
      const out = html(
        <TaxWhy
          invoice={
            {
              ...base,
              reverseCharge: true,
              placeOfSupply: 'IN-KA',
              taxExplanation: {
                reasons: ['Inter-state supply, so IGST 18%.'],
                warnings: ['Check the buyer GSTIN'],
                documentNotes: ['Tax payable on reverse charge basis: No'],
                taxFree: false,
              },
            } as InvoiceResponse
          }
        />,
        locale,
      );
      expect(out).toContain('Inter-state supply, so IGST 18%.');
      expect(out).toContain('Check the buyer GSTIN');
      expect(out).toContain('Karnataka');
      expect(out).toContain('Tax payable on reverse charge basis: No');
    });

    it('the live preview of the reasoning is labelled as a preview', () => {
      const d = draft({
        taxMode: 'auto',
        buyerCountry: 'IN',
        placeRegion: 'KA',
        supplyType: 'goods',
      });
      const p = pricingOf(d, ctx);
      expect(p.auto?.ok).toBe(true);
      if (!p.auto?.ok) return;
      const out = html(
        <TaxWhyPreview preview={p.auto.preview} placeOfSupply="IN-KA" reverseCharge={false} />,
        locale,
      );
      expect(out).toContain('IGST');
    });

    it('the lines editor shows the HSN box only when asked, and prefills from the rate', () => {
      const props = {
        lines: [line()],
        onChange: () => undefined,
        currency: 'INR',
        taxRates: [rate],
        errors: { 'lines.0.qty': 'Bad qty' },
      };
      const withHsn = html(<InvoiceLinesEditor {...props} showHsn />, locale);
      expect(withHsn).toContain('998314');
      expect(withHsn).toContain('Bad qty');
      const without = html(<InvoiceLinesEditor {...props} showHsn={false} />, locale);
      expect(without).not.toContain('maxLength="12"');
    });

    it('the tax section switches between rates and automatic, and asks for the seller country', () => {
      const set = () => undefined;
      const rates = html(
        <TaxSection draft={draft()} setDraft={set} error={() => undefined} profile={profile} />,
        locale,
      );
      expect(rates).not.toContain('inv-supply');
      const auto = html(
        <TaxSection
          draft={draft({ taxMode: 'auto' })}
          setDraft={set}
          error={() => undefined}
          profile={profile}
        />,
        locale,
      );
      expect(auto).toContain('inv-supply');
      expect(auto).toContain('inv-place');
      expect(auto).toContain('Maharashtra');
      const noCountry = html(
        <TaxSection
          draft={draft({ taxMode: 'auto' })}
          setDraft={set}
          error={() => undefined}
          profile={{ ...profile, sellerCountry: null }}
        />,
        locale,
      );
      expect(noCountry).toContain('role="alert"');
    });

    it('the other sections render', () => {
      const props = { draft: draft(), setDraft: () => undefined, error: () => undefined };
      expect(html(<DetailsSection {...props} />, locale)).toContain('inv-doctype');
      expect(html(<AdjustmentsSection {...props} />, locale)).toContain('inv-ship');
    });
  });
}

describe('the saved invoice and the buyer page render', () => {
  const inv = {
    id: UUID,
    number: 'INV-1',
    docType: 'tax_invoice',
    status: 'issued',
    currency: 'USD',
    currencyExponent: 2,
    issueDate: '2026-10-02',
    dueDate: '2026-10-16',
    reference: null,
    placeOfSupply: null,
    reverseCharge: true,
    legalNotes: 'Reverse charge applies',
    notes: null,
    terms: null,
    voidReason: null,
    discount: null,
    amountsMinor: {
      subtotal: '10000',
      discount: '0',
      shipping: '0',
      tax: '0',
      taxAdded: '0',
      total: '10000',
      paid: '2500',
      refunded: '0',
      balance: '7500',
      credit: '0',
      credited: '0',
    },
    buyer: {
      name: 'Acme',
      email: null,
      phone: null,
      address: null,
      taxId: 'FR40303265045',
      country: 'FR',
    },
    contact: null,
    seller: {
      name: 'Seller',
      address: null,
      country: 'DE',
      state: null,
      taxId: 'DE136695976',
      registrationNo: null,
      phone: null,
      email: null,
      extra: [],
      bankDetails: null,
    },
    lines: [
      {
        id: UUID,
        position: 0,
        description: 'Item',
        sku: null,
        hsnSac: null,
        qty: '1',
        unitPrice: '100.00',
        discount: null,
        taxRateId: null,
        taxName: null,
        taxType: null,
        taxRate: '0',
        taxInclusive: false,
        taxComponents: null,
        amounts: {
          gross: '100.00',
          discount: '0.00',
          net: '100.00',
          docDiscountShare: '0.00',
          tax: '0.00',
          total: '100.00',
        },
      },
    ],
    taxSummary: [],
  } as unknown as InvoiceResponse;

  it('a saved invoice prints the buyer tax id, the reverse-charge wording and the balance', () => {
    const out = html(<InvoicePaper model={paperFromInvoice(inv)} />);
    expect(out).toContain('FR40303265045');
    expect(out).toContain('Reverse charge');
    expect(out).toContain('Reverse charge applies');
    expect(out).toContain('Balance due');
  });

  const pub = publicInvoiceSchema.parse({
    number: 'INV-1',
    docType: 'tax_invoice',
    status: 'issued',
    currency: 'USD',
    currencyExponent: 2,
    issueDate: '2026-10-02',
    dueDate: '2026-10-16',
    seller: {
      name: 'Seller',
      address: null,
      country: 'DE',
      state: null,
      taxId: null,
      registrationNo: null,
      phone: null,
      email: 'help@seller.test',
      extra: [],
      bankDetails: null,
    },
    buyer: { name: 'Acme', address: null, taxId: null },
    reference: null,
    lines: [
      {
        position: 0,
        description: 'Item',
        sku: null,
        hsnSac: null,
        qty: '1',
        unitPrice: '100.00',
        discount: null,
        taxName: null,
        taxType: null,
        taxRate: '0',
        taxInclusive: false,
        taxComponents: null,
        amounts: {
          gross: '100.00',
          discount: '0.00',
          net: '100.00',
          docDiscountShare: '0.00',
          tax: '0.00',
          total: '100.00',
        },
      },
    ],
    taxSummary: [],
    amounts: {
      subtotal: '100.00',
      discount: '0.00',
      shipping: '0.00',
      tax: '0.00',
      taxAdded: '0.00',
      total: '100.00',
      paid: '25.00',
      refunded: '0.00',
      balance: '75.00',
      credit: '0.00',
      credited: '0.00',
    },
    reverseCharge: false,
    legalNotes: null,
    notes: null,
    terms: null,
    footerNote: null,
    title: '',
    brandColor: null,
    logoUrl: null,
    payments: [
      {
        kind: 'payment',
        amount: '25.00',
        method: 'bank',
        paidAt: '2026-10-03T10:00:00.000Z',
        receiptNumber: 'RCT-1',
      },
    ],
    payable: true,
    paymentOptions: {
      bankTransfer: { instructions: 'Quote INV-1', details: { IBAN: 'DE00 1234' } },
      online: true,
    },
    voidedAt: null,
    voidReason: null,
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`the buyer page shows the paper, the payments and the pay panel (${locale})`, () => {
      const out = html(
        <PublicInvoiceView token="tok_abcdefghijklmnop" data={pub} onPaid={() => undefined} />,
        locale,
      );
      expect(out).toContain('RCT-1');
      expect(out).toContain('DE00 1234');
      expect(out).toContain('Quote INV-1');
      expect(out).toContain('id="pay-amount"');
      expect(out).toContain('/api/public/invoices/tok_abcdefghijklmnop/pdf');
      expect(paperFromPublic(pub).balanceMinor).toBe(7500);
    });
  }

  it('a voided invoice says so clearly and offers no payment', () => {
    const out = html(
      <PublicInvoiceView
        token="tok_abcdefghijklmnop"
        data={{ ...pub, status: 'void', payable: false, voidReason: 'Duplicate' }}
        onPaid={() => undefined}
      />,
    );
    expect(out).toContain('cancelled');
    expect(out).toContain('Duplicate');
    expect(out).not.toContain('id="pay-amount"');
  });

  it('with no payment option the buyer is told to contact the seller', () => {
    const out = html(
      <PublicInvoiceView
        token="tok_abcdefghijklmnop"
        data={{ ...pub, paymentOptions: { bankTransfer: null, online: false } }}
        onPaid={() => undefined}
      />,
    );
    expect(out).toContain('contact them');
  });
});
