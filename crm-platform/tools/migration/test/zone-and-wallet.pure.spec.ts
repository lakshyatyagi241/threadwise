import { afterEach, describe, expect, it } from 'vitest';
import { centsOf as cents } from '../credits/decimal';
import { dateOf } from '../reconcile/oracle';
import { toDate } from '../util';

const TZ = process.env.TZ;
afterEach(() => {
  if (TZ === undefined) delete process.env.TZ;
  else process.env.TZ = TZ;
});

describe('dates with no zone are UTC, whatever zone the machine runs in', () => {
  for (const zone of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles']) {
    it(`toDate and the verifier's dateOf agree in ${zone}`, () => {
      process.env.TZ = zone;
      for (const text of ['2026-10-08 14:30:00', '2026-10-08T14:30:00', '2026-10-08T14:30', '2026-10-08 14:30:00.250']) {
        const want = new Date(`${text.replace(' ', 'T')}Z`).getTime();
        expect(toDate(text)?.getTime()).toBe(want);
        expect(dateOf(text)?.getTime()).toBe(want);
      }
    });
  }
  it('leaves strings that carry a zone, a bare date and epochs as they were', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(toDate('2026-10-08T14:30:00+05:30')?.toISOString()).toBe('2026-10-08T09:00:00.000Z');
    expect(toDate('2026-10-08T14:30:00Z')?.toISOString()).toBe('2026-10-08T14:30:00.000Z');
    expect(toDate('2026-10-08')?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(toDate(1772359200000)?.toISOString()).toBe('2026-03-01T10:00:00.000Z');
  });
});

describe('wallet-sync cents', () => {
  it('rounds half away from zero on the decimal text, not on a float product', () => {
    expect(cents(192.999)).toBe(19300n);
    expect(cents(192.99)).toBe(19299n);
    expect(cents(1.005)).toBe(101n); // Math.round(1.005 * 100) is 100
    expect(cents(0)).toBe(0n);
    expect(cents(1e-7)).toBe(0n);
  });
});
