import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type CurrencyItem } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { errorKind, inUseBy, ratesFailureDetail } from './errors';
import {
  checkCreate,
  checkEdit,
  emptyCurrencyDraft,
  normaliseCode,
  submitError,
  toEditDraft,
} from './form';
import {
  canDeleteRow,
  currentCursor,
  firstPage,
  goNext,
  goPrevious,
  hasPrevious,
  optionLabel,
  rateCell,
  showingRange,
  toggleTarget,
} from './table';
import {
  FOLLOW_DEFAULT,
  isDirty,
  selectedValue,
  workspaceBody,
  workspaceErrorKind,
} from './workspace';

const item = (over: Partial<CurrencyItem> = {}): CurrencyItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Indian Rupee',
  code: 'INR',
  symbol: '₹',
  precision: 2,
  exchangeRate: '83.250000',
  isActive: true,
  isDefault: false,
  rowVersion: 3,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const problem = (status: number, code: string, errors: ApiError['fieldErrors'] = []) =>
  new ApiError(status, code, 'detail text', 'req-1', errors);

describe('TW-CPN-019 add form model', () => {
  it('starts as Reference does: decimals 2, rate 1, active immediately', () => {
    expect(emptyCurrencyDraft()).toMatchObject({
      precision: '2',
      exchangeRate: '1',
      isActive: true,
    });
  });

  it('TW-CPN-019 AC1: "chf" with precision 2 and rate 0.88 becomes CHF, active', () => {
    const r = checkCreate({
      name: 'Swiss Franc',
      code: 'chf',
      symbol: '',
      precision: '2',
      exchangeRate: '0.88',
      isActive: true,
    });
    expect(r.ok && r.body).toEqual({
      name: 'Swiss Franc',
      code: 'CHF',
      precision: 2,
      exchangeRate: '0.88',
      isActive: true,
    });
  });

  it('leaves the symbol out when blank and sends it trimmed otherwise', () => {
    const base = { ...emptyCurrencyDraft(), name: 'Rupee', code: 'INR' };
    const blank = checkCreate({ ...base, symbol: '  ' });
    const set = checkCreate({ ...base, symbol: ' ₹ ' });
    expect(blank.ok && 'symbol' in blank.body).toBe(false);
    expect(set.ok && set.body.symbol).toBe('₹');
  });

  it('upper-cases the code as typed and caps it at 10 characters', () => {
    expect(normaliseCode('inr')).toBe('INR');
    expect(normaliseCode('abcdefghijklm')).toBe('ABCDEFGHIJ');
  });

  it('TW-CPN-019 AC3: a rate of 0 is refused, as is a blank or negative one', () => {
    const base = { ...emptyCurrencyDraft(), name: 'Rupee', code: 'INR' };
    for (const rate of ['0', '', '-1', '0.0000001', 'abc']) {
      const r = checkCreate({ ...base, exchangeRate: rate });
      expect(r.ok, rate).toBe(false);
      if (!r.ok) expect(r.problems.exchangeRate, rate).toBe(true);
    }
    expect(checkCreate({ ...base, exchangeRate: '0.000001' }).ok).toBe(true);
  });

  it('keeps decimals within 0 to 6 and whole', () => {
    const base = { ...emptyCurrencyDraft(), name: 'Rupee', code: 'INR' };
    for (const p of ['-1', '7', '2.5', '', 'x']) {
      const r = checkCreate({ ...base, precision: p });
      expect(r.ok, p).toBe(false);
      if (!r.ok) expect(r.problems.precision, p).toBe(true);
    }
    for (const p of ['0', '6']) expect(checkCreate({ ...base, precision: p }).ok, p).toBe(true);
  });

  it('requires a name (max 120), a code, and caps the symbol at 20', () => {
    const base = emptyCurrencyDraft();
    const r = checkCreate({ ...base, name: '', code: '' });
    expect(!r.ok && r.problems).toMatchObject({ name: true, code: true });
    expect(checkCreate({ ...base, name: 'x'.repeat(121), code: 'INR' }).ok).toBe(false);
    expect(checkCreate({ ...base, name: 'x', code: 'INR', symbol: 'y'.repeat(21) }).ok).toBe(false);
  });
});

describe('TW-CPN-020 edit form model', () => {
  it('starts from the row, the code included but never sent', () => {
    expect(toEditDraft(item({ symbol: null }))).toMatchObject({ code: 'INR', symbol: '' });
    const r = checkEdit(toEditDraft(item()), 3);
    expect(r.ok && r.body).toEqual({
      name: 'Indian Rupee',
      symbol: '₹',
      precision: 2,
      exchangeRate: '83.250000',
      isActive: true,
      rowVersion: 3,
    });
    expect(r.ok && 'code' in r.body).toBe(false);
  });

  it('sends a blank symbol as null and flags a bad rate', () => {
    const d = { ...toEditDraft(item()), symbol: '', exchangeRate: '0' };
    const r = checkEdit(d, 3);
    expect(!r.ok && r.problems.exchangeRate).toBe(true);
    const ok = checkEdit({ ...d, exchangeRate: '84.1' }, 3);
    expect(ok.ok && ok.body.symbol).toBeNull();
  });
});

describe('save failures', () => {
  it('a duplicate code flags the code field as taken', () => {
    expect(submitError(problem(409, ERROR_CODES.CPN_CURRENCY_CODE_TAKEN))).toEqual({
      kind: 'fields',
      problems: { code: true, codeTaken: true },
    });
  });
  it('a stale row version is its own case', () => {
    expect(submitError(problem(409, 'ROW_VERSION_CONFLICT'))).toEqual({ kind: 'stale' });
  });
  it('server field errors map onto fields; anything else goes to the banner', () => {
    expect(
      submitError(problem(422, 'VALIDATION_FAILED', [{ path: 'exchangeRate', message: 'x' }])),
    ).toEqual({ kind: 'fields', problems: { exchangeRate: true } });
    expect(submitError(problem(500, 'INTERNAL'))).toEqual({ kind: 'other' });
    expect(submitError(new Error('x'))).toEqual({ kind: 'other' });
  });
});

