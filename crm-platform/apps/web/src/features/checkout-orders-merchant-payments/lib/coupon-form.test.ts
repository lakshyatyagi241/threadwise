import { describe, expect, it } from 'vitest';
import { createStoreCouponSchema, updateStoreCouponSchema, type StoreCoupon } from '@crm/contracts';
import {
  couponToForm,
  emptyCouponForm,
  hasProblems,
  isoToLocalInput,
  localInputToIso,
  majorToMinor,
  minorToMajorText,
  suggestCode,
  toCouponInput,
  toCouponUpdate,
  validateCouponForm,
  type CouponForm,
} from './coupon-form';

const form = (over: Partial<CouponForm> = {}): CouponForm => ({
  ...emptyCouponForm(),
  code: 'summer10',
  value: '10',
  ...over,
});

const coupon = (over: Partial<StoreCoupon> = {}): StoreCoupon => ({
  id: '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11',
  code: 'SUMMER10',
  type: 'percent',
  amount: 10,
  minSubtotalMinor: 50000,
  maxDiscountMinor: 20050,
  freeShipping: true,
  active: true,
  startsAt: null,
  expiresAt: null,
  usageLimit: 100,
  usedCount: 3,
  state: 'active',
  storefrontId: null,
  storefrontName: null,
  rowVersion: 4,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('majorToMinor', () => {
  it('converts whole and decimal amounts without floating point drift', () => {
    expect(majorToMinor('150')).toBe(15000);
    expect(majorToMinor('150.5')).toBe(15050);
    expect(majorToMinor('0.07')).toBe(7);
    expect(majorToMinor('19.99')).toBe(1999);
    expect(majorToMinor('1,5')).toBe(150);
  });
  it('refuses text that is not a plain amount', () => {
    for (const bad of ['', 'abc', '-1', '1.234', '1e3', '1.', '.5'])
      expect(majorToMinor(bad), bad).toBeNull();
  });
});

describe('minorToMajorText', () => {
  it('keeps whole amounts short and pads cents', () => {
    expect(minorToMajorText(15000)).toBe('150');
    expect(minorToMajorText(15050)).toBe('150.50');
    expect(minorToMajorText(7)).toBe('0.07');
  });
});

describe('dates', () => {
  it('round-trips a local time through an ISO time with an offset', () => {
    const iso = localInputToIso('2026-10-05T14:30');
    expect(iso).toMatch(/Z$/);
    expect(isoToLocalInput(iso)).toBe('2026-10-05T14:30');
  });
  it('treats empty and invalid as no date', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('nonsense')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
  });
});

describe('validateCouponForm', () => {
  it('accepts a plain percent coupon', () => {
    expect(hasProblems(validateCouponForm(form()))).toBe(false);
  });
  it('requires a code that matches the code rule', () => {
    expect(validateCouponForm(form({ code: '' })).code).toBe('codeRequired');
    expect(validateCouponForm(form({ code: 'A B' })).code).toBe('codeInvalid');
    expect(validateCouponForm(form({ code: 'A'.repeat(65) })).code).toBe('codeInvalid');
    expect(validateCouponForm(form({ code: 'a_b-9' })).code).toBeUndefined();
  });
  it('keeps a percent between 0 and 100 and whole', () => {
    expect(validateCouponForm(form({ value: '' })).value).toBe('valueRequired');
    expect(validateCouponForm(form({ value: '101' })).value).toBe('percentRange');
    expect(validateCouponForm(form({ value: '12.5' })).value).toBe('percentRange');
    expect(validateCouponForm(form({ value: '0' })).value).toBeUndefined();
    expect(validateCouponForm(form({ value: '100' })).value).toBeUndefined();
  });
  it('takes a flat amount with at most two decimals', () => {
    expect(validateCouponForm(form({ type: 'flat', value: '250.75' })).value).toBeUndefined();
    expect(validateCouponForm(form({ type: 'flat', value: '2.505' })).value).toBe('amountInvalid');
  });
  it('checks the minimum, the cap (percent only) and the limit', () => {
    expect(validateCouponForm(form({ minSubtotal: 'x' })).minSubtotal).toBe('minInvalid');
    expect(validateCouponForm(form({ maxDiscount: 'x' })).maxDiscount).toBe('maxInvalid');
    expect(
      validateCouponForm(form({ type: 'flat', maxDiscount: 'x' })).maxDiscount,
    ).toBeUndefined();
    expect(validateCouponForm(form({ usageLimit: '0' })).usageLimit).toBe('limitInvalid');
    expect(validateCouponForm(form({ usageLimit: '2.5' })).usageLimit).toBe('limitInvalid');
    expect(validateCouponForm(form({ usageLimit: '5' })).usageLimit).toBeUndefined();
  });
  it('wants the expiry after the start', () => {
    const p = validateCouponForm(
      form({ startsAt: '2026-10-05T10:00', expiresAt: '2026-10-05T09:00' }),
    );
    expect(p.expiresAt).toBe('windowInvalid');
    expect(
      validateCouponForm(form({ startsAt: '2026-10-05T10:00', expiresAt: '2026-10-06T09:00' }))
        .expiresAt,
    ).toBeUndefined();
    expect(validateCouponForm(form({ startsAt: 'bad' })).startsAt).toBe('dateInvalid');
  });
});

describe('request bodies', () => {
  it('sends a flat amount and the minimum as minor units and drops the cap', () => {
    const input = toCouponInput(
      form({
        type: 'flat',
        value: '250.5',
        minSubtotal: '1000',
        maxDiscount: '99',
        usageLimit: '',
      }),
    );
    expect(input).toMatchObject({
      code: 'SUMMER10',
      type: 'flat',
      amount: 25050,
      minSubtotalMinor: 100000,
      maxDiscountMinor: null,
      usageLimit: null,
      storefrontId: null,
      startsAt: null,
      expiresAt: null,
    });
    expect(createStoreCouponSchema.safeParse(input).success).toBe(true);
  });
  it('sends a percent as the whole number with its cap and the shop scope', () => {
    const input = toCouponInput(
      form({
        maxDiscount: '200.50',
        usageLimit: '50',
        storefrontId: '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11',
      }),
    );
    expect(input.amount).toBe(10);
    expect(input.maxDiscountMinor).toBe(20050);
    expect(input.usageLimit).toBe(50);
    expect(input.storefrontId).toBe('5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11');
    expect(createStoreCouponSchema.safeParse(input).success).toBe(true);
  });
  it('an edit carries the row version and passes the contract', () => {
    const f = couponToForm(
      coupon({ startsAt: '2026-10-05T10:00:00.000Z', expiresAt: '2026-11-05T10:00:00.000Z' }),
    );
    const body = toCouponUpdate(f, 4);
    expect(body.rowVersion).toBe(4);
    expect(updateStoreCouponSchema.safeParse(body).success).toBe(true);
  });
});

describe('couponToForm', () => {
  it('turns minor units back into typed amounts', () => {
    const f = couponToForm(coupon());
    expect(f).toMatchObject({
      code: 'SUMMER10',
      type: 'percent',
      value: '10',
      minSubtotal: '500',
      maxDiscount: '200.50',
      usageLimit: '100',
      storefrontId: '',
      freeShipping: true,
    });
    expect(couponToForm(coupon({ type: 'flat', amount: 12550 })).value).toBe('125.50');
  });
});

describe('suggestCode', () => {
  it('uppercases and removes what the code rule refuses', () => {
    expect(suggestCode('summer sale 10%!')).toBe('SUMMER-SALE-10');
  });
});
