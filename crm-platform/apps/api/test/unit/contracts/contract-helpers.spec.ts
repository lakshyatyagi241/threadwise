import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  COUPON_REJECTION_REASONS,
  availabilityListSchema,
  clockMinutes,
  couponRejectionMessage,
  couponWindowIssue,
  dateInZone,
  effectiveMonthDay,
  effectiveWeekdays,
  isIanaTimeZone,
  normalizeWalletCategory,
  normalizeWalletCountry,
  overlappingWindows,
  queryBoolean,
  queryList,
} from '@crm/contracts';

/**
 * Pure helpers of @crm/contracts that no other test names (QA task 5). The package has no tests of its own; these sit with the API
 * unit tests, which already import it. Expected values are worked out by hand from the helper's documented rule, not copied from its
 * output.
 */

describe('queryBoolean (a query string carries text, not booleans)', () => {
  const schema = z.object({ imported: queryBoolean() });
  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
    [true, true],
    [false, false],
  ])('reads %j as %s', (input, want) => {
    expect(schema.parse({ imported: input }).imported).toBe(want);
  });
  it('refuses text that is neither, instead of guessing (z.coerce.boolean would turn "no" into true)', () => {
    expect(schema.safeParse({ imported: 'no' }).success).toBe(false);
    expect(schema.safeParse({ imported: '' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe('queryList', () => {
  const schema = queryList(z.string());
  it('splits a comma list, trims each item and drops empty items', () => {
    expect(schema.parse('a, b ,,c,')).toEqual(['a', 'b', 'c']);
  });
  it('accepts a JSON array as it is, and an empty string as no items', () => {
    expect(schema.parse(['x', 'y'])).toEqual(['x', 'y']);
    expect(schema.parse('')).toEqual([]);
  });
  it('validates every item with the item schema', () => {
    expect(queryList(z.coerce.number().int()).parse('1,2,3')).toEqual([1, 2, 3]);
    expect(queryList(z.coerce.number().int()).safeParse('1,x').success).toBe(false);
  });
  it('refuses something that is neither text nor an array', () => {
    expect(schema.safeParse(5).success).toBe(false);
  });
});

describe('normalizeWalletCategory (TW-WALLET-004: anything outside the four becomes "any")', () => {
  it.each([
    ['marketing', 'marketing'],
    ['  UTILITY ', 'utility'],
    ['Authentication', 'authentication'],
    ['service', 'service'],
    ['promo', ''],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%j gives %j', (raw, want) => {
    expect(normalizeWalletCategory(raw as string | null | undefined)).toBe(want);
  });
});

describe('normalizeWalletCountry (ISO alpha-2 upper case, or "" for any country)', () => {
  it.each([
    ['in', 'IN'],
    [' gb ', 'GB'],
    ['US', 'US'],
    ['IND', ''],
    ['I', ''],
    ['1N', ''],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%j gives %j', (raw, want) => {
    expect(normalizeWalletCountry(raw as string | null | undefined)).toBe(want);
  });
});

describe('coupons (TW-CPN-006)', () => {
  it.each([
    [null, null, null],
    ['2026-01-01', null, null],
    [undefined, '2026-01-01', null],
    ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', null],
    ['2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z', null],
    ['2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', 'The expiry must be on or after the start.'],
  ])('couponWindowIssue(%j, %j) is %j', (start, end, want) => {
    expect(couponWindowIssue(start, end)).toBe(want);
  });

  it('has a buyer-facing sentence for every rejection reason, and none is blank or a placeholder', () => {
    const sentences = COUPON_REJECTION_REASONS.map((r) =>
      couponRejectionMessage(r, { code: 'SAVE10', currency: 'inr' }),
    );
    for (const s of sentences) expect(s.trim().length).toBeGreaterThan(5);
    expect(new Set(sentences).size).toBe(sentences.length);
  });
  it('names the code the buyer typed and the currency the coupon is limited to', () => {
    expect(couponRejectionMessage('not_found', { code: 'SAVE10' })).toBe(
      'Coupon "SAVE10" not recognised.',
    );
    expect(couponRejectionMessage('currency_mismatch', { currency: 'inr' })).toBe(
      'This coupon is only valid for payments in INR.',
    );
    expect(couponRejectionMessage('currency_mismatch')).toBe(
      'This coupon is only valid for payments in .',
    );
  });
});

describe('appointment availability windows', () => {
  const w = (weekday: number, from: string, to: string) => ({ weekday, from, to });
  it.each([
    ['00:00', 0],
    ['09:30', 570],
    ['23:59', 1439],
  ])('clockMinutes(%s) is %d', (t, want) => {
    expect(clockMinutes(t)).toBe(want);
  });
  it('overlappingWindows: intervals on one weekday that overlap', () => {
    expect(overlappingWindows([w(1, '09:00', '12:00'), w(1, '11:00', '14:00')])).toBe(true);
    expect(overlappingWindows([w(1, '11:00', '14:00'), w(1, '09:00', '12:00')])).toBe(true); // order does not matter
  });
  it('overlappingWindows: back to back is not an overlap, and neither is the same hours on another weekday', () => {
    expect(overlappingWindows([w(1, '09:00', '12:00'), w(1, '12:00', '14:00')])).toBe(false);
    expect(overlappingWindows([w(1, '09:00', '12:00'), w(2, '09:00', '12:00')])).toBe(false);
    expect(overlappingWindows([])).toBe(false);
  });
  it('the list schema refuses an overlap, and a window that ends before it starts', () => {
    expect(
      availabilityListSchema.safeParse([w(1, '09:00', '12:00'), w(1, '10:00', '11:00')]).success,
    ).toBe(false);
    expect(availabilityListSchema.safeParse([w(1, '12:00', '09:00')]).success).toBe(false);
    expect(
      availabilityListSchema.safeParse([w(1, '09:00', '12:00'), w(1, '13:00', '17:00')]).success,
    ).toBe(true);
  });
});

describe('recurrence helpers (campaigns)', () => {
  it('isIanaTimeZone knows real zones and refuses made-up and empty ones', () => {
    expect(isIanaTimeZone('Asia/Kolkata')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
    expect(isIanaTimeZone('America/Los_Angeles')).toBe(true);
    expect(isIanaTimeZone('Mars/Olympus')).toBe(false);
    expect(isIanaTimeZone('')).toBe(false);
  });
  it('dateInZone gives the calendar date on the clock of the zone, which can differ from the UTC date', () => {
    const instant = new Date('2026-01-01T20:00:00Z');
    expect(dateInZone(instant, 'UTC')).toBe('2026-01-01');
    expect(dateInZone(instant, 'Asia/Kolkata')).toBe('2026-01-02'); // 01:30 the next day
    expect(dateInZone(instant, 'America/Los_Angeles')).toBe('2026-01-01'); // 12:00 the same day
    expect(dateInZone(new Date('2026-01-01T03:00:00Z'), 'America/Los_Angeles')).toBe('2025-12-31');
  });
  it('effectiveWeekdays: the picked days sorted without repeats; the weekday of the start date when none were picked', () => {
    expect(effectiveWeekdays({ weekdays: [5, 1, 5], startDate: '2026-10-14' })).toEqual([1, 5]);
    // 2026-10-14 is a Wednesday, and Sunday is 0.
    expect(effectiveWeekdays({ weekdays: [], startDate: '2026-10-14' })).toEqual([3]);
    expect(effectiveWeekdays({ weekdays: [], startDate: '2026-10-18' })).toEqual([0]);
  });
  it('effectiveMonthDay: the chosen day, else the day of the month of the start date', () => {
    expect(effectiveMonthDay({ monthDay: 31, startDate: '2026-10-14' })).toBe(31);
    expect(effectiveMonthDay({ monthDay: null, startDate: '2026-10-14' })).toBe(14);
    expect(effectiveMonthDay({ monthDay: undefined, startDate: '2026-02-03' })).toBe(3);
  });
});
