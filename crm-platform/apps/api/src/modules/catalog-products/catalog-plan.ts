import { CanActivate, Injectable } from '@nestjs/common';
import type { PlanFeatureKey } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { PlanEntitlementService } from '../plans-subscriptions-trials';

/**
 * The plan side of the catalog area (WD-CAT-001). WaDesk gated every `/catalog/*` route on the plan flag
 * `access_wa_storefront` and left `/store/products` and `/store/reviews` open, whatever its documentation says; the same split
 * is kept: the guard is on the catalog controllers only.
 *
 * The flag is the plan's `features.wa_storefront`, registered in the plan catalogue with WaDesk's column default (off).
 * Platform-owned organizations are never locked out (the central resolver).
 */
export const WA_STOREFRONT_FEATURE = 'wa_storefront' satisfies PlanFeatureKey;

@Injectable()
export class CatalogPlan {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  /** 422 PLAN_FEATURE_LOCKED when the plan has no WhatsApp storefront. Reads are refused too (WaDesk showed a paywall). */
  assertEnabled(orgId: number): Promise<void> {
    return this.entitlements.assertFeature(
      orgId,
      WA_STOREFRONT_FEATURE,
      "Your plan doesn't include the WhatsApp catalog. Upgrade to unlock it.",
    );
  }
}

/** Every `/catalog` controller except products and reviews carries this: it runs after authentication and the permission guard. */
@Injectable()
export class WaStorefrontGuard implements CanActivate {
  constructor(private readonly plan: CatalogPlan) {}

  async canActivate(): Promise<boolean> {
    await this.plan.assertEnabled(RequestContextStore.require().orgId);
    return true;
  }
}
