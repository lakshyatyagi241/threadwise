import { computeInvoice, createInvoiceSchema, updateInvoiceSchema, type InvoiceResponse, type TaxRateResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  TAX_DEFAULT,
  TAX_NONE,
  TAX_SNAPSHOT,
  decimalOf,
  draftOf,
  draftToBody,
  emptyDraft,
  emptyLine,
  hasProblems,
  isBlankLine,
  isSameDraft,
  issuesToProblems,
  lineProblems,
  linesToInput,
  pricingOf,
  rateOfLine,
  serverPath,
  usedIndexes,
  validateDraft,
  withContact,
  type DraftLine,
  type InvoiceDraft,
} from './builder';
import { taxLabel } from './totals';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const rate = (over: Partial<TaxRateResponse> = {}): TaxRateResponse => ({
  id: UUID_A,
  name: 'VAT',
  type: 'vat',
  rate: '20',
  inclusive: false,
  isDefault: false,
  isActive: true,
  description: null,
  country: null,
  region: null,
  components: null,
  effectiveFrom: null,
  effectiveTo: null,
  defaultHsnSac: null,
  usedBy: 0,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const profile = { currency: 'USD', dueDays: 14, terms: 'Pay within 14 days', sellerCountry: 'IN', sellerState: 'MH', sellerTaxId: null };
const ctx = (rates: TaxRateResponse[]) => ({ rates, profile, today: '2026-10-02' });
const line = (over: Partial<DraftLine> = {}): DraftLine => ({ ...emptyLine(), description: 'Work', price: '100', ...over });
const draftWith = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({ ...emptyDraft(profile, '2026-10-02'), ...over });

describe('defaults from the invoicing profile', () => {
  it('takes currency, due days and terms', () => {
    const d = emptyDraft(profile, '2026-10-02');
    expect(d.currency).toBe('USD');
    expect(d.dueDate).toBe('2026-10-16');
    expect(d.terms).toBe('Pay within 14 days');
    expect(d.taxMode).toBe('rates');
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]!.taxRateId).toBe(TAX_DEFAULT);
  });
  it('no due days means the default terms apply at issue (no due date typed)', () => {
    expect(emptyDraft({ ...profile, dueDays: null }, '2026-10-02').dueDate).toBe('');
  });
});

describe('decimalOf', () => {
  it('reads what a person types as a wire decimal', () => {
    expect(decimalOf('12')).toBe('12');
    expect(decimalOf('12.50')).toBe('12.50');
    expect(decimalOf('1,234.50')).toBe('1234.50');
    expect(decimalOf('12,5')).toBe('12.5');
    expect(decimalOf(' 7 ')).toBe('7');
  });
  it('refuses what is not a non-negative decimal', () => {
    for (const bad of ['', 'abc', '-3', '1.23456', '1e3', '1.2.3']) expect(decimalOf(bad), bad).toBeNull();
  });
});

describe('linesToInput', () => {
  const rates = [rate({ id: UUID_A, isDefault: true }), rate({ id: UUID_B, name: 'GST', rate: '5' })];
  it('drops blank lines and sends decimal strings', () => {
    const out = linesToInput([emptyLine(), line({ qty: '2,5', price: '10.5' })], 'USD', rates);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ description: 'Work', qty: '2.5', unitPrice: '10.5' });
  });
  it('taxRateId: absent for the default rate, null for no tax, the uuid for a rate', () => {
    const [a, b, c] = linesToInput(
      [line({ taxRateId: TAX_DEFAULT }), line({ taxRateId: TAX_NONE }), line({ taxRateId: UUID_B })],
      'USD',
      rates,
    );
    expect('taxRateId' in a!).toBe(false);
    expect(b!.taxRateId).toBeNull();
    expect(c!.taxRateId).toBe(UUID_B);
  });
  it('a removed rate goes as no tax (the editor makes the person pick one before issuing)', () => {
    expect(linesToInput([line({ taxRateId: TAX_SNAPSHOT })], 'USD', rates)[0]!.taxRateId).toBeNull();
  });
  it('line discount and HSN/SAC travel only when set', () => {
    const [x, y] = linesToInput(
      [line({ discountKind: 'percent', discount: '10', hsnSac: '998314' }), line({ discount: '0' })],
      'USD',
      rates,
    );
    expect(x).toMatchObject({ discount: { kind: 'percent', value: '10' }, hsnSac: '998314' });
    expect('discount' in y!).toBe(false);
    expect('hsnSac' in y!).toBe(false);
  });
});

