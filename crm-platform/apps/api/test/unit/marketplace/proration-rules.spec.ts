import { describe, expect, it } from 'vitest';
import {
  refundableMinor,
  shiftMonths,
  unusedMinor,
} from '../../../src/modules/marketplace/proration-rules';

const d = (s: string) => new Date(s);

describe('the unused part of a paid period', () => {
  it('counts calendar months back from the period end, clamping the end of the month', () => {
    expect(shiftMonths(d('2026-03-31T00:00:00Z'), -1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(shiftMonths(d('2028-03-31T00:00:00Z'), -1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(shiftMonths(d('2026-11-15T00:00:00Z'), -12).toISOString()).toBe(
      '2025-11-15T00:00:00.000Z',
    );
  });

  it('is the share of the cycle that is left, in integer minor units, rounded down', () => {
    // the cycle is 14 Oct to 14 Nov (31 days) and 10 days are left: 10/31 of 49900, rounded down
    const facts = {
      paidMinor: 49_900n,
      periodEnd: d('2026-11-14T00:00:00Z'),
      billingPeriod: 'monthly' as const,
      from: d('2026-11-04T00:00:00Z'),
    };
    expect(unusedMinor(facts)).toBe(16_096n);
    // never more than the whole payment, whatever the dates say
    expect(unusedMinor({ ...facts, from: d('2026-01-01T00:00:00Z') })).toBe(49_900n);
    // the period is over: nothing
    expect(unusedMinor({ ...facts, from: d('2026-11-14T00:00:00Z') })).toBe(0n);
    expect(unusedMinor({ ...facts, from: d('2026-12-01T00:00:00Z') })).toBe(0n);
  });

  it('a yearly payment is a share of its year', () => {
    const half = unusedMinor({
      paidMinor: 499_000n,
      periodEnd: d('2027-10-15T00:00:00Z'),
      billingPeriod: 'yearly',
      from: d('2027-04-15T12:00:00Z'),
    });
    // 182.5 of 365 days are left: exactly half of the payment
    expect(half).toBe(249_500n);
  });

  it('zero-decimal and three-decimal currencies are only integers: no float anywhere', () => {
    expect(
      unusedMinor({
        paidMinor: 1_000n, // JPY 1000
        periodEnd: d('2026-11-14T00:00:00Z'),
        billingPeriod: 'monthly',
        from: d('2026-11-04T00:00:00Z'),
      }),
    ).toBe(322n);
    expect(
      unusedMinor({
        paidMinor: 9_999n,
        periodEnd: d('2026-11-14T00:00:00Z'),
        billingPeriod: 'monthly',
        from: d('2026-11-09T00:00:00Z'),
      }),
    ).toBe(1_612n);
  });
});

describe('what may be returned now', () => {
  const base = {
    paidMinor: 30_000n,
    periodEnd: d('2026-11-30T00:00:00Z'),
    billingPeriod: 'monthly' as const,
    from: d('2026-11-15T00:00:00Z'),
  };

  it('is the unused share minus what was already returned, so a second run adds nothing', () => {
    const first = refundableMinor({ ...base, alreadyRefundedMinor: 0n });
    expect(first).toBeGreaterThan(0n);
    expect(refundableMinor({ ...base, alreadyRefundedMinor: first })).toBe(0n);
    expect(refundableMinor({ ...base, alreadyRefundedMinor: first - 100n })).toBe(100n);
  });

  it('never exceeds what is left of the payment, and never goes negative', () => {
    expect(refundableMinor({ ...base, alreadyRefundedMinor: 30_000n })).toBe(0n);
    expect(refundableMinor({ ...base, alreadyRefundedMinor: 99_999n })).toBe(0n);
    expect(
      refundableMinor({ ...base, from: d('2026-01-01T00:00:00Z'), alreadyRefundedMinor: 29_000n }),
    ).toBe(1_000n);
  });
});
