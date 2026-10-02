import { describe, expect, it } from 'vitest';
import { ERROR_CODES, createCouponRequestSchema, type Coupon } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { couponErrorKind } from './lib/errors';
import {
  buildCouponPayload,
  checkCoupon,
  couponSubmitError,
  emptyCouponDraft,
  filterPlanOptions,
  isoToLocalInput,
  localInputToIso,
  toCouponDraft,
} from './lib/form';
import {
  currentCursor,
  firstPage,
  formatDiscount,
  formatUses,
  pageIndexOf,
  popCursor,
  pushCursor,
  relativeTo,
  showingRange,
  trimDecimal,
  validityOf,
} from './lib/list';

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: '00000000-0000-4000-8000-000000000001',
  code: 'WELCOME10',
  description: null,
  adminNote: null,
  type: 'percent',
  amount: '10.0000',
  maxDiscountAmount: null,
  currencyCode: null,
  minOrderAmount: null,
  maxUses: null,
  perUserLimit: null,
  usesCount: 0,
  applicablePlanSlugs: [],
  startsAt: null,
  expiresAt: null,
  isActive: true,
  isExpired: false,
  firstPurchaseOnly: false,
  stackableWithOther: false,
  rowVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const valid = () => ({ ...emptyCouponDraft(), code: 'welcome10', amount: '10' });

