import { CanActivate, Injectable } from '@nestjs/common';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { PlanEntitlementService } from '../../../../plans-subscriptions-trials';

/**
 * The companies routes need the plan's sales pipeline (the flag the staff routes are gated on), checked before validation and before any
 * lookup, as for deals: the global plan guard skips `@Public()` routes (a key is the authentication here), so the check is explicit. It
 * answers PLAN_FEATURE_LOCKED, which `/api/v1` renders as 403 `plan_feature_disabled`.
 */
@Injectable()
export class CompaniesPlanGuard implements CanActivate {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  async canActivate(): Promise<boolean> {
    await this.entitlements.assertFeature(
      RequestContextStore.require().orgId,
      'sales_pipeline',
      "Your plan doesn't include the Sales Pipeline. Upgrade to unlock the companies API.",
    );
    return true;
  }
}
