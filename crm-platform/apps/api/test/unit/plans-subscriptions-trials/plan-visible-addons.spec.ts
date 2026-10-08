import { describe, expect, it } from 'vitest';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  availabilityFor,
  createPlanRequestSchema,
  planAdminItemSchema,
  updatePlanRequestSchema,
} from '@crm/contracts';
import {
  appVisibleOnPlan,
  type Entitlements,
} from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';
import {
  fullFeatures,
  fullLimits,
  withStoredUnknownFeatures,
  withStoredUnknownLimits,
} from '../../../src/modules/plans-subscriptions-trials/plan-row';
import { visibilityOf } from '../../../src/modules/marketplace/plan-visibility';

const A = 'a1111111-1111-4111-8111-111111111111';
const B = 'b2222222-2222-4222-8222-222222222222';

const ent = (over: Partial<Entitlements> = {}): Entitlements =>
  ({
    orgId: 1,
    planSlug: 'pro',
    planKnown: true,
    platformOwned: false,
    visibleApps: { all: false, appIds: new Set<number>() },
    ...over,
  }) as Entitlements;

describe('which paid apps a plan shows (visible is not usable)', () => {
  it('a plan shows only the apps it enables', () => {
    const e = ent({ visibleApps: { all: false, appIds: new Set([7]) } });
    expect(appVisibleOnPlan(e, 7)).toBe(true);
    expect(appVisibleOnPlan(e, 8)).toBe(false);
  });

  it('nothing narrows a platform-owned workspace or one with no plan row', () => {
    expect(appVisibleOnPlan(ent({ visibleApps: { all: true, appIds: new Set() } }), 99)).toBe(true);
    expect(visibilityOf(null)).toEqual({ all: true, appIds: [] });
    expect(visibilityOf(ent({ visibleApps: { all: false, appIds: new Set([3, 4]) } }))).toEqual({
      all: false,
      appIds: [3, 4],
    });
  });
});

describe('availabilityFor: hidden, visible, purchased', () => {
  const base = {
    model: 'paid_monthly' as const,
    includedBy: null,
    entitled: false,
    planVisible: false,
    held: false,
  };

  it('a paid app neither enabled by the plan nor held is not visible', () => {
    expect(availabilityFor(base)).toBe('not_visible');
  });
  it('enabled by the plan but not bought: visible (subscribe, not use)', () => {
    expect(availabilityFor({ ...base, planVisible: true })).toBe('visible');
  });
  it('bought: purchased, even when the plan no longer shows it (a downgrade keeps what was bought)', () => {
    expect(availabilityFor({ ...base, entitled: true })).toBe('purchased');
    expect(availabilityFor({ ...base, entitled: true, planVisible: false })).toBe('purchased');
  });
  it('held without a live entitlement (a lapsed subscription, an installation) stays visible so it can be renewed', () => {
    expect(availabilityFor({ ...base, held: true })).toBe('visible');
  });
  it('free apps and apps a plan includes are open', () => {
    expect(availabilityFor({ ...base, model: 'free' })).toBe('open');
    expect(availabilityFor({ ...base, includedBy: 'min_plan' })).toBe('open');
  });
});

describe('plan save keeps the stored keys the registry does not know', () => {
  const stored = { analytics: true, mkt_booking: true, module_flag: false };
  const storedLimits = { contacts: 5, module_cap: 9 };

  it('the read path drops them, the save path passes them through', () => {
    expect(fullFeatures(stored)).not.toHaveProperty('mkt_booking');
    expect(fullFeatures(stored, { keepUnknown: true })).toMatchObject({
      mkt_booking: true,
      module_flag: false,
      analytics: true,
    });
    expect(fullLimits(storedLimits)).not.toHaveProperty('module_cap');
    expect(fullLimits(storedLimits, { keepUnknown: true })).toMatchObject({ module_cap: 9 });
  });

  it('an edit puts the stored unknown keys back under the validated registry keys', () => {
    const edited = createPlanRequestSchema.parse({
      name: 'Pro',
      amount: '10',
      features: { analytics: false },
    });
    expect(withStoredUnknownFeatures(stored, edited.features)).toMatchObject({
      analytics: false,
      mkt_booking: true,
      module_flag: false,
    });
    expect(withStoredUnknownLimits(storedLimits, edited.limits)).toMatchObject({ module_cap: 9 });
    // never a stored registry value over the edited one
    expect(Object.keys(withStoredUnknownFeatures({}, edited.features)).sort()).toEqual(
      [...PLAN_FEATURE_KEYS].sort(),
    );
    expect(Object.keys(withStoredUnknownLimits({}, edited.limits)).sort()).toEqual(
      [...PLAN_LIMIT_KEYS].sort(),
    );
  });

  it('the editing schema still accepts registry keys only', () => {
    const r = createPlanRequestSchema.parse({
      name: 'Pro',
      amount: '10',
      features: { analytics: true, mkt_booking: true },
    });
    expect(r.features).not.toHaveProperty('mkt_booking');
  });
});

describe('visibleAddons on the plan contracts', () => {
  const body = { name: 'Pro', amount: '10' };

  it('defaults to none, accepts pack uuids, refuses duplicates and non-uuids', () => {
    expect(createPlanRequestSchema.parse(body).visibleAddons).toEqual([]);
    expect(createPlanRequestSchema.parse({ ...body, visibleAddons: [A, B] }).visibleAddons).toEqual(
      [A, B],
    );
    expect(createPlanRequestSchema.safeParse({ ...body, visibleAddons: [A, A] }).success).toBe(
      false,
    );
    expect(createPlanRequestSchema.safeParse({ ...body, visibleAddons: ['mkt_abc'] }).success).toBe(
      false,
    );
  });

  it('an update that omits it leaves it alone (undefined), one that names it replaces the set', () => {
    expect(updatePlanRequestSchema.parse({ name: 'X' }).visibleAddons).toBeUndefined();
    expect(updatePlanRequestSchema.parse({ visibleAddons: [] }).visibleAddons).toEqual([]);
  });

  it('the plan item carries the ids', () => {
    expect(Object.keys(planAdminItemSchema.shape)).toContain('visibleAddons');
  });
});