describe('lineProblems', () => {
  it('a blank line has none', () => expect(lineProblems(emptyLine(), 'USD')).toEqual({}));
  it('flags the wrong values by field', () => {
    expect(lineProblems(line({ description: '' }), 'USD').description).toBe('descriptionRequired');
    expect(lineProblems(line({ qty: '0' }), 'USD').qty).toBe('qtyInvalid');
    expect(lineProblems(line({ qty: 'x' }), 'USD').qty).toBe('qtyInvalid');
    expect(lineProblems(line({ price: '1.2.3' }), 'USD').unitPrice).toBe('priceInvalid');
    expect(lineProblems(line({ discount: '150', discountKind: 'percent' }), 'USD').discount).toBe('lineDiscountInvalid');
    expect(lineProblems(line({ hsnSac: '1' }), 'USD').hsnSac).toBe('hsnInvalid');
  });
  it('asks for the HSN/SAC only where the country does', () => {
    expect(lineProblems(line(), 'INR', { requireHsn: true }).hsnSac).toBe('hsnRequired');
    expect(lineProblems(line(), 'USD').hsnSac).toBeUndefined();
  });
  it('a removed tax rate is a problem to settle', () => {
    expect(lineProblems(line({ taxRateId: TAX_SNAPSHOT }), 'USD').taxRateId).toBe('taxRateRemoved');
  });
});

describe('rateOfLine', () => {
  const rates = [rate({ id: UUID_A, isDefault: true }), rate({ id: UUID_B, isDefault: false })];
  it('default means the default active rate; none means no rate', () => {
    expect(rateOfLine(line(), rates)?.id).toBe(UUID_A);
    expect(rateOfLine(line({ taxRateId: TAX_NONE }), rates)).toBeNull();
    expect(rateOfLine(line({ taxRateId: UUID_B }), rates)?.id).toBe(UUID_B);
    expect(rateOfLine(line(), [rate({ isDefault: true, isActive: false })])).toBeNull();
  });
});

describe('the request body', () => {
  const rates = [rate({ id: UUID_A, isDefault: true })];
  it('is accepted by the create and the update contract', () => {
    const body = draftToBody(
      draftWith({ buyerName: 'Acme', buyerEmail: 'a@b.co', buyerCountry: 'in', buyerTaxId: '27AAPFU0939F1ZV', reference: 'PO-1', shipping: '5', lines: [line()] }),
      rates,
      'IN',
    );
    expect(createInvoiceSchema.safeParse(body).success).toBe(true);
    expect(updateInvoiceSchema.safeParse({ ...body, rowVersion: 3 }).success).toBe(true);
    expect(body.buyerCountry).toBe('IN');
    expect(body.shipping).toBe('5');
  });
  it('sends the document discount and the place of supply', () => {
    const body = draftToBody(
      draftWith({ taxMode: 'auto', buyerCountry: 'IN', placeRegion: 'ka', discountKind: 'percent', discountText: '10', lines: [line()] }),
      rates,
      'IN',
    );
    expect(body.discount).toEqual({ kind: 'percent', value: '10' });
    expect(body.placeOfSupply).toBe('IN-KA');
    expect(body.taxMode).toBe('auto');
  });
  it('leaves the owner out unless the draft has one', () => {
    expect('ownerId' in draftToBody(draftWith({ lines: [line()] }), rates)).toBe(false);
    expect(draftToBody(draftWith({ ownerId: UUID_B, lines: [line()] }), rates).ownerId).toBe(UUID_B);
  });
});

