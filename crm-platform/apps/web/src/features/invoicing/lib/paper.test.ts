import { publicInvoiceSchema, type InvoiceResponse, type PublicInvoice } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { TAX_NONE, emptyDraft, emptyLine, pricingOf, type DraftLine } from './builder';
import { paperAddsUp, paperFromDraft, paperFromInvoice, paperFromPublic } from './paper';

const UUID = '11111111-1111-4111-8111-111111111111';

/** The shape the API answers for an invoice (a real draft, trimmed). */
const invoice = (over: Partial<InvoiceResponse> = {}): InvoiceResponse =>
  ({
    id: UUID,
    number: 'INV-2026-000013',
    docType: 'tax_invoice',
    source: 'manual',
    status: 'partially_paid',
    storedStatus: 'issued',
    paymentStatus: 'partial',
    overdue: false,
    daysOverdue: null,
    currency: 'USD',
    currencyExponent: 2,
    amounts: {
      subtotal: '3376.12',
      discount: '0.00',
      shipping: '10.00',
      tax: '607.70',
      taxAdded: '607.70',
      total: '3993.82',
      paid: '1000.00',
      refunded: '0.00',
      balance: '2993.82',
      credit: '0.00',
      credited: '0.00',
    },
    amountsMinor: {
      subtotal: '337612',
      discount: '0',
      shipping: '1000',
      tax: '60770',
      taxAdded: '60770',
      total: '399382',
      paid: '100000',
      refunded: '0',
      balance: '299382',
      credit: '0',
      credited: '0',
    },
    buyerName: 'Acme',
    buyerEmail: 'a@b.co',
    contact: null,
    company: null,
    deal: null,
    owner: null,
    issueDate: '2026-10-02',
    dueDate: '2026-10-16',
    reference: 'PO-1',
    rowVersion: 3,
    buyer: {
      name: 'Acme Ltd',
      email: 'a@b.co',
      phone: null,
      address: '1 Main St',
      taxId: '29AABCT1332L1ZA',
      country: 'IN',
    },
    seller: {
      name: 'Seller Co',
      address: '2 Side St',
      country: 'IN',
      state: 'MH',
      taxId: '27AAPFU0939F1ZV',
      registrationNo: 'U123',
      phone: null,
      email: 's@x.co',
      extra: [{ label: 'PAN', value: 'AAPFU0939F' }],
      bankDetails: { IBAN: 'DE00 1234' },
    },
    taxRegime: 'in_gst',
    placeOfSupply: 'IN-KA',
    reverseCharge: false,
    legalNotes: 'Supply meant for export',
    taxExplanation: null,
    discount: null,
    notes: 'Thanks',
    terms: 'Net 14',
    lines: [
      {
        id: UUID,
        position: 0,
        description: 'Discovery workshop',
        sku: null,
        hsnSac: '998314',
        qty: '2.5',
        unitPrice: '1500.50',
        discount: { kind: 'amount', value: '375.13' },
        taxRateId: null,
        taxName: 'Tax',
        taxType: null,
        taxRate: '18',
        taxInclusive: false,
        taxComponents: null,
        amounts: {
          gross: '3751.25',
          discount: '375.13',
          net: '3376.12',
          docDiscountShare: '0.00',
          tax: '607.70',
          total: '3983.82',
        },
      },
    ],
    taxSummary: [
      {
        name: 'Tax',
        type: null,
        rate: '18',
        inclusive: false,
        base: '3376.12',
        tax: '607.70',
        components: null,
      },
    ],
    voidReason: null,
    ...over,
  }) as InvoiceResponse;

describe('paperFromInvoice', () => {
  const m = paperFromInvoice(invoice());
  it('reads the server figures exactly (strings, never floats)', () => {
    expect(m).toMatchObject({
      number: 'INV-2026-000013',
      status: 'partially_paid',
      subtotalMinor: 337612,
      shippingMinor: 1000,
      taxAddedMinor: 60770,
      totalMinor: 399382,
      paidMinor: 100000,
      balanceMinor: 299382,
      includedTaxMinor: 0,
    });
    expect(m.lines[0]).toMatchObject({
      unitPriceMinor: 150050,
      amountMinor: 337612,
      taxLabel: 'Tax 18%',
      hsnSac: '998314',
    });
    expect(m.lines[0]!.discount).toEqual({ kind: 'amount', amountMinor: 37513 });
    expect(m.taxRows).toEqual([
      { label: 'Tax 18%', inclusive: false, baseMinor: 337612, taxMinor: 60770 },
    ]);
  });
  it('carries the seller, buyer, notes and place of supply', () => {
    expect(m.seller).toMatchObject({
      name: 'Seller Co',
      taxId: '27AAPFU0939F1ZV',
      registrationNo: 'U123',
      bankDetails: { IBAN: 'DE00 1234' },
    });
    expect(m.seller?.extra).toEqual([{ label: 'PAN', value: 'AAPFU0939F' }]);
    expect(m.buyer).toMatchObject({ name: 'Acme Ltd', taxId: '29AABCT1332L1ZA', country: 'IN' });
    expect(m.placeOfSupply).toBe('IN-KA');
    expect(m.legalNotes).toBe('Supply meant for export');
    expect(m.reference).toBe('PO-1');
  });
  it('shows the HSN/SAC column for an Indian seller', () => {
    expect(m.showHsn).toBe(true);
    expect(
      paperFromInvoice(
        invoice({
          seller: { ...invoice().seller!, country: 'GB' },
          lines: [{ ...invoice().lines[0]!, hsnSac: null }],
        }),
      ).showHsn,
    ).toBe(false);
  });
  it('adds up', () => expect(paperAddsUp(m)).toBe(true));
  it('a draft with no frozen seller prints from the profile it is given', () => {
    const d = paperFromInvoice(invoice({ seller: null, status: 'draft', number: null }), {
      sellerName: 'Profile Co',
      sellerCountry: 'IN',
      invoiceTitle: 'Tax Invoice',
      footerNote: 'Thank you',
      extraFields: [],
      bankDetails: null,
    } as never);
    expect(d.seller?.name).toBe('Profile Co');
    expect(d.title).toBe('Tax Invoice');
    expect(d.footerNote).toBe('Thank you');
    expect(d.number).toBeNull();
  });
  it('a reverse-charge invoice says so', () => {
    expect(paperFromInvoice(invoice({ reverseCharge: true })).reverseCharge).toBe(true);
  });
});

