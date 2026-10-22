import { describe, expect, it } from 'vitest';
import { MARKET_TABS } from './lib/browse';
import { MARKET_PERMISSIONS } from './lib/permissions';
import { nav } from './nav';

describe('the Marketplace menu entry', () => {
  it('needs the read permission (a role without it has no entry) and the marketplace plan feature (a plan without it is locked)', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]!.gates).toEqual({
      permission: MARKET_PERMISSIONS.read,
      planFeature: 'marketplace',
    });
  });

  it('covers every tab address with the one gate: the entry is /marketplace, so the paywall prefix-matches all four tabs', () => {
    const entry = nav[0]!;
    for (const tab of MARKET_TABS) {
      expect(tab.href === entry.href || tab.href.startsWith(`${entry.href}/`)).toBe(true);
    }
  });
});