describe("live totals are computeInvoice's", () => {
  const vat = rate({ id: UUID_A, rate: '20' });
  const incl = rate({ id: UUID_B, name: 'Sales tax', rate: '10', inclusive: true });
  const rates = [vat, incl];
  const fixtures: Array<{ name: string; draft: InvoiceDraft; wire: Parameters<typeof computeInvoice>[0] }> = [
    {
      name: 'exclusive tax, line discount, shipping',
      draft: draftWith({
        shipping: '7.50',
        lines: [line({ qty: '3', price: '19.99', discount: '10', taxRateId: UUID_A }), line({ description: 'B', price: '5', taxRateId: TAX_NONE })],
      }),
      wire: {
        currency: 'USD',
        shipping: '7.50',
        lines: [
          { qty: '3', unitPrice: '19.99', discount: { kind: 'percent', value: '10' }, taxRate: '20', taxName: 'VAT' },
          { qty: '1', unitPrice: '5', taxRate: '0' },
        ],
      },
    },
    {
      name: 'inclusive tax and a document discount in amount',
      draft: draftWith({ discountKind: 'amount', discountText: '12.34', lines: [line({ qty: '2', price: '49.9', taxRateId: UUID_B })] }),
      wire: {
        currency: 'USD',
        discount: { kind: 'amount', value: '12.34' },
        lines: [{ qty: '2', unitPrice: '49.9', taxRate: '10', taxInclusive: true, taxName: 'Sales tax' }],
      },
    },
    {
      name: 'a zero-decimal currency and a percentage document discount',
      draft: draftWith({ currency: 'JPY', discountKind: 'percent', discountText: '12.5', lines: [line({ price: '1999', qty: '4', taxRateId: UUID_A })] }),
      wire: {
        currency: 'JPY',
        discount: { kind: 'percent', value: '12.5' },
        lines: [{ qty: '4', unitPrice: '1999', taxRate: '20', taxName: 'VAT' }],
      },
    },
  ];
  for (const f of fixtures) {
    it(f.name, () => {
      const direct = computeInvoice(f.wire);
      expect(direct.ok).toBe(true);
      if (!direct.ok) return;
      const r = direct.value.result;
      const p = pricingOf(f.draft, ctx(rates));
      expect(p.result.ok).toBe(true);
      const t = p.result.totals;
      expect(t.subtotalMinor).toBe(Number(r.subtotalMinor));
      expect(t.discountMinor).toBe(Number(r.discountMinor));
      expect(t.taxMinor).toBe(Number(r.taxMinor));
      expect(t.taxAddedMinor).toBe(Number(r.taxAddedMinor));
      expect(t.shippingMinor).toBe(Number(r.shippingMinor));
      expect(t.totalMinor).toBe(Number(r.totalMinor));
      expect(t.taxRows.map((g) => [g.inclusive, g.baseMinor, g.taxMinor])).toEqual(
        r.taxGroups.map((g) => [g.inclusive, Number(g.baseMinor), Number(g.taxMinor)]),
      );
    });
  }
});

describe('validation', () => {
  const rates = [rate({ isDefault: true })];
  const check = (d: InvoiceDraft, mode: 'draft' | 'issue') =>
    validateDraft(d, pricingOf(d, ctx(rates)), { mode, requireHsn: false, sellerCountry: 'IN' });
  it('a half-built draft saves; issuing needs a buyer and a total', () => {
    const half = draftWith({ lines: [line({ price: '' })] });
    expect(hasProblems(check(half, 'draft'))).toBe(false);
    const p = check(half, 'issue');
    expect(p.buyerName).toBe('contactRequired');
  });
  it('no invoice is kept without a line, a draft included', () => {
    expect(check(draftWith(), 'draft').lines).toBe('noLines');
    expect(check(draftWith(), 'issue').lines).toBe('noLines');
  });
  it('a zero total cannot be issued', () => {
    const d = draftWith({ buyerName: 'Acme', lines: [line({ price: '0' })] });
    expect(check(d, 'issue').lines).toBe('amountZero');
  });
  it('flags wrong values by path', () => {
    const d = draftWith({ buyerEmail: 'nope', issueDate: '2026-13-40', discountKind: 'percent', discountText: '120', lines: [line({ qty: '0' })] });
    const p = check(d, 'draft');
    expect(p.buyerEmail).toBe('emailInvalid');
    expect(p.issueDate).toBe('issueDateInvalid');
    expect(p.discount).toBe('discountInvalid');
    expect(p['lines.0.qty']).toBe('qtyInvalid');
  });
  it('a due date before the issue date is wrong', () => {
    expect(check(draftWith({ issueDate: '2026-10-10', dueDate: '2026-10-01' }), 'draft').dueDate).toBe('dueBeforeIssue');
    // a draft made from a sales order or a schedule has no issue date yet; that is fine, issuing dates it
    expect(check(draftWith({ issueDate: '' }), 'draft').issueDate).toBeUndefined();
  });
  it('a buyer tax id that fails its checksum never blocks a save', () => {
    const d = draftWith({ buyerName: 'Acme', buyerCountry: 'IN', buyerTaxId: '27AAPFU0939F1ZX', lines: [line()] });
    expect(hasProblems(check(d, 'issue'))).toBe(false);
  });
  it('automatic tax needs the seller country', () => {
    const d = draftWith({ taxMode: 'auto', lines: [line()] });
    const noCountry = pricingOf(d, { rates, profile: { ...profile, sellerCountry: null }, today: '2026-10-02' });
    expect(validateDraft(d, noCountry, { mode: 'draft', requireHsn: false, sellerCountry: null }).taxMode).toBe('autoNeedsSellerCountry');
  });
  it('HSN/SAC is required to issue where the country asks, not to save a draft', () => {
    const d = draftWith({ buyerName: 'Acme', lines: [line()] });
    const pr = pricingOf(d, ctx(rates));
    expect(validateDraft(d, pr, { mode: 'issue', requireHsn: true, sellerCountry: 'IN' })['lines.0.hsnSac']).toBe('hsnRequired');
    expect(validateDraft(d, pr, { mode: 'draft', requireHsn: true, sellerCountry: 'IN' })['lines.0.hsnSac']).toBeUndefined();
  });
});

