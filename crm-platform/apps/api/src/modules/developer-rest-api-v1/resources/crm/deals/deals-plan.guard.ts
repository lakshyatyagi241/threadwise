import { CanActivate, Injectable } from '@nestjs/common';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { PlanEntitlementService } from '../../../../plans-subscriptions-trials';

/**
 * WD-API-053: every deals route needs the plan's sales pipeline, checked before validation and before any lookup, so a bad body or an
 * unknown id on a plan without it is still 403. The global plan guard skips `@Public()` routes (a key is the authentication here), so
 * the check is explicit. It answers PLAN_FEATURE_LOCKED, which `/api/v1` renders as 403 `plan_feature_disabled`.
 * WaDesk let a platform admin who owned the key bypass the plan; a key here has no role, so that bypass is not carried over.
 */
@Injectable()
export class DealsPlanGuard implements CanActivate {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  async canActivate(): Promise<boolean> {
    await this.entitlements.assertFeature(
      RequestContextStore.require().orgId,
      'sales_pipeline',
      "Your plan doesn't include the Sales Pipeline. Upgrade to unlock the deals API.",
    );
    return true;
  }
}
