import { describe, expect, it } from 'vitest';
import {
  Fx,
  changePct,
  monthlyPrice,
  money,
} from '../../../src/modules/plans-subscriptions-trials/plan-analytics.service';

const plan = (over: Record<string, unknown> = {}) => ({
  amount: '49.00',
  offer_amount: null as string | null,
  billing_unit: 'months',
  billing_duration: 1,
  ...over,
});

describe('monthlyPrice (MRR is the monthly price of an active workspace)', () => {
  it('normalises every billing period to one month, offer first', () => {
    expect(monthlyPrice(plan())).toBe(49);
    expect(monthlyPrice(plan({ billing_duration: 3, amount: '90.00' }))).toBe(30);
    expect(monthlyPrice(plan({ billing_unit: 'years', amount: '120.00' }))).toBe(10);
    expect(
      monthlyPrice(plan({ billing_unit: 'years', billing_duration: 2, amount: '240.00' })),
    ).toBe(10);
    expect(monthlyPrice(plan({ billing_unit: 'weeks', amount: '12.00' }))).toBeCloseTo(52, 5);
    expect(monthlyPrice(plan({ billing_unit: 'days', amount: '1.00' }))).toBe(30);
  });
  it('uses the offer when it is lower than the price and ignores one that is not', () => {
    expect(monthlyPrice(plan({ offer_amount: '39.00' }))).toBe(39);
    expect(monthlyPrice(plan({ offer_amount: '60.00' }))).toBe(49);
    expect(monthlyPrice(plan({ offer_amount: '0.00' }))).toBe(49);
  });
});

describe('changePct (WD-PLAN-026 rule 1)', () => {
  it('is (now - prev) / prev x 100 to two decimals, 100 when prev is 0 and now above 0', () => {
    expect(changePct(150, 60)).toBe('150.00');
    expect(changePct(50, 100)).toBe('-50.00');
    expect(changePct(10, 0)).toBe('100.00');
    expect(changePct(0, 0)).toBe('0.00');
  });
});

describe('Fx', () => {
  const fx = new Fx(
    'USD',
    new Map([
      ['USD', 1],
      ['INR', 80],
      ['EUR', 0.5],
    ]),
  );
  it('converts with the platform rates (units of a currency per one base unit)', () => {
    expect(fx.toBase('800', 'INR')).toBe(10);
    expect(fx.toBase('10', 'EUR')).toBe(20);
    expect(fx.toBase('5', 'usd')).toBe(5);
  });
  it('takes an unknown currency at par instead of dropping the money', () => {
    expect(fx.toBase('12.5', 'XXX')).toBe(12.5);
    expect(new Fx('USD', new Map()).toBase('7', 'INR')).toBe(7);
  });
  it('formats money to two decimals', () => {
    expect(money(1.005 + 0.0001)).toBe('1.01');
    expect(money(0)).toBe('0.00');
  });
});
