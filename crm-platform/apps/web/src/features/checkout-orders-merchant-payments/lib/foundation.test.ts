import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { errorKind, fieldErrors } from './errors';
import { displayPhone, formatDay, formatMoney, formatWhen, withShop } from './format';
import {
  ORDER_STATUSES,
  isTerminalStatus,
  nextStatusSuggestion,
  orderTone,
  paymentTone,
} from './status';

const err = (status: number, code: string) => new ApiError(status, code, 'x');

describe('errorKind', () => {
  it('chooses words by code, not by message', () => {
    expect(errorKind(err(409, ERROR_CODES.STORE_COUPON_CODE_TAKEN))).toBe('couponCodeTaken');
    expect(errorKind(err(409, ERROR_CODES.STORE_GROUP_CODE_TAKEN))).toBe('groupCodeTaken');
    expect(errorKind(err(422, ERROR_CODES.STORE_GATEWAY_NOT_CONFIGURED))).toBe(
      'gatewayNotConfigured',
    );
    expect(errorKind(err(422, ERROR_CODES.STORE_ORDER_NO_PHONE))).toBe('orderNoPhone');
    expect(errorKind(err(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toBe('conflict');
    expect(errorKind(err(403, ERROR_CODES.PLAN_FEATURE_LOCKED))).toBe('planLocked');
  });
  it('treats a missing route as unavailable and a thrown non-API error as a network failure', () => {
    expect(errorKind(err(404, 'SOMETHING'))).toBe('unavailable');
    expect(errorKind(new TypeError('failed to fetch'))).toBe('network');
    expect(errorKind(err(500, 'BOOM'))).toBe('unexpected');
  });
  it('collects the first message of each field', () => {
    const e = new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'x', undefined, [
      { path: 'body.code', message: 'first' },
      { path: 'body.code', message: 'second' },
      { path: 'amount', message: 'bad' },
    ]);
    expect(fieldErrors(e)).toEqual({ code: 'first', amount: 'bad' });
  });
});

describe('status mapping', () => {
  it('gives every order status a tone and keeps unknown ones plain', () => {
    expect(ORDER_STATUSES).toHaveLength(8);
    expect(orderTone('paid')).toBe('success');
    expect(orderTone('cancelled')).toBe('danger');
    expect(orderTone('pending')).toBe('warning');
    expect(orderTone('from-the-future')).toBe('neutral');
    expect(paymentTone('paid')).toBe('success');
    expect(paymentTone('awaiting')).toBe('warning');
    expect(paymentTone('weird')).toBe('neutral');
  });
  it('suggests the usual next step and marks terminal statuses', () => {
    expect(nextStatusSuggestion('new')).toBe('confirmed');
    expect(nextStatusSuggestion('processing')).toBe('shipped');
    expect(nextStatusSuggestion('completed')).toBeNull();
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('new')).toBe(false);
  });
});

describe('format helpers', () => {
  it('formats money from minor units and survives an unknown currency', () => {
    expect(formatMoney(299800, 'INR', 'en')).toContain('2,998.00');
    expect(formatMoney(1050, 'ZZZ1', 'en')).toBe('ZZZ1 10.50');
  });
  it('keeps the shop in an address, with or without other query text', () => {
    expect(withShop('/store/orders', 'abc')).toBe('/store/orders?shop=abc');
    expect(withShop('/store/orders?status=paid', 'abc')).toBe('/store/orders?status=paid&shop=abc');
    expect(withShop('/store/orders', undefined)).toBe('/store/orders');
  });
  it('prints phones with a plus and times only when valid', () => {
    expect(displayPhone('91 98765-43210')).toBe('+919876543210');
    expect(displayPhone(null)).toBe('');
    expect(formatWhen('not-a-date', 'en')).toBe('');
    expect(formatWhen(null, 'en')).toBe('');
  });
});

describe('formatWhen and formatDay time zone', () => {
  it('gives a different day and hour for two zones', () => {
    expect(formatWhen('2026-10-02T20:30:00Z', 'en', 'Asia/Kolkata')).toBe('Oct 03, 02:00');
    expect(formatWhen('2026-10-02T20:30:00Z', 'en', 'America/New_York')).toBe('Oct 02, 16:30');
    expect(formatDay('2026-10-02T20:30:00Z', 'en', 'Asia/Kolkata')).toBe('Oct 03, 2026');
    expect(formatDay('2026-10-02T20:30:00Z', 'en', 'America/New_York')).toBe('Oct 02, 2026');
  });
});
