import { describe, expect, it, vi } from 'vitest';
import { PlanCatalogService } from '../../../src/modules/plans-subscriptions-trials/plan-catalog.service';
import { PlanStore } from '../../../src/modules/plans-subscriptions-trials/plan-store';
import {
  PlanEntitlementService,
  resolveFeature,
  resolveLimit,
  type Entitlements,
} from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';

/** A page that reads a feature flag and a limit must resolve the org's entitlements once, not once per answer. */
function ent(): Entitlements {
  return {
    orgId: 1,
    planSlug: 'pro',
    planKnown: true,
    planName: 'Pro',
    trialEndsAt: null,
    planEndsAt: null,
    billingCycle: 'monthly',
    platformOwned: false,
    overrides: {},
    planLimits: { devices: 4 },
    planFeatures: { sales_pipeline: true },
    state: 'paid_active',
    visibleApps: { all: false, appIds: new Set() },
    appWithheld: {},
  };
}

describe('featureAndLimit', () => {
  it('resolves the entitlements once and answers the flag and the cap from that one resolution', async () => {
    const svc = new PlanEntitlementService(
      {} as never,
      new PlanCatalogService({} as never),
      new PlanStore({} as never),
    );
    const e = ent();
    const forOrg = vi.spyOn(svc, 'forOrg').mockResolvedValue(e);

    const out = await svc.featureAndLimit(1, 'sales_pipeline', 'devices');

    expect(forOrg).toHaveBeenCalledTimes(1);
    expect(out).toEqual({
      enabled: resolveFeature(e, 'sales_pipeline'),
      cap: resolveLimit(e, 'devices'),
    });
  });

  it('grants nothing for an organization that does not exist', async () => {
    const svc = new PlanEntitlementService(
      {} as never,
      new PlanCatalogService({} as never),
      new PlanStore({} as never),
    );
    vi.spyOn(svc, 'forOrg').mockResolvedValue(null);
    expect(await svc.featureAndLimit(9, 'sales_pipeline', 'devices')).toEqual({
      enabled: false,
      cap: 0,
    });
  });
});
