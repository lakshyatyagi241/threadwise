import { describe, expect, it } from 'vitest';
import { closedAppGate, type AppRouteGate } from '@/components/shell/app-gate';
import { listingPathFor } from '../_registry/app-listings';
import { CAPABILITIES_UNKNOWN, resolveNav } from '../_registry/resolve';
import { resolveSettings } from '../_registry/settings-resolve';
import { nav as growthNav } from '../growth/nav';
import { settings as growthSettings } from '../growth/settings';
import { nav } from './nav';
import { settings } from './settings';

/**
 * AI lead scoring is an app that grants the plan feature `lead_scoring`: a workspace that has not installed it loses the Settings tiles
 * and the routes (`/lead-scoring`, `/growth`), and one that has it, by install, by plan or by an override, sees what it saw before.
 */
const WITH = {
  ...CAPABILITIES_UNKNOWN,
  permissions: new Set(['lsc.runs.read']),
  planFeatures: new Set(['marketplace', 'lead_scoring']),
};
const WITHOUT = { ...WITH, planFeatures: new Set(['marketplace']) };
const NO_PERMISSION = { ...WITH, permissions: new Set<string>() };

const gates: AppRouteGate[] = [...nav, ...growthNav]
  .filter((n) => n.gates?.app)
  .map((n) => ({
    href: n.href,
    feature: n.gates!.app!,
    labelKey: n.labelKey,
    listingHref: listingPathFor(n.gates!.app!),
  }));

describe('the Settings tiles of AI lead scoring and Growth', () => {
  const tiles = [...settings, ...growthSettings];

  it('are shown to a role that may read the log in a workspace that has the app', () => {
    const ids = resolveSettings(tiles, WITH).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['lead-scoring', 'growth']));
  });

  it('are removed, not locked, in a workspace that does not have it', () => {
    expect(resolveSettings(tiles, WITHOUT)).toEqual([]);
  });

  it('stay hidden from a role without the permission, and are shown while the entitlements are unknown', () => {
    expect(resolveSettings(tiles, NO_PERMISSION)).toEqual([]);
    expect(resolveSettings(tiles, CAPABILITIES_UNKNOWN).map((t) => t.id)).toHaveLength(2);
  });
});

describe('the routes of AI lead scoring and Growth', () => {
  it('stay out of the menu (the tile is the way in) but are registered for the gate', () => {
    expect(nav.every((n) => n.inMenu === false)).toBe(true);
    expect(growthNav.every((n) => n.inMenu === false)).toBe(true);
    expect(resolveNav([...nav, ...growthNav], WITH).map((n) => n.id)).toEqual([
      'lead-scoring',
      'growth',
    ]);
    expect(resolveNav([...nav, ...growthNav], WITHOUT)).toEqual([]);
  });

  it('are closed, at any depth, while the workspace lacks the feature, with a way to the app page', () => {
    const enabled = ['marketplace'];
    const closed = closedAppGate('/lead-scoring', gates, enabled);
    expect(closed?.feature).toBe('lead_scoring');
    expect(closed?.listingHref).toBe('/marketplace/app/lead-scoring');
    expect(closedAppGate('/growth', gates, enabled)?.feature).toBe('lead_scoring');
    expect(closedAppGate('/growth/audiences', gates, enabled)?.feature).toBe('lead_scoring');
  });

  it('open once the workspace has the feature, and close nothing while it is unknown', () => {
    expect(closedAppGate('/lead-scoring', gates, ['lead_scoring'])).toBeNull();
    expect(closedAppGate('/lead-scoring', gates, null)).toBeNull();
    expect(closedAppGate('/contacts', gates, [])).toBeNull();
  });
});
