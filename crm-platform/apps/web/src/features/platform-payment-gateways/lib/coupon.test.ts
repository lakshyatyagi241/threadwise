import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type ApplyCouponResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { couponFailureOf, interpretApply, isCouponRejected, summaryView } from './coupon';

const quote = { currency: 'USD', subtotal: '100.00', tax: '18.00', total: '118.00' };
const ok: ApplyCouponResponse = {
  ok: true,
  message: 'Coupon applied.',
  discount: '10.00',
  code: 'WELCOME10',
  currency: 'USD',
  subtotal: '100.00',
  tax: '16.20',
  total: '106.20',
};

describe('TW-CPN-007 checkout coupon preview', () => {
  it('without a coupon the summary is the quote', () => {
    expect(summaryView(quote, null)).toEqual({
      subtotal: '100.00',
      discount: null,
      couponCode: null,
      tax: '18.00',
      total: '118.00',
    });
  });

  it('with a coupon the summary is the server-computed one (tax is not recomputed in the browser)', () => {
    expect(summaryView(quote, ok)).toEqual({
      subtotal: '100.00',
      discount: '10.00',
      couponCode: 'WELCOME10',
      tax: '16.20',
      total: '106.20',
    });
  });

  it('ignores a coupon computed for another currency, or a rejected one', () => {
    expect(summaryView(quote, { ...ok, currency: 'INR' }).couponCode).toBeNull();
    expect(summaryView(quote, { ...ok, ok: false, code: null }).couponCode).toBeNull();
  });

  it('shows ok:false messages verbatim and treats ok:true as applied', () => {
    expect(
      interpretApply({ ...ok, ok: false, code: null, message: 'This coupon has expired.' }),
    ).toEqual({
      kind: 'rejected',
      message: 'This coupon has expired.',
    });
    expect(interpretApply(ok)).toEqual({ kind: 'applied', response: ok });
  });

  it('tells a throttled check (429 CPN_COUPON_THROTTLED) from any other failure', () => {
    expect(couponFailureOf(new ApiError(429, ERROR_CODES.CPN_COUPON_THROTTLED, 'slow'))).toBe(
      'throttled',
    );
    expect(couponFailureOf(new TypeError('fetch failed'))).toBe('network');
    expect(couponFailureOf(new ApiError(500, 'INTERNAL', 'x'))).toBe('network');
  });
});

describe('TW-CPN-008 placing the order with a coupon', () => {
  it('recognises the refusal by its code (422 CPN_COUPON_REJECTED), whatever the wording', () => {
    expect(
      isCouponRejected(
        new ApiError(422, ERROR_CODES.CPN_COUPON_REJECTED, 'This coupon has expired.'),
      ),
    ).toBe(true);
    expect(
      isCouponRejected(new ApiError(422, 'VALIDATION_FAILED', 'This coupon has expired.')),
    ).toBe(false);
    expect(isCouponRejected(new Error('x'))).toBe(false);
  });
});