describe('paths of blank lines', () => {
  it('computeInvoice issues map back onto the draft lines', () => {
    const lines = [emptyLine(), line({ price: '10.999' })];
    expect(usedIndexes(lines)).toEqual([1]);
    const d = draftWith({ lines });
    const p = pricingOf(d, ctx([]));
    expect(p.result.ok).toBe(false);
    expect(issuesToProblems(p.result.issues, p.used)).toEqual({ 'lines.1.unitPrice': 'priceInvalid' });
    expect(serverPath('lines.0.taxRateId', p.used)).toBe('lines.1.taxRateId');
    expect(serverPath('discount', p.used)).toBe('discount');
  });
});

describe('automatic tax in the form', () => {
  it('prices CGST and SGST inside the seller state and says why', () => {
    const d = draftWith({ taxMode: 'auto', supplyType: 'goods', buyerCountry: 'IN', placeRegion: 'MH', lines: [line({ price: '1000' })] });
    const p = pricingOf(d, ctx([]));
    expect(p.auto?.ok).toBe(true);
    expect(p.result.ok).toBe(true);
    const t = p.result.totals;
    expect(t.taxRows.map((r) => r.name)).toEqual(['CGST 9%', 'SGST 9%']);
    expect(t.taxMinor).toBe(18000);
    expect(t.totalMinor).toBe(118000);
    if (p.auto?.ok) expect(p.auto.preview.reasons.length).toBeGreaterThan(0);
  });
  it('prices IGST across states', () => {
    const d = draftWith({ taxMode: 'auto', supplyType: 'goods', buyerCountry: 'IN', placeRegion: 'KA', lines: [line({ price: '1000' })] });
    const t = pricingOf(d, ctx([])).result.totals;
    expect(t.taxRows.map((r) => taxLabel(r.name, r.ratePercent))).toEqual(['IGST 18%']);
  });
  it('a rate with components prices as its parts', () => {
    const gst = rate({ id: UUID_A, name: 'GST 18%', rate: '18', components: [{ type: 'CGST', rate: '9' }, { type: 'SGST', rate: '9' }] });
    const p = pricingOf(draftWith({ lines: [line({ price: '1000', taxRateId: UUID_A })] }), ctx([gst]));
    expect(p.result.totals.taxRows.map((r) => r.name)).toEqual(['CGST 9%', 'SGST 9%']);
    expect(p.result.totals.totalMinor).toBe(118000);
  });
  it('reverse charge drops the tax', () => {
    const vat = rate({ id: UUID_A, isDefault: true });
    const t = pricingOf(draftWith({ reverseCharge: true, lines: [line()] }), ctx([vat])).result.totals;
    expect(t.taxMinor).toBe(0);
    expect(t.totalMinor).toBe(10000);
  });
});