describe('TW-CPN-018 table helpers', () => {
  it('shows the rate with 4 decimals and thousands commas', () => {
    expect(rateCell('83.250000')).toBe('83.2500');
    expect(rateCell('1')).toBe('1.0000');
    expect(rateCell('15234.5')).toBe('15,234.5000');
    expect(rateCell('0.000001')).toBe('0.0000');
  });

  it('labels select options "CODE - name (symbol)" and drops the brackets without a symbol', () => {
    expect(optionLabel({ code: 'INR', name: 'Indian Rupee', symbol: '₹' })).toBe(
      'INR - Indian Rupee (₹)',
    );
    expect(optionLabel({ code: 'XXX', name: 'Test', symbol: null })).toBe('XXX - Test');
  });

  it('TW-CPN-018 AC3 / TW-CPN-022: no Delete for the default row, none for a read-only operator', () => {
    expect(canDeleteRow({ isDefault: true }, true)).toBe(false);
    expect(canDeleteRow({ isDefault: false }, true)).toBe(true);
    expect(canDeleteRow({ isDefault: false }, false)).toBe(false);
  });

  it('TW-CPN-021: the pill flips the state', () => {
    expect(toggleTarget({ isActive: true })).toBe(false);
    expect(toggleTarget({ isActive: false })).toBe(true);
  });

  it('pages with a cursor stack: Next pushes, Previous pops, the first page has no Previous', () => {
    let s = firstPage;
    expect(hasPrevious(s)).toBe(false);
    expect(currentCursor(s)).toBeUndefined();
    s = goNext(s, 'c2');
    s = goNext(s, 'c3');
    expect(currentCursor(s)).toBe('c3');
    expect(hasPrevious(s)).toBe(true);
    s = goPrevious(s);
    expect(currentCursor(s)).toBe('c2');
    expect(goNext(s, null)).toBe(s);
    expect(goPrevious(goPrevious(s))).toEqual(firstPage);
  });

  it('"Showing a-b of N" follows the page', () => {
    expect(showingRange(firstPage, 12, 12, 30)).toEqual({ from: 1, to: 12, total: 30 });
    const third = goNext(goNext(firstPage, 'a'), 'b');
    expect(showingRange(third, 12, 6, 30)).toEqual({ from: 25, to: 30, total: 30 });
    expect(showingRange(firstPage, 12, 0, 0)).toEqual({ from: 0, to: 0, total: 0 });
  });
});

describe('error mapping', () => {
  it('chooses by code, never by the wording', () => {
    expect(errorKind(problem(409, ERROR_CODES.CPN_CURRENCY_IS_DEFAULT))).toBe('isDefault');
    expect(errorKind(problem(409, ERROR_CODES.CPN_CURRENCY_IN_USE))).toBe('inUse');
    expect(errorKind(problem(422, ERROR_CODES.CPN_CURRENCY_NOT_ACTIVE))).toBe('notActive');
    expect(errorKind(problem(502, ERROR_CODES.CPN_RATES_FETCH_FAILED))).toBe('ratesFailed');
    expect(errorKind(problem(409, 'ROW_VERSION_CONFLICT'))).toBe('conflict');
    expect(errorKind(problem(403, 'FORBIDDEN'))).toBe('forbidden');
    expect(errorKind(problem(500, 'INTERNAL'))).toBe('generic');
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('TW-CPN-023: a failed rate fetch shows the provider explanation from the problem detail', () => {
    expect(ratesFailureDetail(problem(502, ERROR_CODES.CPN_RATES_FETCH_FAILED))).toBe(
      'detail text',
    );
  });

  it('TW-CPN-022: lists what still uses a currency the API would not delete', () => {
    const err = problem(409, ERROR_CODES.CPN_CURRENCY_IN_USE, [
      { path: 'currency', message: '2 workspaces' },
      { path: 'currency', message: '1 plan' },
    ]);
    expect(inUseBy(err)).toEqual(['2 workspaces', '1 plan']);
    expect(inUseBy(new Error('x'))).toEqual([]);
  });
});

describe('TW-CPN-027 workspace currency model', () => {
  it('null follows the platform default and is sent as null', () => {
    expect(selectedValue({ currency: null })).toBe(FOLLOW_DEFAULT);
    expect(selectedValue({ currency: 'EUR' })).toBe('EUR');
    expect(workspaceBody(FOLLOW_DEFAULT)).toEqual({ currency: null });
    expect(workspaceBody('EUR')).toEqual({ currency: 'EUR' });
  });
  it('saving is only offered for a change', () => {
    expect(isDirty({ currency: 'EUR' }, 'EUR')).toBe(false);
    expect(isDirty({ currency: 'EUR' }, 'INR')).toBe(true);
    expect(isDirty({ currency: null }, 'USD')).toBe(true);
  });
  it('maps the API failures by code and status', () => {
    expect(workspaceErrorKind(problem(422, ERROR_CODES.CPN_WORKSPACE_CURRENCY_INVALID))).toBe(
      'invalid',
    );
    expect(workspaceErrorKind(problem(403, 'FORBIDDEN'))).toBe('forbidden');
    expect(workspaceErrorKind(problem(422, 'VALIDATION_FAILED'))).toBe('validation');
    expect(workspaceErrorKind(problem(500, 'INTERNAL'))).toBe('generic');
    expect(workspaceErrorKind(new Error('x'))).toBe('network');
  });
});
