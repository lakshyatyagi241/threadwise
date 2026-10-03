import { describe, expect, it } from 'vitest';
import type { CouponItem, CreditPackageItem, CurrencyItem } from '@crm/contracts';
import {
  buildCouponRequest,
  couponToDraft,
  fromLocalInput,
  newCouponDraft,
  toLocalInput,
} from './coupon-draft';
import { buildCurrencyRequest, currencyToDraft, newCurrencyDraft } from './currency-draft';
import { pageWindow, relativeTime, validityParts } from './format';
import { buildPackageRequest, newPackageDraft, packageToDraft } from './package-draft';

const coupon: CouponItem = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'SAVE20',
  description: null,
  adminNote: null,
  type: 'percent',
  amount: '20',
  maxDiscountAmount: null,
  currencyCode: null,
  minOrderAmount: null,
  maxUses: null,
  perUserLimit: null,
  usesCount: 0,
  applicablePlans: ['pro'],
  startsAt: null,
  expiresAt: null,
  isActive: true,
  firstPurchaseOnly: false,
  stackableWithOther: false,
  isExpired: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  rowVersion: 3,
};

describe('coupon form draft', () => {
  const draft = (over = {}) => ({
    ...newCouponDraft(),
    code: ' welcome10 ',
    amount: '10',
    ...over,
  });

  it('builds a request: code upper-cased, blanks become null, empty plan list kept', () => {
    const r = buildCouponRequest(draft({ maxUses: '', description: ' ' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toMatchObject({
        code: 'WELCOME10',
        type: 'percent',
        amount: '10',
        maxUses: null,
        description: null,
        applicablePlans: [],
        isActive: true,
      });
    }
  });

  it('flags every bad field once, in form order', () => {
    const r = buildCouponRequest(
      draft({ code: '', amount: 'abc', maxUses: '0', perUserLimit: '1.5' }),
    );
    expect(r).toEqual({ ok: false, problems: ['code', 'amount', 'maxUses', 'perUserLimit'] });
  });

  it('refuses an expiry before the start', () => {
    const r = buildCouponRequest(
      draft({ startsAt: '2030-02-01T10:00', expiresAt: '2030-01-01T10:00' }),
    );
    expect(r).toEqual({ ok: false, problems: ['expiresAt'] });
  });

  it('round-trips a stored coupon, and an open window stays empty', () => {
    const d = couponToDraft(coupon);
    expect(d).toMatchObject({
      code: 'SAVE20',
      amount: '20',
      maxUses: '',
      startsAt: '',
      applicablePlans: ['pro'],
    });
    const r = buildCouponRequest(d);
    expect(r.ok && r.body.applicablePlans).toEqual(['pro']);
  });

  it('converts between a datetime-local value and an instant', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('garbage')).toBeNull();
    const iso = fromLocalInput('2026-06-15T09:30');
    expect(iso).toMatch(/^2026-06-1[45]T/);
    expect(toLocalInput(iso)).toBe('2026-06-15T09:30');
    expect(toLocalInput(null)).toBe('');
  });
});

describe('credit package draft', () => {
  const pkg: CreditPackageItem = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Growth',
    slug: 'growth',
    price: '500.00',
    priceMinor: 50000,
    priceDisplay: '$6.00',
    currencyCode: 'INR',
    credits: 27500,
    creditsPerMajor: '55.0',
    badge: 'Most popular',
    description: null,
    isActive: true,
    isFeatured: true,
    sortOrder: 20,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rowVersion: 1,
  };

  it('builds a request with a blank slug as null (derived on the server)', () => {
    const r = buildPackageRequest({
      ...newPackageDraft('INR'),
      name: 'Starter Pack',
      price: '499.50',
      credits: '2500',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toMatchObject({
        slug: null,
        currencyCode: 'INR',
        credits: 2500,
        sortOrder: 0,
        isActive: true,
      });
    }
  });

  it('flags the bad fields: zero credits, a bad slug, a huge sort order', () => {
    const r = buildPackageRequest({
      ...newPackageDraft('INR'),
      name: 'X',
      price: '1',
      credits: '0',
      slug: 'bad slug!',
      sortOrder: '10000',
    });
    expect(r).toEqual({ ok: false, problems: ['slug', 'credits', 'sortOrder'] });
  });

  it('round-trips a stored package', () => {
    const d = packageToDraft(pkg);
    expect(d).toMatchObject({
      price: '500.00',
      credits: '27500',
      badge: 'Most popular',
      isFeatured: true,
    });
    expect(buildPackageRequest(d).ok).toBe(true);
  });
});

describe('currency draft', () => {
  it('upper-cases the code and keeps the defaults of the add form', () => {
    const r = buildCurrencyRequest({
      ...newCurrencyDraft(),
      name: 'Swiss Franc',
      code: 'chf',
      exchangeRate: '0.88',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toMatchObject({
        code: 'CHF',
        precision: 2,
        exchangeRate: '0.88',
        isActive: true,
        symbol: null,
      });
    }
  });

  it('flags a short code, a zero rate and seven decimals', () => {
    const r = buildCurrencyRequest({
      ...newCurrencyDraft(),
      name: 'Z',
      code: 'ZZ',
      exchangeRate: '0',
      precision: '7',
    });
    expect(r).toEqual({ ok: false, problems: ['code', 'precision', 'exchangeRate'] });
  });

  it('round-trips a stored currency', () => {
    const c: CurrencyItem = {
      id: '33333333-3333-4333-8333-333333333333',
      code: 'JPY',
      name: 'Japanese Yen',
      symbol: '¥',
      precision: 0,
      exchangeRate: '149',
      isActive: true,
      isDefault: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rowVersion: 1,
    };
    expect(currencyToDraft(c)).toMatchObject({ code: 'JPY', precision: '0', exchangeRate: '149' });
  });
});

describe('list formatting', () => {
  it('shows the page numbers around the current page with gaps', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('says forever, or start to end with now and forever for an open side', () => {
    expect(validityParts({ startsAt: null, expiresAt: null }, 'en')).toEqual({ kind: 'forever' });
    expect(validityParts({ startsAt: null, expiresAt: '2026-03-05T12:00:00.000Z' }, 'en')).toEqual({
      kind: 'range',
      from: null,
      to: 'Mar 5, 2026',
    });
  });

  it('phrases a relative time in the locale', () => {
    const now = Date.parse('2026-06-15T00:00:00Z');
    expect(relativeTime('2026-06-18T00:00:00Z', 'en', now)).toBe('in 3 days');
    expect(relativeTime('2026-06-14T00:00:00Z', 'en', now)).toBe('yesterday');
    expect(relativeTime('2026-09-15T00:00:00Z', 'en', now)).toBe('in 3 months');
  });
});