const invoiceFixture = (over: Partial<InvoiceResponse> = {}): InvoiceResponse =>
  ({
    id: UUID_A,
    number: null,
    docType: 'tax_invoice',
    source: 'manual',
    status: 'draft',
    storedStatus: 'draft',
    paymentStatus: 'unpaid',
    overdue: false,
    daysOverdue: null,
    currency: 'USD',
    currencyExponent: 2,
    amounts: { subtotal: '100.00', discount: '0.00', shipping: '5.00', tax: '20.00', taxAdded: '20.00', total: '125.00', paid: '0.00', refunded: '0.00', balance: '125.00', credit: '0.00', credited: '0.00' },
    amountsMinor: { subtotal: '10000', discount: '0', shipping: '500', tax: '2000', taxAdded: '2000', total: '12500', paid: '0', refunded: '0', balance: '12500', credit: '0', credited: '0' },
    buyerName: 'Acme',
    buyerEmail: 'a@b.co',
    contact: { id: UUID_B, name: 'Acme Ltd' },
    company: null,
    deal: null,
    owner: { id: UUID_B, name: 'Me' },
    issueDate: '2026-10-02',
    dueDate: '2026-10-16',
    issuedAt: null,
    paidAt: null,
    sentAt: null,
    viewCount: 0,
    reference: 'PO-9',
    rowVersion: 4,
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    buyer: { name: 'Acme', email: 'a@b.co', phone: null, address: null, taxId: '27AAPFU0939F1ZV', country: 'IN' },
    seller: null,
    taxRegime: 'none',
    placeOfSupply: 'IN-MH',
    reverseCharge: false,
    legalNotes: null,
    taxExplanation: { reasons: ['r'], warnings: [], documentNotes: [], taxFree: false },
    discount: { kind: 'percent', value: '10' },
    notes: null,
    terms: 'T',
    lines: [
      {
        id: UUID_A,
        position: 0,
        description: 'Design',
        sku: null,
        hsnSac: '998314',
        qty: '2.0000',
        unitPrice: '50.00',
        discount: { kind: 'amount', value: '1.00' },
        taxRateId: null,
        taxName: 'GST 18%',
        taxType: 'gst',
        taxRate: '18',
        taxInclusive: false,
        taxComponents: null,
        amounts: { gross: '100.00', discount: '1.00', net: '99.00', docDiscountShare: '9.90', tax: '16.04', total: '105.14' },
      },
    ],
    taxSummary: [],
    quote: null,
    createdBy: null,
    publicLink: null,
    deliveryChannel: null,
    firstViewedAt: null,
    lastViewedAt: null,
    voidedAt: null,
    voidReason: null,
    ...over,
  }) as InvoiceResponse;

describe('a saved draft as a working copy', () => {
  it('reads the response into typed boxes', () => {
    const d = draftOf(invoiceFixture());
    expect(d).toMatchObject({
      contactId: UUID_B,
      ownerId: UUID_B,
      buyerName: 'Acme',
      buyerTaxId: '27AAPFU0939F1ZV',
      buyerCountry: 'IN',
      placeRegion: 'MH',
      taxMode: 'auto',
      reference: 'PO-9',
      shipping: '5.00',
      discountKind: 'percent',
      discountText: '10',
    });
    expect(d.lines[0]).toMatchObject({ qty: '2', price: '50.00', discountKind: 'amount', discount: '1.00', hsnSac: '998314' });
  });
  it('a line whose rate is gone keeps its tax until the person picks another', () => {
    const d = draftOf(invoiceFixture({ taxExplanation: null }));
    expect(d.taxMode).toBe('rates');
    expect(d.lines[0]!.taxRateId).toBe(TAX_SNAPSHOT);
    expect(d.lines[0]!.taxSnapshot).toMatchObject({ name: 'GST 18%', rate: '18' });
  });
  it('a line with a rate points at it; an untaxed one is "no tax"', () => {
    const base = invoiceFixture({ taxExplanation: null });
    const withRate = draftOf({ ...base, lines: [{ ...base.lines[0]!, taxRateId: UUID_A }] });
    expect(withRate.lines[0]!.taxRateId).toBe(UUID_A);
    const none = draftOf({ ...base, lines: [{ ...base.lines[0]!, taxName: null, taxRate: '0' }] });
    expect(none.lines[0]!.taxRateId).toBe(TAX_NONE);
  });
  it('round trips: the body of an unchanged draft is a valid update', () => {
    const rates = [rate({ id: UUID_A })];
    const d = draftOf(invoiceFixture({ taxExplanation: null, lines: [{ ...invoiceFixture().lines[0]!, taxRateId: UUID_A }] }));
    const body = draftToBody(d, rates, 'IN');
    expect(updateInvoiceSchema.safeParse({ ...body, rowVersion: 4 }).success).toBe(true);
  });
});

describe('small helpers', () => {
  it('isBlankLine', () => {
    expect(isBlankLine(emptyLine())).toBe(true);
    expect(isBlankLine(line())).toBe(false);
  });
  it('isSameDraft ignores line keys', () => {
    const a = draftWith();
    const b = { ...a, lines: a.lines.map((l) => ({ ...l, key: 'other' })) };
    expect(isSameDraft(a, b)).toBe(true);
    expect(isSameDraft(a, { ...a, notes: 'x' })).toBe(false);
  });
  it('withContact fills the buyer and clears it', () => {
    const d = withContact(draftWith(), { id: UUID_B, label: 'Ann', email: 'ann@x.co', phone: '+1' });
    expect(d).toMatchObject({ contactId: UUID_B, buyerName: 'Ann', buyerEmail: 'ann@x.co' });
    expect(withContact(d, null).contactId).toBeNull();
  });
});
