import { Injectable } from '@nestjs/common';
import { type PlanFeatureKey } from '@crm/contracts';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';

/**
 * The auth domain's door to the PLAN domain's feature flags (WD-PLAN-017).
 * Backed by the entitlement resolver: an organization on a plan without the
 * flag is refused (422 PLAN_FEATURE_LOCKED); one on a plan that has it, one
 * with an override, one the platform owns, and one whose plan has no catalogue
 * row (nothing to lock against) are allowed.
 *
 * Feature keys are the catalogue's own (`remove_branding`, WaDesk's name).
 */
@Injectable()
export class PlanFeatureGate {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  has(orgId: number, feature: PlanFeatureKey): Promise<boolean> {
    return this.entitlements.featureEnabled(orgId, feature);
  }

  /** Throws the plan-locked problem when the flag is off. */
  assert(orgId: number, feature: PlanFeatureKey, message?: string): Promise<void> {
    return this.entitlements.assertFeature(orgId, feature, message);
  }
}
