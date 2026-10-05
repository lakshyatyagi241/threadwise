import { describe, expect, it } from 'vitest';
import { gateFor } from './plan-paywall';

const gates = [
  { href: '/analytics', feature: 'analytics' },
  { href: '/analytics/export', feature: 'automation' },
  { href: '/deals', feature: 'sales_pipeline' },
];

describe('gateFor (WD-PLAN-020: the feature comes from the page route)', () => {
  it('matches a page and the pages under it', () => {
    expect(gateFor('/analytics', gates)?.feature).toBe('analytics');
    expect(gateFor('/deals/board', gates)?.feature).toBe('sales_pipeline');
  });
  it('lets the longest matching entry decide', () => {
    expect(gateFor('/analytics/export/csv', gates)?.feature).toBe('automation');
  });
  it('does not match a path that merely starts with the same letters, or an unmapped page', () => {
    expect(gateFor('/analytics-old', gates)).toBeNull();
    expect(gateFor('/contacts', gates)).toBeNull();
  });
});
