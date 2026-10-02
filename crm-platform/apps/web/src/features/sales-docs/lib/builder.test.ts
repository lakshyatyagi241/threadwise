import { describe, expect, it } from 'vitest';
import {
  MAX_LINES,
  addDays,
  addLine,
  blankLine,
  docDiscountOf,
  draftFromDoc,
  draftToInput,
  draftTotals,
  duplicateLine,
  emptyDraft,
  hasErrors,
  isBlankLine,
  isDirty,
  moveLine,
  removeLine,
  validateDraft,
  type Draft,
  type DraftLine,
} from './builder';
import { appendTemplate, currencyChoices } from './templates';
import { paperFromDraft } from './paper';
import type { SalesDoc } from '../api/schemas';

const row = (over: Partial<DraftLine> = {}): DraftLine => ({
  ...blankLine(),
  description: 'Design',
  unit: '100',
  ...over,
});
const draft = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft('USD'),
  lines: [row()],
  ...over,
});

describe('rows', () => {
  it('moves a row, clamped to the ends, without touching the others', () => {
    expect(moveLine(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveLine(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveLine(['a', 'b', 'c'], 1, 99)).toEqual(['a', 'c', 'b']);
    expect(moveLine(['a', 'b', 'c'], 1, -4)).toEqual(['b', 'a', 'c']);
    expect(moveLine(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    expect(moveLine(['a', 'b', 'c'], 7, 0)).toEqual(['a', 'b', 'c']);
  });

  it('never removes the last row, it clears it', () => {
    const one = [row()];
    const after = removeLine(one, one[0]!.key);
    expect(after).toHaveLength(1);
    expect(isBlankLine(after[0]!)).toBe(true);
    const two = [row(), row({ description: 'Build' })];
    expect(removeLine(two, two[0]!.key).map((l) => l.description)).toEqual(['Build']);
  });

  it('duplicates a row right after itself with a new key', () => {
    const rows = [row({ description: 'A' }), row({ description: 'B' })];
    const next = duplicateLine(rows, rows[0]!.key);
    expect(next.map((l) => l.description)).toEqual(['A', 'A', 'B']);
    expect(new Set(next.map((l) => l.key)).size).toBe(3);
  });

  it('stops adding at the limit', () => {
    let rows = [blankLine()];
    for (let i = 0; i < MAX_LINES + 5; i++) rows = addLine(rows);
    expect(rows).toHaveLength(MAX_LINES);
  });
});

describe('validation', () => {
  it('a fresh form needs at least one real line', () => {
    const e = validateDraft(emptyDraft('USD'));
    expect(e.form).toBe('noItems');
    expect(hasErrors(e)).toBe(true);
  });

  it('blank trailing rows are ignored, not errors', () => {
    const d = draft({ lines: [row(), blankLine(), blankLine()] });
    expect(hasErrors(validateDraft(d))).toBe(false);
    expect(draftToInput(d).items).toHaveLength(1);
  });

  it('points at the field of the row that is wrong', () => {
    const bad = row({ description: ' ', unit: 'abc', qty: '-1', discount: '120', tax: 'x' });
    const e = validateDraft(draft({ lines: [bad, row({ unit: '5' })] }));
    expect(e.lines[bad.key]).toEqual({
      description: 'descriptionRequired',
      qty: 'qtyInvalid',
      unit: 'priceInvalid',
      discount: 'discountInvalid',
      tax: 'taxInvalid',
    });
    expect(Object.keys(e.lines)).toEqual([bad.key]);
  });

  it('allows a zero quantity and a zero price (a zero-value document is valid)', () => {
    expect(hasErrors(validateDraft(draft({ lines: [row({ qty: '0', unit: '0' })] })))).toBe(false);
  });

  it('allows fractional quantities (WaDesk blocked 0.5 hours)', () => {
    expect(hasErrors(validateDraft(draft({ lines: [row({ qty: '0.5' })] })))).toBe(false);
    expect(hasErrors(validateDraft(draft({ lines: [row({ qty: '1.23456' })] })))).toBe(true);
    expect(hasErrors(validateDraft(draft({ lines: [row({ qty: '100000000' })] })))).toBe(true);
  });

  it('checks the buyer email, phone, date and lengths', () => {
    const e = validateDraft(
      draft({
        buyerEmail: 'nope',
        buyerPhone: '12',
        validUntil: '2026-13-45',
        title: 'x'.repeat(256),
        notes: 'n'.repeat(5001),
        terms: 't'.repeat(10001),
      }),
    );
    expect(e.fields).toEqual({
      email: 'emailInvalid',
      phone: 'phoneInvalid',
      validUntil: 'dateInvalid',
      title: 'titleTooLong',
      notes: 'notesTooLong',
      terms: 'termsTooLong',
    });
  });

  it('accepts an email, a spaced international phone, and empty optional fields', () => {
    expect(
      validateDraft(draft({ buyerEmail: 'a@b.co', buyerPhone: '+1 (555) 010-1234' })).fields,
    ).toEqual({});
    expect(validateDraft(draft({ buyerPhone: '00971501234567' })).fields).toEqual({});
  });

  it('needs the country code on a phone, because the server stores E.164', () => {
    expect(validateDraft(draft({ buyerPhone: '0501234567' })).fields.phone).toBe('phoneInvalid');
    expect(draftToInput(draft({ buyerPhone: '+971 50 123 4567' })).buyer.phone).toBe(
      '+971501234567',
    );
  });

  it('refuses an amount the server cannot represent', () => {
    const e = validateDraft(draft({ lines: [row({ qty: '99999999', unit: '999999999' })] }));
    expect(e.form).toBe('tooLarge');
  });

  it('checks the document tax and discount', () => {
    expect(validateDraft(draft({ taxRate: '101', discountValue: '-5' })).fields).toEqual({
      docTax: 'docTaxInvalid',
      docDiscount: 'docDiscountInvalid',
    });
  });
});

describe('to the request', () => {
  it('turns what was typed into minor units, basis points and exact quantities', () => {
    const d = draft({
      currency: 'USD',
      taxRate: '18.5',
      lines: [
        row({ qty: '2,5', unit: '1,234.50', discount: '10', tax: '5' }),
        row({ description: 'Care', qty: '1', unit: '9.99' }),
      ],
    });
    const input = draftToInput(d);
    expect(input.defaultTaxBp).toBe(1850);
    expect(input.items).toEqual([
      {
        description: 'Design',
        qty: '2.5',
        unitPriceMinor: 123450,
        discount: { kind: 'percent', bp: 1000 },
        taxRateBp: 500,
      },
      { description: 'Care', qty: '1', unitPriceMinor: 999, discount: null, taxRateBp: null },
    ]);
  });

  it('carries the links, buyer and dates; empty text becomes empty strings the service nulls', () => {
    const input = draftToInput(
      draft({
        contact: { id: 'c1', name: 'Ana' },
        deal: { id: 'd1', name: 'Big deal' },
        buyerName: ' Ana ',
        validUntil: '2026-12-01',
      }),
    );
    expect(input).toMatchObject({
      contactId: 'c1',
      dealId: 'd1',
      validUntil: '2026-12-01',
      buyer: { name: 'Ana', email: '', phone: '' },
    });
    expect(draftToInput(draft()).contactId).toBeNull();
    expect(draftToInput(draft()).validUntil).toBeNull();
  });

  it('a row can carry an amount discount instead of a percentage', () => {
    const input = draftToInput(
      draft({ lines: [row({ unit: '50', discountKind: 'amount', discount: '5.50' })] }),
    );
    expect(input.items[0]!.discount).toEqual({ kind: 'amount', minor: 550 });
  });

  it('reads a document discount in either kind', () => {
    expect(docDiscountOf(draft({ discountKind: 'percent', discountValue: '10' }))).toEqual({
      kind: 'percent',
      bp: 1000,
    });
    expect(docDiscountOf(draft({ discountKind: 'amount', discountValue: '25.50' }))).toEqual({
      kind: 'amount',
      minor: 2550,
    });
    expect(docDiscountOf(draft({ discountValue: '' }))).toBeNull();
    expect(docDiscountOf(draft({ discountValue: '0' }))).toBeNull();
  });
});

describe('live totals follow the shared rule', () => {
  it('the preview total equals the total of the saved lines', () => {
    const d = draft({
      taxRate: '10',
      lines: [row({ qty: '2', unit: '15.50' }), row({ description: 'B', qty: '1', unit: '9.99' })],
    });
    expect(draftTotals(d)).toMatchObject({ subtotalMinor: 4099, taxMinor: 410, totalMinor: 4509 });
    const paper = paperFromDraft(d, {
      kind: 'proposal',
      number: '',
      status: 'draft',
      seller: { name: 'Acme', logoUrl: null, address: '', taxId: '' },
      issuedAt: null,
    });
    expect(paper.totalMinor).toBe(4509);
    expect(paper.lines.map((l) => l.netMinor)).toEqual([3100, 999]);
  });

  it('a new currency changes the exponent but not what was typed', () => {
    const d = draft({ currency: 'JPY', lines: [row({ qty: '3', unit: '1500' })] });
    expect(draftTotals(d).totalMinor).toBe(4500);
  });
});

describe('dirty check', () => {
  it('ignores blank rows and row keys', () => {
    const a = draft({ lines: [row({ key: 'one' })] });
    const b = draft({ lines: [row({ key: 'two' }), blankLine()] });
    expect(isDirty(a, b)).toBe(false);
    expect(isDirty(a, { ...b, title: 'x' })).toBe(true);
    expect(isDirty(a, { ...b, lines: [row({ unit: '101' })] })).toBe(true);
  });
});

describe('from a saved document', () => {
  const item = (over: object) => ({
    id: 'l1',
    description: 'A',
    qty: '1',
    unitPriceMinor: 0,
    discount: null,
    taxRateBp: null,
    effectiveTaxBp: 1000,
    grossMinor: 0,
    discountMinor: 0,
    netMinor: 0,
    taxMinor: 0,
    ...over,
  });
  const doc = {
    title: 'T',
    contact: null,
    deal: null,
    buyer: { name: 'Ana', email: '', phone: '' },
    currency: 'USD',
    items: [
      item({ qty: '2', unitPriceMinor: 1550 }),
      item({
        description: 'B',
        unitPriceMinor: 999,
        discount: { kind: 'percent', bp: 500 },
        taxRateBp: 500,
        effectiveTaxBp: 500,
      }),
      item({ description: 'C', unitPriceMinor: 4000, discount: { kind: 'amount', minor: 250 } }),
    ],
    defaultTaxBp: 1000,
    discount: { kind: 'percent', bp: 250 },
    notes: '',
    terms: '',
    validUntil: '2026-12-01',
  } as unknown as SalesDoc;

  it('a row without its own tax inherits the document rate; others keep their own', () => {
    const d = draftFromDoc(doc);
    expect(d.taxRate).toBe('10');
    expect(d.lines.map((l) => l.tax)).toEqual(['', '5', '']);
    expect(d.lines.map((l) => l.unit)).toEqual(['15.50', '9.99', '40.00']);
    expect(d.lines.map((l) => [l.discountKind, l.discount])).toEqual([
      ['percent', ''],
      ['percent', '5'],
      ['amount', '2.50'],
    ]);
    expect(d).toMatchObject({
      discountKind: 'percent',
      discountValue: '2.5',
      validUntil: '2026-12-01',
    });
  });

  it('what is read is what would be saved', () => {
    const input = draftToInput(draftFromDoc(doc));
    expect(input.items.map((i) => [i.unitPriceMinor, i.discount, i.taxRateBp])).toEqual([
      [1550, null, null],
      [999, { kind: 'percent', bp: 500 }, 500],
      [4000, { kind: 'amount', minor: 250 }, null],
    ]);
    expect(input.discount).toEqual({ kind: 'percent', bp: 250 });
  });
});

describe('helpers', () => {
  it('adds days to a calendar date', () => {
    expect(addDays('2026-10-02', 30)).toBe('2026-11-01');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });

  it('appends a template after a blank line and respects the limit', () => {
    expect(appendTemplate('', 'Terms', 100)).toBe('Terms');
    expect(appendTemplate('Hello  \n', 'Terms', 100)).toBe('Hello\n\nTerms');
    expect(appendTemplate('x'.repeat(95), 'Terms apply', 100)).toHaveLength(100);
  });

  it('offers the workspace and the document currency even when they are not common', () => {
    const list = currencyChoices('XOF', 'ZMW');
    expect(list).toContain('XOF');
    expect(list).toContain('ZMW');
    expect(list).toContain('USD');
    expect(new Set(list).size).toBe(list.length);
  });
});
