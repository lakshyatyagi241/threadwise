import type { SalesOrderResponse, SalesOrderSummary, TaxRateResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { emptyLine } from './builder';
import {
  buildCreateInput,
  buildFulfilPayload,
  buildInvoicePayload,
  buildUpdateInput,
  checkQty,
  defaultQty,
  draftLineOf,
  draftOfOrder,
  emptyFulfilForm,
  emptyInvoiceForm,
  emptyOrderDraft,
  fulfilFormProblems,
  invoiceFormProblems,
  invoiceTarget,
  lineFacts,
  linesChanged,
  linkedInvoiceStatus,
  liveOrderForQuote,
  orderFacts,
  parseSalesOrderFilters,
  progressPercent,
  quoteHref,
  quoteHrefGuess,
  salesOrderActions,
  salesOrderFiltersToSearch,
  salesOrderListQuery,
  salesOrderTabCount,
  validateOrderDraft,
} from './sales-orders';

type Line = SalesOrderResponse['lines'][number];
const line = (over: Partial<Line> = {}): Line => ({
  id: '11111111-1111-4111-8111-111111111111',
  position: 0,
  description: 'Chair',
  sku: null,
  hsnSac: null,
  qty: '10',
  qtyInvoiced: '4',
  qtyFulfilled: '10',
  qtyToInvoice: '6',
  unitPrice: '30.00',
  taxName: null,
  taxRate: '0',
  taxInclusive: false,
  amounts: { net: '300.00', tax: '0.00', total: '300.00' },
  ...over,
});
const L1 = line();
const L2 = line({
  id: '22222222-2222-4222-8222-222222222222',
  description: 'Desk',
  qty: '2',
  qtyInvoiced: '0',
  qtyFulfilled: '1',
  unitPrice: '200.00',
  amounts: { net: '400.00', tax: '0.00', total: '400.00' },
});

describe('quantity math', () => {
  it('uses integer math with four decimals', () => {
    expect(progressPercent(1n, 3n)).toBe(33);
    expect(progressPercent(2n, 3n)).toBe(66);
    expect(progressPercent(3n, 3n)).toBe(100);
    expect(progressPercent(0n, 3n)).toBe(0);
    expect(progressPercent(5n, 0n)).toBe(0);
    // 0.1 + 0.2 style traps do not exist: 0.3 of 0.3 is exactly done
    expect(lineFacts(line({ qty: '0.3', qtyInvoiced: '0.3' })).invoicedPct).toBe(100);
    expect(lineFacts(line({ qty: '0.0003', qtyInvoiced: '0.0001' })).invoicedPct).toBe(33);
  });

  it('never rounds a bar up to done', () => {
    expect(progressPercent(99_999n, 100_000n)).toBe(99);
  });

  it('reads a line and a whole order', () => {
    const f = lineFacts(L1);
    expect(f.toInvoice).toBe(60_000n);
    expect(f.toFulfil).toBe(0n);
    expect(f.invoicedPct).toBe(40);
    expect(f.fulfilledPct).toBe(100);
    const all = orderFacts([L1, L2]);
    expect(all.ordered).toBe(120_000n);
    expect(all.invoiced).toBe(40_000n);
    expect(all.toInvoice).toBe(80_000n);
    expect(all.fulfilled).toBe(110_000n);
  });

  it('never reports a negative amount left', () => {
    expect(lineFacts(line({ qty: '2', qtyInvoiced: '3' })).toInvoice).toBe(0n);
  });

  it('checks a typed quantity against what is left', () => {
    expect(checkQty('', 60_000n)).toEqual({ ok: true, scaled: 0n, qty: '0' });
    expect(checkQty('0', 60_000n)).toMatchObject({ ok: true, scaled: 0n });
    expect(checkQty('2,5', 60_000n)).toEqual({ ok: true, scaled: 25_000n, qty: '2.5' });
    expect(checkQty('6', 60_000n)).toMatchObject({ ok: true, scaled: 60_000n });
    expect(checkQty('6.0001', 60_000n)).toEqual({ ok: false, reason: 'exceeds' });
    expect(checkQty('1.12345', 60_000n)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkQty('abc', 60_000n)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkQty('-1', 60_000n)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('invoice payload', () => {
  it('bills everything left with all: true', () => {
    const p = buildInvoicePayload(emptyInvoiceForm(true), [L1, L2], { shippingPending: true });
    expect(p).toEqual({ all: true, issue: false, includeShipping: true });
  });

  it('leaves shipping out once it was billed, whatever the box says', () => {
    const p = buildInvoicePayload({ ...emptyInvoiceForm(true), includeShipping: true }, [L1], {
      shippingPending: false,
    });
    expect(p.includeShipping).toBe(false);
  });

  it('defaults each line to what is left and drops zero lines', () => {
    const p = buildInvoicePayload(
      { ...emptyInvoiceForm(false), mode: 'lines', qty: { [L2.id]: '0' } },
      [L1, L2],
      { shippingPending: false },
    );
    expect(p).toEqual({
      all: false,
      issue: false,
      includeShipping: false,
      lines: [{ lineId: L1.id, qty: '6' }],
    });
  });

  it('sends a partial quantity', () => {
    const p = buildInvoicePayload(
      { ...emptyInvoiceForm(false), mode: 'lines', qty: { [L1.id]: '2.5', [L2.id]: '' } },
      [L1, L2],
      { shippingPending: false },
    );
    expect(p.lines).toEqual([{ lineId: L1.id, qty: '2.5' }]);
  });

  it('carries dates, terms and issue-now', () => {
    const p = buildInvoicePayload(
      { ...emptyInvoiceForm(false), issue: true, issueDate: '2026-10-05', termsDays: '30' },
      [L1],
      { shippingPending: false },
    );
    expect(p).toMatchObject({ issue: true, issueDate: '2026-10-05', paymentTermsDays: 30 });
    const q = buildInvoicePayload(
      { ...emptyInvoiceForm(false), dueDate: '2026-11-01', termsDays: '30' },
      [L1],
      { shippingPending: false },
    );
    expect(q).toMatchObject({ dueDate: '2026-11-01' });
    expect(q).not.toHaveProperty('paymentTermsDays');
  });

  it('refuses more than is left, bad quantities, nothing chosen and bad dates', () => {
    const over = invoiceFormProblems(
      { ...emptyInvoiceForm(false), mode: 'lines', qty: { [L1.id]: '7' } },
      [L1, L2],
    );
    expect(over.lines[L1.id]).toBe('qtyExceeds');
    const bad = invoiceFormProblems(
      { ...emptyInvoiceForm(false), mode: 'lines', qty: { [L1.id]: 'x' } },
      [L1],
    );
    expect(bad.lines[L1.id]).toBe('qtyInvalid');
    const none = invoiceFormProblems(
      { ...emptyInvoiceForm(false), mode: 'lines', qty: { [L1.id]: '0', [L2.id]: '0' } },
      [L1, L2],
    );
    expect(none.form).toContain('nothing');
    const done = invoiceFormProblems(emptyInvoiceForm(false), [line({ qtyInvoiced: '10' })]);
    expect(done.form).toContain('nothing');
    const dates = invoiceFormProblems(
      { ...emptyInvoiceForm(false), issueDate: '2026-10-10', dueDate: '2026-10-01' },
      [L1],
    );
    expect(dates.form).toContain('dueBeforeIssue');
    expect(
      invoiceFormProblems({ ...emptyInvoiceForm(false), issueDate: 'soon' }, [L1]).form,
    ).toContain('issueDateInvalid');
  });

  it('proposes the quantity that is left', () => {
    expect(defaultQty(L1, 'invoice')).toBe('6');
    expect(defaultQty(L1, 'fulfil')).toBe('0');
    expect(defaultQty(L2, 'fulfil')).toBe('1');
  });
});

describe('fulfil payload', () => {
  it('records all, or the lines named, with a trimmed note', () => {
    expect(buildFulfilPayload({ ...emptyFulfilForm(), note: '  DN-7 ' }, [L2])).toEqual({
      all: true,
      note: 'DN-7',
    });
    expect(
      buildFulfilPayload({ mode: 'lines', qty: { [L2.id]: '0.5' }, note: '' }, [L1, L2]),
    ).toEqual({
      all: false,
      lines: [{ lineId: L2.id, qty: '0.5' }],
    });
  });
  it('refuses a delivery above what is left or nothing at all', () => {
    expect(
      fulfilFormProblems({ mode: 'lines', qty: { [L2.id]: '2' }, note: '' }, [L2]).lines[L2.id],
    ).toBe('qtyExceeds');
    expect(fulfilFormProblems(emptyFulfilForm(), [L1]).form).toContain('nothing');
    expect(
      fulfilFormProblems({ ...emptyFulfilForm(), note: 'x'.repeat(501) }, [L2]).form,
    ).toContain('noteTooLong');
  });
});

describe('list state', () => {
  it('reads and writes the address', () => {
    const f = parseSalesOrderFilters(
      new URLSearchParams('tab=confirmed&quick=toInvoice&q=chair&contact=nope'),
    );
    expect(f).toEqual({ tab: 'confirmed', quick: 'toInvoice', q: 'chair', contactId: '' });
    expect(salesOrderFiltersToSearch(f)).toBe('?tab=confirmed&quick=toInvoice&q=chair');
    expect(salesOrderFiltersToSearch({ tab: 'all', quick: '', q: '', contactId: '' })).toBe('');
    expect(parseSalesOrderFilters(new URLSearchParams('tab=weird&quick=x')).tab).toBe('all');
  });

  it('builds the query: a quick filter pins confirmed', () => {
    expect(salesOrderListQuery({ tab: 'draft', quick: '', q: ' a ', contactId: '' })).toEqual({
      q: 'a',
      contactId: undefined,
      status: 'draft',
    });
    expect(
      salesOrderListQuery({ tab: 'all', quick: 'toInvoice', q: '', contactId: '' }),
    ).toMatchObject({
      status: 'confirmed',
      invoicingStatus: 'not_invoiced,partially_invoiced',
    });
    expect(
      salesOrderListQuery({ tab: 'draft', quick: 'toFulfil', q: '', contactId: '' }),
    ).toMatchObject({
      status: 'confirmed',
      fulfilmentStatus: 'unfulfilled,partially_fulfilled',
    });
  });

  it('reads counts', () => {
    const counts = {
      all: 5,
      draft: 1,
      confirmed: 3,
      cancelled: 0,
      closed: 1,
      toInvoice: 2,
      toFulfil: 1,
      openValue: [],
    };
    expect(salesOrderTabCount(counts, 'confirmed')).toBe(3);
    expect(salesOrderTabCount(counts, 'toInvoice')).toBe(2);
    expect(salesOrderTabCount(undefined, 'all')).toBeUndefined();
  });
});

describe('what an order offers', () => {
  const all = { updateSalesOrder: true, invoiceSalesOrder: true, deleteSalesOrder: true };
  const base = { invoicingStatus: 'not_invoiced', fulfilmentStatus: 'unfulfilled' } as const;
  it('draft: edit, confirm, delete', () => {
    expect([...salesOrderActions({ ...base, status: 'draft' }, all)].sort()).toEqual([
      'confirm',
      'delete',
      'edit',
      'open',
    ]);
  });
  it('confirmed: invoice, fulfil, cancel while something is left', () => {
    expect([...salesOrderActions({ ...base, status: 'confirmed' }, all)].sort()).toEqual([
      'cancel',
      'fulfil',
      'invoice',
      'open',
    ]);
    const done = salesOrderActions(
      { status: 'confirmed', invoicingStatus: 'invoiced', fulfilmentStatus: 'fulfilled' },
      all,
    );
    expect(done.has('invoice')).toBe(false);
    expect(done.has('fulfil')).toBe(false);
  });
  it('cancelled and closed offer only open', () => {
    expect([...salesOrderActions({ ...base, status: 'cancelled' }, all)]).toEqual(['open']);
    expect([...salesOrderActions({ ...base, status: 'closed' }, all)]).toEqual(['open']);
  });
  it('follows the permissions', () => {
    const none = { updateSalesOrder: false, invoiceSalesOrder: false, deleteSalesOrder: false };
    expect([...salesOrderActions({ ...base, status: 'draft' }, none)]).toEqual(['open']);
    expect(
      [
        ...salesOrderActions(
          { ...base, status: 'confirmed' },
          { ...none, invoiceSalesOrder: true },
        ),
      ].sort(),
    ).toEqual(['invoice', 'open']);
  });
  it('works on a list row', () => {
    const s = {
      id: 'a',
      number: 'SO-1',
      status: 'confirmed',
      invoicingStatus: 'invoiced',
      fulfilmentStatus: 'fulfilled',
    } as SalesOrderSummary;
    expect(salesOrderActions(s, all).has('invoice')).toBe(false);
  });
});

describe('links and statuses', () => {
  it('maps an invoice status as the order sends it', () => {
    expect(linkedInvoiceStatus('unpaid')).toBe('issued');
    expect(linkedInvoiceStatus('partially_paid')).toBe('partially_paid');
    expect(linkedInvoiceStatus('void')).toBe('void');
    expect(linkedInvoiceStatus('draft')).toBe('draft');
  });
  it('sends a draft invoice to its editor and an issued one to its page', () => {
    expect(invoiceTarget({ id: 'a', status: 'draft' })).toBe('/invoices/a/edit');
    expect(invoiceTarget({ id: 'a', status: 'issued' })).toBe('/invoices/a');
  });
  it('guesses the offer kind from its number', () => {
    expect(quoteHrefGuess({ id: 'x', number: 'EST-0001' })).toBe('/estimates/x');
    expect(quoteHrefGuess({ id: 'x', number: 'PRO-0001' })).toBe('/proposals/x');
  });
  it('links an offer by its kind, and only guesses when the kind is not known', () => {
    expect(quoteHref({ id: 'x', number: 'QUOTE-9', kind: 'estimate' })).toBe('/estimates/x');
    expect(quoteHref({ id: 'x', number: 'EST-0001', kind: 'proposal' })).toBe('/proposals/x');
    expect(quoteHref({ id: 'x', number: 'EST-0001' })).toBe('/estimates/x');
  });
  it('finds the live order of an offer', () => {
    const orders = [
      { id: '1', quote: { id: 'q' }, status: 'cancelled' as const },
      { id: '2', quote: { id: 'q' }, status: 'confirmed' as const },
    ];
    expect(liveOrderForQuote(orders, 'q')?.id).toBe('2');
    expect(liveOrderForQuote(orders, 'other')).toBeUndefined();
  });
});

const rate = (over: Partial<TaxRateResponse> = {}): TaxRateResponse =>
  ({
    id: 'r1',
    name: 'GST',
    type: 'gst',
    rate: '18',
    inclusive: false,
    isDefault: true,
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
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as TaxRateResponse;

const order = (): SalesOrderResponse =>
  ({
    id: 'o',
    number: 'SO-1',
    status: 'draft',
    invoicingStatus: 'not_invoiced',
    fulfilmentStatus: 'unfulfilled',
    buyerName: 'Order Co',
    contact: null,
    deal: null,
    quote: null,
    owner: null,
    currency: 'USD',
    total: '710.00',
    totalMinor: '71000',
    expectedDate: null,
    reference: null,
    invoiceCount: 0,
    rowVersion: 3,
    createdAt: '2026-10-02T04:56:45.201Z',
    buyer: { name: 'Order Co', email: null, phone: null },
    amounts: {
      subtotal: '700.00',
      discount: '0.00',
      shipping: '10.00',
      tax: '0.00',
      total: '710.00',
    },
    shippingInvoiced: false,
    notes: null,
    terms: null,
    lines: [L1, L2],
    invoices: [],
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
  }) as SalesOrderResponse;

describe('the builder form', () => {
  it('needs a buyer, lines and sane values for a blank order', () => {
    const d = emptyOrderDraft('USD');
    const p = validateOrderDraft(d, { creating: true });
    expect(p.fields.buyer).toBe('buyerRequired');
    expect(p.list).toBe('noLines');
    const ok = {
      ...d,
      buyerName: 'Acme',
      lines: [{ ...emptyLine(), description: 'Chair', price: '30' }],
    };
    expect(validateOrderDraft(ok, { creating: true })).toEqual({ fields: {}, lines: {} });
    expect(
      validateOrderDraft(
        { ...ok, buyerEmail: 'nope', currency: 'US', expectedDate: '5/6', shipping: '1.2.3' },
        { creating: true },
      ).fields,
    ).toEqual({
      email: 'emailInvalid',
      currency: 'currencyInvalid',
      expectedDate: 'expectedDateInvalid',
      shipping: 'shippingInvalid',
    });
  });

  it('an order from an offer needs neither buyer nor lines', () => {
    const d = { ...emptyOrderDraft('USD'), quoteId: '33333333-3333-4333-8333-333333333333' };
    expect(validateOrderDraft(d, { creating: true })).toEqual({ fields: {}, lines: {} });
  });

  it('checks lines of an edit only when they were touched', () => {
    const d = {
      ...emptyOrderDraft('USD'),
      buyerName: 'A',
      lines: [{ ...emptyLine('snapshot'), description: 'Old', price: '5' }],
    };
    expect(validateOrderDraft(d, { creating: false, linesTouched: false }).lines).toEqual({});
    expect(validateOrderDraft(d, { creating: false, linesTouched: true }).lines).toEqual({
      'lines.0.taxRateId': 'taxRateRemoved',
    });
  });

  it('builds the create body from scratch: lines as decimal strings, currency upper case', () => {
    const d = {
      ...emptyOrderDraft('usd'),
      buyerName: ' Acme ',
      shipping: '10',
      lines: [{ ...emptyLine(), description: 'Chair', qty: '1,5', price: '30.5' }, emptyLine()],
    };
    expect(buildCreateInput(d, [rate()])).toEqual({
      buyerName: 'Acme',
      currency: 'USD',
      shipping: '10',
      lines: [{ description: 'Chair', qty: '1.5', unitPrice: '30.5' }],
    });
  });

  it('builds the create body from an offer: no lines, no currency', () => {
    const d = {
      ...emptyOrderDraft('USD'),
      quoteId: '33333333-3333-4333-8333-333333333333',
      reference: 'PO-9',
      expectedDate: '2026-11-01',
    };
    expect(buildCreateInput(d, [])).toEqual({
      quoteId: d.quoteId,
      reference: 'PO-9',
      expectedDate: '2026-11-01',
    });
  });

  it('an edit sends the header always and lines/shipping only when changed', () => {
    const initial = draftOfOrder(order(), []);
    expect(initial.shipping).toBe('10.00');
    expect(initial.lines).toHaveLength(2);
    const untouched = buildUpdateInput({ ...initial, notes: 'hi' }, initial, []);
    expect(untouched).toMatchObject({
      notes: 'hi',
      buyerName: 'Order Co',
      contactId: null,
      reference: null,
    });
    expect(untouched).not.toHaveProperty('lines');
    expect(untouched).not.toHaveProperty('shipping');
    const changed = {
      ...initial,
      shipping: '',
      lines: initial.lines.map((l, i) => (i === 0 ? { ...l, qty: '12' } : l)),
    };
    expect(linesChanged(changed, initial)).toBe(true);
    const out = buildUpdateInput(changed, initial, []);
    expect(out.shipping).toBeNull();
    expect(out.lines).toHaveLength(2);
    expect(out.lines?.[0]).toMatchObject({ description: 'Chair', qty: '12', unitPrice: '30.00' });
  });
});

describe('a saved line as an editable one', () => {
  it('matches a current tax rate by name, percent and inclusivity', () => {
    const l = line({
      taxName: 'GST',
      taxRate: '18',
      amounts: { net: '300.00', tax: '54.00', total: '354.00' },
    });
    expect(draftLineOf(l, 'USD', [rate({ id: 'other', name: 'VAT' }), rate()]).taxRateId).toBe(
      'r1',
    );
  });
  it('keeps a removed rate as a snapshot, and no tax as none', () => {
    const l = line({
      taxName: 'Old',
      taxRate: '7.5',
      amounts: { net: '300.00', tax: '22.50', total: '322.50' },
    });
    const d = draftLineOf(l, 'USD', [rate()]);
    expect(d.taxRateId).toBe('snapshot');
    expect(d.taxSnapshot).toMatchObject({ name: 'Old', rate: '7.5' });
    expect(draftLineOf(line(), 'USD', [rate()]).taxRateId).toBe('none');
  });
  it('recovers a line discount from the amount between gross and net', () => {
    const l = line({
      qty: '2',
      unitPrice: '50.00',
      amounts: { net: '90.00', tax: '0.00', total: '90.00' },
    });
    const d = draftLineOf(l, 'USD', []);
    expect(d.discountKind).toBe('amount');
    expect(d.discount).toBe('10.00');
    expect(draftLineOf(line(), 'USD', []).discount).toBe('');
  });
  it('reads an inclusive-tax line without inventing a discount', () => {
    const l = line({
      qty: '1',
      unitPrice: '118.00',
      taxName: 'GST',
      taxRate: '18',
      taxInclusive: true,
      amounts: { net: '100.00', tax: '18.00', total: '118.00' },
    });
    expect(draftLineOf(l, 'USD', []).discount).toBe('');
  });
});