describe('paperFromPublic', () => {
  const pub: PublicInvoice = publicInvoiceSchema.parse({
    number: 'INV-2026-000013',
    docType: 'proforma',
    status: 'void',
    currency: 'USD',
    currencyExponent: 2,
    issueDate: '2026-10-02',
    dueDate: null,
    seller: {
      name: 'Seller Co',
      address: null,
      country: 'AE',
      state: null,
      taxId: '100123456789003',
      registrationNo: null,
      phone: null,
      email: null,
      extra: [],
      bankDetails: { Bank: 'ADCB' },
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
        taxName: 'VAT',
        taxType: 'vat',
        taxRate: '5',
        taxInclusive: true,
        taxComponents: null,
        amounts: {
          gross: '100.00',
          discount: '0.00',
          net: '100.00',
          docDiscountShare: '0.00',
          tax: '4.76',
          total: '100.00',
        },
      },
    ],
    taxSummary: [
      {
        name: 'VAT',
        type: 'vat',
        rate: '5',
        inclusive: true,
        base: '95.24',
        tax: '4.76',
        components: null,
      },
    ],
    amounts: {
      subtotal: '100.00',
      discount: '0.00',
      shipping: '0.00',
      tax: '4.76',
      taxAdded: '0.00',
      total: '100.00',
      paid: '0.00',
      refunded: '0.00',
      balance: '100.00',
      credit: '0.00',
      credited: '0.00',
    },
    reverseCharge: false,
    legalNotes: null,
    notes: null,
    terms: null,
    footerNote: 'Footer',
    title: '',
    brandColor: '#0B3D2E',
    logoUrl: null,
    payments: [
      {
        kind: 'payment',
        amount: '10.00',
        method: 'bank',
        paidAt: '2026-10-03T10:00:00.000Z',
        receiptNumber: 'RCT-1',
      },
    ],
    payable: false,
    paymentOptions: { bankTransfer: null, online: false },
    voidedAt: '2026-10-04T10:00:00.000Z',
    voidReason: 'Duplicate',
  });
  const m = paperFromPublic(pub);
  it('is the same paper', () => {
    expect(m).toMatchObject({
      docType: 'proforma',
      status: 'void',
      title: null,
      totalMinor: 10000,
      includedTaxMinor: 476,
      taxAddedMinor: 0,
      footerNote: 'Footer',
      brandColor: '#0B3D2E',
      voidReason: 'Duplicate',
      showHsn: false,
    });
    expect(m.taxRows).toEqual([
      { label: 'VAT 5%', inclusive: true, baseMinor: 9524, taxMinor: 476 },
    ]);
    expect(m.payments).toEqual([
      {
        kind: 'payment',
        amountMinor: 1000,
        method: 'bank',
        paidAt: '2026-10-03T10:00:00.000Z',
        receiptNumber: 'RCT-1',
      },
    ]);
    expect(m.lines[0]!.taxLabel).toBe('VAT 5% incl.');
    expect(m.seller?.bankDetails).toEqual({ Bank: 'ADCB' });
    expect(paperAddsUp(m)).toBe(true);
  });
});

describe('paperFromDraft', () => {
  const profile = {
    currency: 'USD',
    dueDays: null,
    terms: null,
    sellerCountry: 'IN',
    sellerState: 'MH',
    sellerTaxId: null,
    sellerName: 'Me',
    invoiceTitle: null,
    footerNote: null,
    brandColor: null,
    extraFields: [],
    bankDetails: null,
  } as never;
  const line = (over: Partial<DraftLine> = {}): DraftLine => ({
    ...emptyLine(),
    description: 'Work',
    price: '100',
    ...over,
  });
  it('is priced by the same function as the totals card, and adds up', () => {
    const d = {
      ...emptyDraft(profile, '2026-10-02'),
      shipping: '5',
      discountKind: 'percent' as const,
      discountText: '10',
      lines: [line({ qty: '2', taxRateId: TAX_NONE }), emptyLine()],
    };
    const pricing = pricingOf(d, { rates: [], profile, today: '2026-10-02' });
    const m = paperFromDraft(d, pricing, { profile, rates: [] });
    expect(m.number).toBeNull();
    expect(m.status).toBe('draft');
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0]).toMatchObject({ unitPriceMinor: 10000, amountMinor: 20000 });
    expect(m).toMatchObject({
      subtotalMinor: 20000,
      discountMinor: 2000,
      shippingMinor: 500,
      totalMinor: 18500,
      discountPercent: '10',
      showHsn: true,
    });
    expect(paperAddsUp(m)).toBe(true);
  });
});
