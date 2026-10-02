import { describe, expect, it } from 'vitest';
import type { PublicInvoice } from '@crm/contracts';
import {
  groupDigits,
  money,
  renderInvoiceHtml,
  renderInvoicePdf,
} from '../../../src/modules/crm/invoicing/invoice-render';

const doc = (over: Partial<PublicInvoice> = {}): PublicInvoice => ({
  number: 'INV-2026-000001',
  docType: 'tax_invoice',
  status: 'issued',
  currency: 'USD',
  currencyExponent: 2,
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  seller: {
    name: 'Seller Inc',
    address: '1 Main St\nTown',
    country: 'US',
    state: null,
    taxId: 'EIN 12-3456789',
    registrationNo: null,
    phone: null,
    email: 'billing@seller.test',
    extra: [],
    bankDetails: null,
  },
  buyer: { name: 'Buyer (Pty) Ltd', address: null, taxId: null },
  reference: 'PO-77',
  lines: [
    {
      position: 0,
      description: 'Consulting (10 hours)',
      sku: null,
      hsnSac: null,
      qty: '10',
      unitPrice: '100.00',
      discount: null,
      taxName: 'VAT',
      taxType: 'vat',
      taxRate: '20',
      taxInclusive: false,
      taxComponents: null,
      amounts: { gross: '1000.00', discount: '0.00', net: '1000.00', docDiscountShare: '0.00', tax: '200.00', total: '1200.00' },
    },
  ],
  taxSummary: [{ name: 'VAT', type: 'vat', rate: '20', inclusive: false, base: '1000.00', tax: '200.00', components: null }],
  amounts: {
    subtotal: '1000.00',
    discount: '0.00',
    shipping: '0.00',
    tax: '200.00',
    taxAdded: '200.00',
    total: '1200.00',
    paid: '0.00',
    refunded: '0.00',
    balance: '1200.00',
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
  payments: [],
  payable: true,
  paymentOptions: { bankTransfer: { instructions: 'Pay to account 123', details: { IBAN: 'XX00 1234' } }, online: false },
  voidedAt: null,
  voidReason: null,
  ...over,
});

describe('rendering (TW-INV-014, TW-INV-015, D-16)', () => {
  it('groups digits and puts the currency code first (no symbol: not every font has it, and a symbol means different things)', () => {
    expect(groupDigits('1234567.50')).toBe('1,234,567.50');
    expect(groupDigits('-1234.5')).toBe('-1,234.5');
    expect(groupDigits('12')).toBe('12');
    expect(money('1500', 'JPY')).toBe('JPY 1,500');
  });

  it('the PDF is a well-formed document: header, xref offsets that point at objects, trailer', () => {
    const pdf = renderInvoicePdf(doc());
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThanOrEqual(6);
    entries.forEach((off, i) => expect(text.slice(off, off + 12), `object ${i + 1}`).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });

  it('is deterministic: an issued invoice renders the same bytes every time (nothing live is read at render time)', () => {
    expect(renderInvoicePdf(doc()).equals(renderInvoicePdf(doc()))).toBe(true);
  });

  it('breaks a long invoice over several pages and keeps every page inside the object list', () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ ...doc().lines[0]!, position: i, description: `Line item number ${i} with some words to wrap around the column` }));
    const pdf = renderInvoicePdf(doc({ lines: many }));
    const text = pdf.toString('latin1');
    const count = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(count).toBeGreaterThan(1);
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(count);
  });

  it('escapes PDF string syntax and turns characters outside Windows-1252 into "?" instead of corrupting the file', () => {
    const pdf = renderInvoicePdf(doc({ buyer: { name: 'Evil ) Tj (pwned) \\ 日本語 €', address: null, taxId: null } }));
    const text = pdf.toString('latin1');
    expect(text).toContain('Evil \\) Tj \\(pwned\\) \\\\ ??? \\200');
    expect(text.startsWith('%PDF-')).toBe(true);
  });

  it('the printable page escapes every buyer-supplied string and tells search engines to stay away', () => {
    const html = renderInvoiceHtml(
      doc({
        buyer: { name: '<script>alert(1)</script>', address: '"><img src=x onerror=alert(2)>', taxId: null },
        notes: '<b>bold</b>',
        lines: [{ ...doc().lines[0]!, description: '<svg onload=alert(3)>' }],
        logoUrl: 'http://internal.test/logo.png',
      }),
    );
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<svg onload');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('noindex');
    // a logo that is not https is never fetched (Reference refused remote images to keep its renderer away from internal hosts)
    expect(html).not.toContain('internal.test');
  });

  it('shows what a buyer needs: number, due date, tax summary, the bank details to pay with, the reverse-charge sentence', () => {
    const html = renderInvoiceHtml(doc({ reverseCharge: true }));
    for (const s of ['INV-2026-000001', '2026-10-15', 'VAT 20%', 'Pay to account 123', 'IBAN: XX00 1234', 'Reverse charge']) expect(html).toContain(s);
  });

  it('D-07: tax is always printed when there is tax, whatever the document type (Reference hid it on receipts and proformas)', () => {
    for (const docType of ['tax_invoice', 'proforma', 'receipt'] as const) {
      const html = renderInvoiceHtml(doc({ docType }));
      expect(html).toContain('VAT 20%');
      expect(html).toContain('200.00');
    }
  });

  it('a void invoice carries a banner and offers no payment instructions', () => {
    const html = renderInvoiceHtml(doc({ status: 'void', payable: false, voidReason: 'duplicate' }));
    expect(html).toContain('voided');
    expect(html).not.toContain('How to pay');
  });
});
