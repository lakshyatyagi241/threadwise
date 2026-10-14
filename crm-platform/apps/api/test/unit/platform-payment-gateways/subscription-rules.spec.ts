import { describe, expect, it } from 'vitest';
import {
  planInterval,
  shouldRecur,
  toDate,
  windowAfterEvent,
  type RecurFacts,
} from '../../../src/modules/platform-payment-gateways/subscription-rules';

/** Subscription rules (TW-PAYGW-012 and 029, QA task 5). Dates are UTC; expected values are worked out on a calendar. */

describe('planInterval (the renewal cadence a provider is asked for)', () => {
  it.each([
    ['days', 7, { interval: 'day', count: 7, cycle: 'monthly' }],
    ['weeks', 2, { interval: 'week', count: 2, cycle: 'monthly' }],
    ['months', 3, { interval: 'month', count: 3, cycle: 'monthly' }],
    ['years', 1, { interval: 'year', count: 1, cycle: 'yearly' }],
  ] as const)('%s x %d', (unit, duration, want) => {
    expect(planInterval(unit, duration)).toEqual(want);
  });
  it('a count below one, or that is not a number, is one; a fraction is cut', () => {
    expect(planInterval('months', 0).count).toBe(1);
    expect(planInterval('months', -3).count).toBe(1);
    expect(planInterval('months', Number.NaN).count).toBe(1);
    expect(planInterval('months', 2.9).count).toBe(2);
  });
});

describe('shouldRecur (a purchase recurs only when everything agrees)', () => {
  const ok: RecurFacts = {
    platformEnabled: true,
    driverSupports: true,
    isFree: false,
    isLifetime: false,
    isCustomQuote: false,
    planAmount: '499.00',
    autoRenew: true,
    period: 'monthly',
  };
  it('recurs when the switch is on, the driver can, the plan is priced, the buyer ticked it and the period is monthly', () => {
    expect(shouldRecur(ok)).toBe(true);
  });
  it.each([
    ['the platform switch is off', { platformEnabled: false }],
    ['the driver cannot', { driverSupports: false }],
    ['the plan is free', { isFree: true }],
    ['the plan is lifetime', { isLifetime: true }],
    ['the plan is a custom quote', { isCustomQuote: true }],
    ['the amount is zero', { planAmount: '0' }],
    ['the amount is negative', { planAmount: '-5' }],
    ['the amount is not a number', { planAmount: 'abc' }],
    ['the buyer did not tick auto-renew', { autoRenew: false }],
    ['the period is yearly (one twelve-month payment)', { period: 'yearly' as const }],
  ])('does not recur when %s', (_name, over) => {
    expect(shouldRecur({ ...ok, ...over })).toBe(false);
  });
});

describe('windowAfterEvent (where the plan window ends after a subscription event)', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  const term = { unit: 'months' as const, duration: 1 };
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('trusts the provider date when it is later than the current end', () => {
    expect(
      iso(
        windowAfterEvent(
          now,
          new Date('2026-11-01T00:00:00Z'),
          new Date('2026-12-05T00:00:00Z'),
          true,
          term,
        ),
      ),
    ).toBe('2026-12-05T00:00:00.000Z');
  });
  it('never moves the window backwards: an earlier provider date keeps the later of now and the current end', () => {
    expect(
      iso(
        windowAfterEvent(
          now,
          new Date('2026-11-01T00:00:00Z'),
          new Date('2026-10-20T00:00:00Z'),
          true,
          term,
        ),
      ),
    ).toBe('2026-11-01T00:00:00.000Z');
    expect(iso(windowAfterEvent(now, null, new Date('2026-10-01T00:00:00Z'), true, term))).toBe(
      '2026-10-14T00:00:00.000Z',
    );
  });
  it('with no provider date, a renewal adds one cycle to the later of now and the current end', () => {
    expect(iso(windowAfterEvent(now, new Date('2026-11-01T00:00:00Z'), null, true, term))).toBe(
      '2026-12-01T00:00:00.000Z',
    ); // still running: from its end
    expect(iso(windowAfterEvent(now, new Date('2026-09-01T00:00:00Z'), null, true, term))).toBe(
      '2026-11-14T00:00:00.000Z',
    ); // lapsed: from now
    expect(iso(windowAfterEvent(now, null, null, true, term))).toBe('2026-11-14T00:00:00.000Z');
  });
  it('a cycle is a calendar cycle: the end of a long month clamps to the end of a short one', () => {
    expect(iso(windowAfterEvent(new Date('2026-01-31T00:00:00Z'), null, null, true, term))).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(iso(windowAfterEvent(now, null, null, true, { unit: 'years', duration: 1 }))).toBe(
      '2027-10-14T00:00:00.000Z',
    );
    expect(iso(windowAfterEvent(now, null, null, true, { unit: 'weeks', duration: 2 }))).toBe(
      '2026-10-28T00:00:00.000Z',
    );
  });
  it('a term shorter than one counts as one', () => {
    expect(iso(windowAfterEvent(now, null, null, true, { unit: 'days', duration: 0 }))).toBe(
      '2026-10-15T00:00:00.000Z',
    );
  });
  it('an activation with no provider date and no extension leaves the window as the first payment set it (null)', () => {
    expect(windowAfterEvent(now, new Date('2026-11-01T00:00:00Z'), null, false, term)).toBeNull();
  });
});

describe('toDate (a date from a webhook: Unix seconds, ISO text or a Date)', () => {
  it('reads Unix seconds as a number or as text of 9 to 11 digits', () => {
    expect(toDate(1_760_400_000)?.toISOString()).toBe('2025-10-14T00:00:00.000Z');
    expect(toDate('1760400000')?.toISOString()).toBe('2025-10-14T00:00:00.000Z');
  });
  it('reads ISO text and passes a Date through', () => {
    expect(toDate('2026-10-14T05:30:00Z')?.toISOString()).toBe('2026-10-14T05:30:00.000Z');
    const d = new Date('2026-01-01T00:00:00Z');
    expect(toDate(d)?.getTime()).toBe(d.getTime());
  });
  it.each([[null], [undefined], [''], ['not a date'], [new Date('nope')], [Number.NaN]])(
    'reads %j as nothing',
    (v) => {
      expect(toDate(v)).toBeNull();
    },
  );
});
