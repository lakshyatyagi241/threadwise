import { describe, expect, it } from 'vitest';
import {
  CREDIT_NOTE_REASONS,
  type CreditNoteResponse,
  InvoiceLineResponse,
  TaxRateResponse,
} from '@crm/contracts';
import {
  buildCreatePayload,
  buildUpdatePayload,
  checkCreditQty,
  CREDIT_REASON_ORDER,
  creditAmount,
  creditedByLine,
  creditFiltersToSearch,
  creditLineUnitMinor,
  creditListQuery,
  creditNoteActions,
  emptyForm,
  estimateCredit,
  formProblems,
  formFromCreditNote,
  lineRemaining,
  moneyEffect,
  normalizeAmount,
  parseCreditFilters,
  type CreditForm,
  type InvoiceFacts,
} from './credit-notes';

const line = (id: string, over: Partial<InvoiceLineResponse> = {}): InvoiceLineResponse => ({
  id,
  position: 0,
  description: 'Widget',
  sku: null,
  hsnSac: null,
  qty: '4',
  unitPrice: '25.00',
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
  ...over,
});

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';

const taxed = line(L2, {
  description: 'Service',
  qty: '1',
  unitPrice: '100.00',
  taxName: 'VAT',
  taxRate: '18',
  amounts: {
    gross: '100.00',
    discount: '0.00',
    net: '100.00',
    docDiscountShare: '0.00',
    tax: '18.00',
    total: '118.00',
  },
});

const inv = (lines = [line(L1), taxed]): InvoiceFacts => ({
  id: '99999999-9999-4999-8999-999999999999',
  currency: 'USD',
  lines,
  creditableMinor: 31_800n,
  shippingMinor: 0n,
});

const note = (over: Partial<CreditNoteResponse>): CreditNoteResponse =>
  ({
    id: 'n1',
    status: 'issued',
    currency: 'USD',
    lines: [],
    ...over,
  }) as unknown as CreditNoteResponse;

const issuedOne = note({
  lines: [
    {
      id: 'x',
      position: 0,
      invoiceLineId: L1,
      description: 'Widget (credit)',
      hsnSac: null,
      qty: '1',
      unitPrice: '25.00',
      taxName: null,
      taxRate: '0',
      taxInclusive: false,
      amounts: { net: '25.00', tax: '0.00', total: '25.00' },
    },
  ],
});

