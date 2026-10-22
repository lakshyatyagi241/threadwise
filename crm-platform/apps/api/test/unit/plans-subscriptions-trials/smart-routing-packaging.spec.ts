import { describe, expect, it } from 'vitest';
import {
  NEW_PLAN_FEATURES_OFF,
  PACK_GRANTABLE_FEATURES,
  PLAN_FEATURE_DEFS,
  planFeatureLine,
  storedFeature,
} from '@crm/contracts';
import {
  packGrants,
  resolveFeature,
  type Entitlements,
} from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';

/**
 * Packaging of automatic assignment (docs/specs/packaging-teams-and-smart-routing.md): `inbox_routing` and `inbox_assignment_sticky` are the
 * two flags of the "Smart routing" add-on. The entry plan does not carry them; the add-on, a plan, or a workspace override turns them on.
 */
function ent(over: Partial<Entitlements> = {}): Entitlements {
  return {
    orgId: 1,
    planSlug: 'basic',
    planKnown: true,
    planName: 'Basic',
    trialEndsAt: null,
    planEndsAt: null,
    billingCycle: 'monthly',
    platformOwned: false,
    overrides: {},
    planLimits: {},
    planFeatures: {},
    state: 'paid_active',
    visibleApps: { all: false, appIds: new Set() },
    appWithheld: {},
    ...over,
  };
}
const BASIC = { inbox_routing: false, inbox_assignment_sticky: false };
const SMART = ['inbox_assignment_sticky', 'inbox_routing'];

describe('the Smart routing flags', () => {
  it('are grantable by a plain add-on pack, next to the Teams ones', () => {
    for (const k of SMART) expect(PACK_GRANTABLE_FEATURES, k).toContain(k);
    for (const k of ['team_hierarchy', 'custom_roles'])
      expect(PACK_GRANTABLE_FEATURES).toContain(k);
  });

  it('sit on the chat line, with labels that name the add-on', () => {
    for (const k of SMART) expect(planFeatureLine(k as never), k).toBe('chat');
  });

  it('a pack carrying them grants them and nothing else of the pack', () => {
    const g = packGrants([
      {
        features: { inbox_routing: true, inbox_assignment_sticky: true, automation: true },
        limits: {},
      },
    ]);
    expect(g.features.sort()).toEqual(SMART);
  });

  it('a Basic plan row that switches them off is turned on by the add-on, and off again when the add-on ends', () => {
    const basic = ent({ planFeatures: BASIC });
    expect(resolveFeature(basic, 'inbox_routing')).toBe(false);
    expect(resolveFeature(basic, 'inbox_assignment_sticky')).toBe(false);
    // the live pack is merged into planFeatures by forOrg (packGrants)
    const live = packGrants([
      { features: { inbox_routing: true, inbox_assignment_sticky: true }, limits: {} },
    ]);
    const withPack = ent({
      planFeatures: { ...BASIC, ...Object.fromEntries(live.features.map((k) => [k, true])) },
    });
    expect(resolveFeature(withPack, 'inbox_routing')).toBe(true);
    expect(resolveFeature(withPack, 'inbox_assignment_sticky')).toBe(true);
    // expired / cancelled: forOrg no longer lists the pack, so only the plan row is read
    expect(packGrants([]).features).toEqual([]);
    expect(resolveFeature(ent({ planFeatures: BASIC }), 'inbox_routing')).toBe(false);
  });

  it('a workspace override wins over both the plan and the add-on', () => {
    const withPack = ent({
      planFeatures: { inbox_routing: true },
      overrides: { features: { inbox_routing: false } },
    });
    expect(resolveFeature(withPack, 'inbox_routing')).toBe(false);
    const off = ent({ planFeatures: BASIC, overrides: { features: { inbox_routing: true } } });
    expect(resolveFeature(off, 'inbox_routing')).toBe(true);
  });

  it('a platform-owned workspace and a workspace on a plan with no row are never locked', () => {
    expect(resolveFeature(ent({ platformOwned: true, planFeatures: BASIC }), 'inbox_routing')).toBe(
      true,
    );
    expect(resolveFeature(ent({ planKnown: false }), 'inbox_assignment_sticky')).toBe(true);
  });

  it('sticky is not granted by routing alone: each flag is its own switch', () => {
    const e = ent({ planFeatures: { inbox_routing: true, inbox_assignment_sticky: false } });
    expect(resolveFeature(e, 'inbox_routing')).toBe(true);
    expect(resolveFeature(e, 'inbox_assignment_sticky')).toBe(false);
  });
});

describe('the entry plan has no automatic assignment by default (owner decision 2026-10-22: no paying clients to protect)', () => {
  it('the registry default is false, so a plan row that does not store the keys does NOT include them', () => {
    expect(storedFeature({}, 'inbox_routing')).toBe(false);
    expect(storedFeature({ automation: true }, 'inbox_assignment_sticky')).toBe(false);
    expect(PLAN_FEATURE_DEFS.find((d) => d.key === 'inbox_routing')!.default).toBe(false);
    expect(PLAN_FEATURE_DEFS.find((d) => d.key === 'inbox_assignment_sticky')!.default).toBe(false);
  });

  it('a plan that stores true has them; resolveFeature falls back to the default for a missing key', () => {
    expect(resolveFeature(ent({ planFeatures: {} }), 'inbox_routing')).toBe(false);
    expect(resolveFeature(ent({ planFeatures: { inbox_routing: true } }), 'inbox_routing')).toBe(
      true,
    );
  });

  it('the operator plan form lists both as off for a new plan', () => {
    expect([...NEW_PLAN_FEATURES_OFF].sort()).toEqual(SMART);
    for (const k of NEW_PLAN_FEATURES_OFF) {
      expect(
        PLAN_FEATURE_DEFS.some((d) => d.key === k),
        k,
      ).toBe(true);
    }
  });
});
