import type { PlanAdminItem } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { activePlanOptions, adminPriceView, capLabel } from './plan-display';

const plan = (over: Partial<PlanAdminItem>): PlanAdminItem =>
  ({
    slug: 'growth',
    name: 'Growth',
    kind: 'paid',
    amount: '49.00',
    offerAmount: null,
    currency: 'USD',
    billingUnit: 'months',
    billingDuration: 1,
    isLifetime: false,
    isActive: true,
    ...over,
  }) as PlanAdminItem;

describe('adminPriceView', () => {
  it('free and custom quote have no price line', () => {
    expect(adminPriceView(plan({ kind: 'free' }), 'en')).toEqual({ kind: 'free' });
    expect(adminPriceView(plan({ kind: 'custom_quote' }), 'en')).toEqual({ kind: 'custom' });
  });

  it('a paid plan shows its offer with the list price struck through, and its period', () => {
    expect(adminPriceView(plan({ offerAmount: '39.00' }), 'en')).toEqual({
      kind: 'paid',
      main: '$39.00',
      strike: '$49.00',
      period: { unit: 'months', count: 1 },
      lifetime: false,
    });
  });

  it('a lifetime plan has no period', () => {
    expect(adminPriceView(plan({ isLifetime: true }), 'en')).toMatchObject({
      period: null,
      lifetime: true,
    });
  });
});

describe('capLabel', () => {
  it('0 is unlimited', () => {
    expect(capLabel(0)).toEqual({ unlimited: true });
    expect(capLabel(250)).toEqual({ unlimited: false, count: 250 });
  });
});

describe('activePlanOptions', () => {
  it('keeps only active plans, in order', () => {
    const out = activePlanOptions([
      plan({ slug: 'a', name: 'A' }),
      plan({ slug: 'b', name: 'B', isActive: false }),
      plan({ slug: 'c', name: 'C', kind: 'free' }),
    ]);
    expect(out.map((o) => o.slug)).toEqual(['a', 'c']);
  });
});
