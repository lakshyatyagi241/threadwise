import { Injectable } from '@nestjs/common';
import type { PlanFeatureKey, PlanLimitKey } from '@crm/contracts';
import { PlanEntitlementService } from '../plans-subscriptions-trials';

/**
 * The plan side of Forms (docs/specs/forms-builder-app.md 12.2 to 12.3). `form_builder` is a plan FEATURE that only the Marketplace app
 * grants (`grants_plan_features`), default off; the three limits are caps in the plan registry.
 *
 * The admin routes are gated by `@RequirePlanFeature(FORMS_FEATURE)`: a workspace without the app answers 422 PLAN_FEATURE_LOCKED even
 * to a hand-typed URL. The PUBLIC routes cannot answer 422 (the visitor is not the workspace's user and must learn nothing about it), so a
 * workspace that does not own the app, or whose subscription lapsed, answers exactly like an unknown key: 404.
 */
export const FORMS_FEATURE = 'form_builder' satisfies PlanFeatureKey;
export const FORMS_LIMIT = 'forms' satisfies PlanLimitKey;
export const FORM_SUBMISSIONS_LIMIT = 'form_submissions_monthly' satisfies PlanLimitKey;

@Injectable()
export class FormsPlan {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  isEnabled(orgId: number): Promise<boolean> {
    return this.entitlements.featureEnabled(orgId, FORMS_FEATURE);
  }

  /** 422 PLAN_LIMIT_REACHED when one more active form would pass the plan's cap (0 = unlimited). */
  assertCanAddForm(orgId: number, active: number): Promise<void> {
    return this.entitlements.assertWithinLimit(orgId, FORMS_LIMIT, active);
  }

  /** The monthly cap on accepted submissions, 0 = unlimited. */
  submissionsCap(orgId: number): Promise<number> {
    return this.entitlements.limit(orgId, FORM_SUBMISSIONS_LIMIT);
  }
}