describe('remaining quantity (decimal strings, 4 decimals)', () => {
  it('is the line quantity less what issued credit notes took', () => {
    const credited = creditedByLine([issuedOne]);
    const r = lineRemaining(line(L1), credited.get(L1), 'USD');
    expect(r.qtyScaled).toBe(30_000n); // 3
    expect(r.amountMinor).toBe(7_500n);
    expect(r.done).toBe(false);
  });

  it('ignores draft and void credit notes, and the note being edited', () => {
    expect(
      creditedByLine([
        { ...issuedOne, status: 'draft' },
        { ...issuedOne, status: 'void' },
      ]).size,
    ).toBe(0);
    expect(creditedByLine([issuedOne], 'n1').size).toBe(0);
  });

  it('is done when everything was credited', () => {
    const all = note({
      lines: [
        {
          ...issuedOne.lines[0]!,
          qty: '4',
          amounts: { net: '100.00', tax: '0.00', total: '100.00' },
        },
      ],
    });
    expect(lineRemaining(line(L1), creditedByLine([all]).get(L1), 'USD').done).toBe(true);
  });

  it('checks a typed quantity against what is left without floats', () => {
    expect(checkCreditQty('', 30_000n)).toEqual({ ok: true, qtyScaled: 30_000n, qty: '3' });
    expect(checkCreditQty('1,5', 30_000n)).toEqual({ ok: true, qtyScaled: 15_000n, qty: '1.5' });
    expect(checkCreditQty('2.9999', 30_000n)).toMatchObject({ ok: true, qty: '2.9999' });
    expect(checkCreditQty('3.0001', 30_000n)).toEqual({ ok: false, reason: 'exceeds' });
    expect(checkCreditQty('0', 30_000n)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkCreditQty('abc', 30_000n)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkCreditQty('1.23456', 30_000n)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('credits in proportion, and the last part takes what is left', () => {
    const r = lineRemaining(
      line(L1, {
        qty: '3',
        amounts: {
          gross: '100.00',
          discount: '0.00',
          net: '100.00',
          docDiscountShare: '0.00',
          tax: '0.00',
          total: '100.00',
        },
      }),
      undefined,
      'USD',
    );
    expect(creditAmount(r, 10_000n)).toBe(3_333n); // 1 of 3
    expect(creditAmount(r, 30_000n)).toBe(10_000n); // all
    const after = lineRemaining(
      line(L1, {
        qty: '3',
        amounts: {
          gross: '100.00',
          discount: '0.00',
          net: '100.00',
          docDiscountShare: '0.00',
          tax: '0.00',
          total: '100.00',
        },
      }),
      { qtyScaled: 20_000n, amountMinor: 6_666n },
      'USD',
    );
    expect(creditAmount(after, after.qtyScaled)).toBe(3_334n); // the last third takes the cent that is left
  });

  it('works in a currency with no decimals', () => {
    const r = lineRemaining(
      line(L1, {
        qty: '3',
        amounts: {
          gross: '1000',
          discount: '0',
          net: '1000',
          docDiscountShare: '0',
          tax: '0',
          total: '1000',
        },
      }),
      undefined,
      'JPY',
    );
    expect(creditAmount(r, 10_000n)).toBe(333n);
  });
});

describe('the payload', () => {
  const form: CreditForm = {
    ...emptyForm('99999999-9999-4999-8999-999999999999'),
    reason: 'goodwill',
    note: '  sorry  ',
    settlement: 'refund',
    issueDate: '2026-10-02',
  };

  it('full: only the flag, no lines', () => {
    expect(buildCreatePayload(form, inv(), new Map())).toEqual({
      invoiceId: '99999999-9999-4999-8999-999999999999',
      reason: 'goodwill',
      note: 'sorry',
      settlement: 'refund',
      issueDate: '2026-10-02',
      full: true,
    });
  });

  it('per line: chosen lines with their quantity, free-form lines with an optional tax rate', () => {
    const f: CreditForm = {
      ...form,
      mode: 'lines',
      issueDate: '',
      note: '',
      choices: { [L1]: { checked: true, qty: '2' }, [L2]: { checked: false, qty: '' } },
      free: [
        { key: 'a', description: ' Goodwill ', amount: '10,5', taxRateId: 'rate-1' },
        { key: 'b', description: '', amount: '', taxRateId: '' },
      ],
    };
    const p = buildCreatePayload(f, inv(), new Map());
    expect(p.full).toBe(false);
    expect(p.note).toBeNull();
    expect(p.issueDate).toBeNull();
    expect(p.lines).toEqual([
      { invoiceLineId: L1, qty: '2' },
      { description: 'Goodwill', amount: '10.5', taxRateId: 'rate-1' },
    ]);
  });

  it('an unchecked line with no quantity sends the whole remaining quantity', () => {
    const f: CreditForm = { ...form, mode: 'lines', choices: { [L1]: { checked: true, qty: '' } } };
    expect(buildCreatePayload(f, inv(), creditedByLine([issuedOne])).lines).toEqual([
      { invoiceLineId: L1, qty: '3' },
    ]);
  });

  it('update has no invoice and keeps the same shape', () => {
    const p = buildUpdatePayload(
      { ...form, mode: 'lines', choices: { [L2]: { checked: true, qty: '1' } } },
      inv(),
      new Map(),
    );
    expect(p).toMatchObject({
      reason: 'goodwill',
      settlement: 'refund',
      full: false,
      lines: [{ invoiceLineId: L2, qty: '1' }],
    });
    expect('invoiceId' in p).toBe(false);
  });
});

describe('problems', () => {
  it('needs an invoice, and something to credit', () => {
    expect(formProblems(emptyForm(), null, new Map())).toEqual({ invoice: 'noInvoice' });
    expect(formProblems({ ...emptyForm('x'), mode: 'lines' }, inv(), new Map())).toEqual({
      lines: 'nothing',
    });
    expect(formProblems(emptyForm('x'), inv(), new Map())).toEqual({});
  });

  it('flags a quantity above what is left and a bad free-form row', () => {
    const f: CreditForm = {
      ...emptyForm('x'),
      mode: 'lines',
      choices: { [L1]: { checked: true, qty: '5' } },
      free: [
        { key: 'k', description: '', amount: '5', taxRateId: '' },
        { key: 'm', description: 'x', amount: '0', taxRateId: '' },
      ],
    };
    expect(formProblems(f, inv(), new Map())).toEqual({
      [`qty:${L1}`]: 'qtyExceeds',
      'free:k:description': 'descriptionRequired',
      'free:m:amount': 'amountInvalid',
    });
  });

  it('normalizes amounts', () => {
    expect(normalizeAmount('1,5', 'USD')).toBe('1.5');
    expect(normalizeAmount('0', 'USD')).toBeNull();
    expect(normalizeAmount('-3', 'USD')).toBeNull();
    expect(normalizeAmount('1.123456', 'USD')).toBeNull();
  });
});

describe('the estimate', () => {
  it('credits a whole invoice: each remaining line with its own tax, grouped per rate', () => {
    const e = estimateCredit(emptyForm('x'), inv(), new Map(), [], false);
    expect(e.subtotalMinor).toBe(20_000n);
    expect(e.taxMinor).toBe(1_800n);
    expect(e.totalMinor).toBe(21_800n);
    expect(e.taxSummary).toEqual([
      { name: 'VAT', rate: '18', inclusive: false, baseMinor: 10_000n, taxMinor: 1_800n },
    ]);
    expect(e.exceeds).toBe(false);
  });

  it('skips what earlier credit notes took', () => {
    const e = estimateCredit(emptyForm('x'), inv(), creditedByLine([issuedOne]), [], false);
    expect(e.lines[0]!.netMinor).toBe(7_500n);
    expect(e.totalMinor).toBe(7_500n + 11_800n);
  });

  it('a part of a line: proportional amount, then the line tax', () => {
    const f: CreditForm = {
      ...emptyForm('x'),
      mode: 'lines',
      choices: { [L2]: { checked: true, qty: '0.5' } },
    };
    const e = estimateCredit(f, inv(), new Map(), [], false);
    expect(e.lines).toHaveLength(1);
    expect(e.lines[0]).toMatchObject({ netMinor: 5_000n, taxMinor: 900n, totalMinor: 5_900n });
  });

  it('a free-form line takes the chosen tax rate', () => {
    const rate = { id: 'r1', name: 'GST', rate: '10', inclusive: false } as TaxRateResponse;
    const f: CreditForm = {
      ...emptyForm('x'),
      mode: 'lines',
      free: [{ key: 'a', description: 'Goodwill', amount: '20', taxRateId: 'r1' }],
    };
    const e = estimateCredit(f, inv(), new Map(), [rate], false);
    expect(e.totalMinor).toBe(2_200n);
    expect(e.taxSummary[0]).toMatchObject({
      name: 'GST',
      rate: '10',
      baseMinor: 2_000n,
      taxMinor: 200n,
    });
  });

  it('an inclusive tax is inside the credited amount', () => {
    const incl = line(L2, {
      taxName: 'VAT',
      taxRate: '20',
      taxInclusive: true,
      qty: '1',
      amounts: {
        gross: '120.00',
        discount: '0.00',
        net: '120.00',
        docDiscountShare: '0.00',
        tax: '20.00',
        total: '120.00',
      },
    });
    const e = estimateCredit(emptyForm('x'), inv([incl]), new Map(), [], false);
    expect(e.totalMinor).toBe(12_000n);
    expect(e.taxMinor).toBe(2_000n);
    expect(e.taxAddedMinor).toBe(0n);
  });

  it('shipping goes with the first credit note only', () => {
    const withShipping = { ...inv(), shippingMinor: 500n };
    expect(estimateCredit(emptyForm('x'), withShipping, new Map(), [], false).totalMinor).toBe(
      21_800n + 500n,
    );
    expect(estimateCredit(emptyForm('x'), withShipping, new Map(), [], true).totalMinor).toBe(
      21_800n,
    );
  });

  it('warns when the total passes what the invoice still allows', () => {
    const f: CreditForm = {
      ...emptyForm('x'),
      mode: 'lines',
      free: [{ key: 'a', description: 'Too much', amount: '500', taxRateId: '' }],
    };
    expect(estimateCredit(f, inv(), new Map(), [], false).exceeds).toBe(true);
  });

  it('is empty when nothing is chosen', () => {
    const e = estimateCredit({ ...emptyForm('x'), mode: 'lines' }, inv(), new Map(), [], false);
    expect(e.lines).toEqual([]);
    expect(e.totalMinor).toBe(0n);
  });
});

describe('editing a draft', () => {
  const draft = (over: Partial<CreditNoteResponse>) =>
    ({
      id: 'd1',
      status: 'draft',
      reason: 'billing_error',
      settlement: 'refund',
      note: 'n',
      issueDate: null,
      invoice: { id: 'x', number: 'INV-1' },
      totalMinor: '5900',
      currency: 'USD',
      lines: [
        {
          id: 'a',
          position: 0,
          invoiceLineId: L2,
          description: 'Service (credit)',
          hsnSac: null,
          qty: '0.5',
          unitPrice: '50.00',
          taxName: 'VAT',
          taxRate: '18',
          taxInclusive: false,
          amounts: { net: '50.00', tax: '9.00', total: '59.00' },
        },
        {
          id: 'b',
          position: 1,
          invoiceLineId: null,
          description: 'Goodwill',
          hsnSac: null,
          qty: '1',
          unitPrice: '10.00',
          taxName: null,
          taxRate: '0',
          taxInclusive: false,
          amounts: { net: '10.00', tax: '0.00', total: '10.00' },
        },
      ],
      ...over,
    }) as unknown as CreditNoteResponse;

  it('restores lines, quantities and free-form rows', () => {
    const f = formFromCreditNote(draft({}), inv(), []);
    expect(f).toMatchObject({
      mode: 'lines',
      reason: 'billing_error',
      settlement: 'refund',
      note: 'n',
    });
    expect(f.choices[L2]).toEqual({ checked: true, qty: '0.5' });
    expect(f.free).toMatchObject([{ description: 'Goodwill', amount: '10.00', taxRateId: '' }]);
  });

  it('a draft that credits all that is left opens as "whole invoice"', () => {
    expect(formFromCreditNote(draft({ totalMinor: '31800' }), inv(), []).mode).toBe('full');
  });
});

describe('what a row offers', () => {
  const all = {
    createCreditNote: true,
    issueCreditNote: true,
    voidCreditNote: true,
    deleteCreditNote: true,
  };
  it('draft: edit, issue, delete, no PDF', () => {
    expect([...creditNoteActions({ status: 'draft', refundedMinor: 0 }, all)].sort()).toEqual([
      'delete',
      'edit',
      'issue',
      'print',
      'view',
    ]);
  });
  it('issued: void unless cash was refunded', () => {
    expect(creditNoteActions({ status: 'issued', refundedMinor: 0 }, all).has('void')).toBe(true);
    expect(creditNoteActions({ status: 'issued', refundedMinor: 500 }, all).has('void')).toBe(
      false,
    );
    expect(creditNoteActions({ status: 'issued', refundedMinor: 0 }, all).has('pdf')).toBe(true);
  });
  it('permissions gate the buttons', () => {
    const none = {
      createCreditNote: false,
      issueCreditNote: false,
      voidCreditNote: false,
      deleteCreditNote: false,
    };
    expect([...creditNoteActions({ status: 'draft', refundedMinor: 0 }, none)].sort()).toEqual([
      'print',
      'view',
    ]);
    expect(creditNoteActions({ status: 'issued', refundedMinor: 0 }, none).has('void')).toBe(false);
    expect(creditNoteActions({ status: 'void', refundedMinor: 0 }, all).has('void')).toBe(false);
  });
});

describe('list filters', () => {
  const id = '8fb14a3e-4643-42cc-868c-fb9359f517ec';
  it('round-trips through the address and leaves defaults out', () => {
    const f = parseCreditFilters(
      new URLSearchParams(`tab=issued&q=CRN&invoice=${id}&contact=nope`),
    );
    expect(f).toEqual({ tab: 'issued', q: 'CRN', invoiceId: id, contactId: '' });
    expect(creditFiltersToSearch(f)).toBe(`?tab=issued&q=CRN&invoice=${id}`);
    expect(creditFiltersToSearch(parseCreditFilters(new URLSearchParams('')))).toBe('');
  });
  it('maps to the API query', () => {
    expect(creditListQuery({ tab: 'all', q: ' a ', invoiceId: '', contactId: '' })).toEqual({
      status: undefined,
      q: 'a',
      invoiceId: undefined,
      contactId: undefined,
    });
    expect(creditListQuery({ tab: 'void', q: '', invoiceId: id, contactId: '' }).status).toBe(
      'void',
    );
  });
  it('an unknown tab is all', () => {
    expect(parseCreditFilters(new URLSearchParams('tab=paid')).tab).toBe('all');
  });
});

describe('saved credit lines', () => {
  it('the unit price of a part is net / quantity (the API sends the amount as unitPrice)', () => {
    expect(creditLineUnitMinor('50.00', '2', 'USD')).toBe(2_500n);
    expect(creditLineUnitMinor('10.00', '1', 'USD')).toBe(1_000n);
    expect(creditLineUnitMinor('10.00', '3', 'USD')).toBe(333n);
  });
});

describe('what happens to the money', () => {
  const base = { totalMinor: 20_000n, creditedMinor: 0n, paidMinor: 15_000n };
  it('balance: only what is owed falls, nothing is paid out', () => {
    expect(moneyEffect({ ...base, creditMinor: 2_500n, settlement: 'balance' })).toEqual({
      balanceBeforeMinor: 5_000n,
      balanceAfterMinor: 2_500n,
      refundMinor: 0n,
      appliedMinor: 2_500n,
    });
    expect(moneyEffect({ ...base, creditMinor: 10_000n, settlement: 'balance' })).toMatchObject({
      balanceAfterMinor: 0n,
      refundMinor: 0n,
      appliedMinor: 10_000n,
    });
  });
  it('refund: cash above what is still owed goes back, never more than the credit', () => {
    // owed after = 20000 - 10000 = 10000, paid 15000: 5000 comes back
    expect(moneyEffect({ ...base, creditMinor: 10_000n, settlement: 'refund' })).toMatchObject({
      refundMinor: 5_000n,
      appliedMinor: 5_000n,
      balanceAfterMinor: 0n,
    });
    // a credit inside the open balance returns nothing
    expect(moneyEffect({ ...base, creditMinor: 2_500n, settlement: 'refund' })).toMatchObject({
      refundMinor: 0n,
      appliedMinor: 2_500n,
      balanceAfterMinor: 2_500n,
    });
    // a fully paid invoice credited in full: the whole credit is returned
    expect(
      moneyEffect({
        totalMinor: 20_000n,
        creditedMinor: 0n,
        paidMinor: 20_000n,
        creditMinor: 20_000n,
        settlement: 'refund',
      }),
    ).toMatchObject({ refundMinor: 20_000n, appliedMinor: 0n });
  });
});

describe('reasons', () => {
  it('the form offers every reason the API knows', () => {
    expect([...CREDIT_REASON_ORDER].sort()).toEqual([...CREDIT_NOTE_REASONS].sort());
  });
});
