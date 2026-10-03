import { Injectable } from '@nestjs/common';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import type { CampaignPlanGate } from './tokens';

/**
 * The cap `total_campaigns` (0 = unlimited). Reference counted campaigns CREATED over the plan period on a ledger that survives deletes;
 * that ledger is not here yet, so the cap is checked against the campaigns that exist now. There is no separate `campaign` plan flag
 * in the catalogue, so the feature check passes.
 */
@Injectable()
export class PlanCampaignGate implements CampaignPlanGate {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  assertEnabled(): Promise<void> {
    return Promise.resolve();
  }

  assertWithinCap(orgId: number, live: number): Promise<void> {
    return this.entitlements.assertWithinLimit(orgId, 'total_campaigns', live);
  }
}
