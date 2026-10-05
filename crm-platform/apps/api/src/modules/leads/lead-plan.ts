import { Injectable } from '@nestjs/common';
import type { PlanFeatureKey, PlanLimitKey } from '@crm/contracts';
import { PlanEntitlementService } from '../plans-subscriptions-trials';

/**
 * The plan side of lead sources (spec L-12). `lead_sources` is both a feature flag and a cap, in the plan registry
 * (PLAN_FEATURE_DEFS / PLAN_LIMIT_DEFS in @crm/contracts), so the plan editor renders them. The flag defaults to on and the cap to
 * unlimited: a plan row that predates them is neither locked nor capped.
 *
 * The management routes are gated by `@RequirePlanFeature(LEAD_SOURCES_FEATURE)`. The PUBLIC hook cannot answer 422 (its sender is not
 * the workspace's user, and must not learn anything about the workspace), so a workspace whose plan no longer includes lead sources
 * answers its hooks exactly like an unknown token: 404.
 */
export const LEAD_SOURCES_FEATURE = 'lead_sources' satisfies PlanFeatureKey;
export const LEAD_SOURCES_LIMIT = 'lead_sources' satisfies PlanLimitKey;

@Injectable()
export class LeadsPlan {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  isEnabled(orgId: number): Promise<boolean> {
    return this.entitlements.featureEnabled(orgId, LEAD_SOURCES_FEATURE);
  }

  /** The deals area (`sales_pipeline`): a lead source's deal rule does nothing for a workspace whose plan has none. */
  salesPipelineEnabled(orgId: number): Promise<boolean> {
    return this.entitlements.featureEnabled(orgId, 'sales_pipeline');
  }

  /** True when one more tag would pass the plan's tag cap: the lead tag is then skipped, never an error (a lead is not refused over a label). */
  async tagCapReached(orgId: number, used: number): Promise<boolean> {
    const cap = await this.entitlements.limit(orgId, 'tags');
    return cap > 0 && used >= cap;
  }

  /** 422 PLAN_LIMIT_REACHED when one more source would pass the plan's cap (0 = unlimited). */
  assertCanAddSource(orgId: number, used: number): Promise<void> {
    return this.entitlements.assertWithinLimit(orgId, LEAD_SOURCES_LIMIT, used);
  }
}