describe('TW-CPN-001 list formatting', () => {
  it('shows a percent discount as the trimmed number and a percent sign', () => {
    expect(formatDiscount({ type: 'percent', amount: '10.0000', currencyCode: null }, 'en')).toBe(
      '10%',
    );
    expect(formatDiscount({ type: 'percent', amount: '12.50', currencyCode: null }, 'en')).toBe(
      '12.5%',
    );
    expect(trimDecimal('7')).toBe('7');
  });

  it('shows a fixed discount in the currency lock when there is one, else as a plain number', () => {
    expect(formatDiscount({ type: 'fixed', amount: '5.00', currencyCode: 'USD' }, 'en')).toBe(
      '$5.00',
    );
    expect(formatDiscount({ type: 'fixed', amount: '500.00', currencyCode: null }, 'en')).toBe(
      '500',
    );
    expect(formatDiscount({ type: 'fixed', amount: '5', currencyCode: 'XXXXXXX' }, 'en')).toBe(
      'XXXXXXX 5',
    );
  });

  it('shows uses as used / max, or / infinity when uncapped', () => {
    expect(formatUses(1234, 5000, 'en')).toBe('1,234 / 5,000');
    expect(formatUses(3, null, 'en')).toBe('3 / ∞');
  });

  it('shows validity with now / forever placeholders, or just forever when both are empty', () => {
    expect(validityOf({ startsAt: null, expiresAt: null }, 'en')).toEqual({ kind: 'forever' });
    expect(
      validityOf({ startsAt: null, expiresAt: '2026-12-31T12:00:00.000Z' }, 'en', 'UTC'),
    ).toEqual({ kind: 'range', start: null, end: 'Dec 31, 2026' });
    expect(
      validityOf({ startsAt: '2026-10-01T12:00:00.000Z', expiresAt: null }, 'en', 'UTC'),
    ).toEqual({ kind: 'range', start: 'Oct 1, 2026', end: null });
  });

  it('paginates by a stack of cursors: next pushes, previous pops, the first page has none', () => {
    let s = firstPage();
    expect(currentCursor(s)).toBeUndefined();
    expect(pageIndexOf(s)).toBe(0);
    s = pushCursor(s, 'c1');
    s = pushCursor(s, 'c2');
    expect(currentCursor(s)).toBe('c2');
    expect(pageIndexOf(s)).toBe(2);
    s = popCursor(s);
    expect(currentCursor(s)).toBe('c1');
    expect(popCursor(popCursor(s))).toEqual(firstPage());
  });

  it('words the footer range: 13-24 of 30 on page two, 0-0 on an empty page', () => {
    expect(showingRange(0, 12, 12)).toEqual({ from: 1, to: 12 });
    expect(showingRange(1, 12, 12)).toEqual({ from: 13, to: 24 });
    expect(showingRange(2, 12, 6)).toEqual({ from: 25, to: 30 });
    expect(showingRange(0, 12, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('TW-CPN-002 create: payload building', () => {
  it('uppercases the code and sends blanks as null, plans as an empty list', () => {
    const body = buildCouponPayload(valid());
    expect(body).toMatchObject({
      code: 'WELCOME10',
      type: 'percent',
      amount: '10',
      description: null,
      adminNote: null,
      maxDiscountAmount: null,
      currencyCode: null,
      minOrderAmount: null,
      maxUses: null,
      perUserLimit: null,
      applicablePlanSlugs: [],
      startsAt: null,
      expiresAt: null,
      isActive: true,
      firstPurchaseOnly: false,
      stackableWithOther: false,
    });
    expect(createCouponRequestSchema.safeParse(body).success).toBe(true);
  });

  it('defaults like Reference: percent, active ON, first purchase OFF, stackable OFF', () => {
    const d = emptyCouponDraft();
    expect([d.type, d.isActive, d.firstPurchaseOnly, d.stackableWithOther]).toEqual([
      'percent',
      true,
      false,
      false,
    ]);
  });

  it('turns datetime-local values into ISO 8601 instants and back', () => {
    const iso = localInputToIso('2026-11-05T09:30');
    expect(iso).toBe(new Date(2026, 10, 5, 9, 30).toISOString());
    expect(isoToLocalInput(iso)).toBe('2026-11-05T09:30');
    expect(localInputToIso('  ')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
  });

  it('sends counts as numbers and trims text', () => {
    const body = buildCouponPayload({
      ...valid(),
      description: '  hi  ',
      maxUses: '100',
      perUserLimit: '1',
      maxDiscountAmount: '50',
      currencyCode: 'INR',
      applicablePlanSlugs: ['pro'],
    });
    expect(body).toMatchObject({
      description: 'hi',
      maxUses: 100,
      perUserLimit: 1,
      maxDiscountAmount: '50',
      currencyCode: 'INR',
      applicablePlanSlugs: ['pro'],
    });
  });

  it('checks required fields and ranges before the request (code, amount, max_uses 0, bad money)', () => {
    expect(checkCoupon({ ...valid(), code: '  ' })).toEqual({
      ok: false,
      problems: { code: 'required' },
    });
    expect(checkCoupon({ ...valid(), amount: '' })).toEqual({
      ok: false,
      problems: { amount: 'required' },
    });
    expect(checkCoupon({ ...valid(), amount: 'ten' })).toEqual({
      ok: false,
      problems: { amount: 'money' },
    });
    expect(checkCoupon({ ...valid(), maxUses: '0' })).toEqual({
      ok: false,
      problems: { maxUses: 'count' },
    });
    expect(checkCoupon({ ...valid(), perUserLimit: '1.5' })).toEqual({
      ok: false,
      problems: { perUserLimit: 'count' },
    });
    expect(checkCoupon({ ...valid(), code: 'x'.repeat(65) })).toEqual({
      ok: false,
      problems: { code: 'tooLong' },
    });
  });

  it('rejects Expires at before Starts at, on Expires at', () => {
    expect(
      checkCoupon({ ...valid(), startsAt: '2026-11-05T09:30', expiresAt: '2026-11-04T09:30' }),
    ).toEqual({ ok: false, problems: { expiresAt: 'window' } });
    expect(
      checkCoupon({ ...valid(), startsAt: '2026-11-05T09:30', expiresAt: '2026-11-05T09:30' }).ok,
    ).toBe(true);
  });

  it('returns the body without a row version when creating', () => {
    const r = checkCoupon(valid());
    expect(r.ok && 'rowVersion' in r.input).toBe(false);
  });
});

describe('TW-CPN-003 edit: payload and conflicts', () => {
  it('loads a stored coupon into the draft with trimmed numbers and local dates', () => {
    const d = toCouponDraft(
      coupon({
        amount: '20.0000',
        maxDiscountAmount: '50.0000',
        maxUses: 100,
        startsAt: '2026-11-05T09:30:00.000Z',
        applicablePlanSlugs: ['pro', 'addon-x'],
      }),
    );
    expect(d).toMatchObject({
      amount: '20',
      maxDiscountAmount: '50',
      maxUses: '100',
      applicablePlanSlugs: ['pro', 'addon-x'],
    });
    expect(d.startsAt).toBe(isoToLocalInput('2026-11-05T09:30:00.000Z'));
  });

  it('sends the row version, and null for a cleared cap (max_uses cleared -> unlimited)', () => {
    const d = { ...toCouponDraft(coupon({ maxUses: 100 })), maxUses: '' };
    const r = checkCoupon(d, 4);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input).toMatchObject({ maxUses: null, rowVersion: 4 });
  });

  it('sends an explicit empty plan list when every plan chip was removed (the documented Reference-quirk fix)', () => {
    const d = {
      ...toCouponDraft(coupon({ applicablePlanSlugs: ['pro', 'plus'] })),
      applicablePlanSlugs: [],
    };
    const r = checkCoupon(d, 2);
    expect(r.ok && r.input.applicablePlanSlugs).toEqual([]);
  });

  it('sends null for a cleared date', () => {
    const d = {
      ...toCouponDraft(coupon({ expiresAt: '2026-12-01T00:00:00.000Z' })),
      expiresAt: '',
    };
    const r = checkCoupon(d, 2);
    expect(r.ok && r.input.expiresAt).toBeNull();
  });

  const problem = (
    status: number,
    code: string,
    fieldErrors: Array<{ path: string; message: string }> = [],
  ) => new ApiError(status, code, 'x', 'req', fieldErrors);

  it('treats ROW_VERSION_CONFLICT as a stale form', () => {
    expect(couponSubmitError(problem(409, 'ROW_VERSION_CONFLICT'))).toEqual({ kind: 'stale' });
  });

  it('puts CPN_COUPON_CODE_TAKEN on the code field, unknown plans on the plans field', () => {
    expect(couponSubmitError(problem(409, ERROR_CODES.CPN_COUPON_CODE_TAKEN))).toEqual({
      kind: 'fields',
      problems: { code: 'taken' },
    });
    expect(couponSubmitError(problem(422, ERROR_CODES.CPN_COUPON_PLAN_UNKNOWN))).toEqual({
      kind: 'fields',
      problems: { applicablePlanSlugs: 'unknownPlan' },
    });
  });

  it('maps problem+json errors[].path to fields (first path segment)', () => {
    const e = problem(422, 'VALIDATION_FAILED', [
      { path: 'amount', message: 'bad' },
      { path: 'applicablePlanSlugs.1', message: 'bad' },
      { path: 'expiresAt', message: 'bad' },
    ]);
    expect(couponSubmitError(e)).toEqual({
      kind: 'fields',
      problems: { amount: 'invalid', applicablePlanSlugs: 'invalid', expiresAt: 'window' },
    });
    expect(couponSubmitError(new Error('x'))).toEqual({ kind: 'other' });
    expect(couponSubmitError(problem(500, 'INTERNAL'))).toEqual({ kind: 'other' });
  });

  it('chooses the message by code, never by wording', () => {
    expect(couponErrorKind(problem(409, 'ROW_VERSION_CONFLICT'))).toBe('conflict');
    expect(couponErrorKind(problem(404, 'NOT_FOUND'))).toBe('notFound');
    expect(couponErrorKind(problem(429, ERROR_CODES.CPN_COUPON_THROTTLED))).toBe('throttled');
    expect(couponErrorKind(problem(403, 'WHATEVER'))).toBe('forbidden');
    expect(couponErrorKind(problem(500, 'INTERNAL'))).toBe('generic');
    expect(couponErrorKind(new TypeError('fetch failed'))).toBe('network');
  });

  it('filters the plan picker by name or slug and hides the chosen ones', () => {
    const opts = [
      { slug: 'starter', name: 'Starter' },
      { slug: 'pro', name: 'Professional' },
      { slug: 'pro-yearly', name: 'Pro (yearly)' },
    ];
    expect(filterPlanOptions(opts, ['pro'], '').map((o) => o.slug)).toEqual([
      'starter',
      'pro-yearly',
    ]);
    expect(filterPlanOptions(opts, [], 'PRO').map((o) => o.slug)).toEqual(['pro', 'pro-yearly']);
    expect(filterPlanOptions(opts, [], 'zzz')).toEqual([]);
  });

  it('words the edit header like "expires in 5 days" / "3 days ago"', () => {
    const now = new Date('2026-10-10T00:00:00.000Z');
    expect(relativeTo('2026-10-15T00:00:00.000Z', now, 'en')).toBe('in 5 days');
    expect(relativeTo('2026-10-07T00:00:00.000Z', now, 'en')).toBe('3 days ago');
  });
});
