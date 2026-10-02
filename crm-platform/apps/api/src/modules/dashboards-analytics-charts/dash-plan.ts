import { CanActivate, HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, PLAN_UPGRADE_PATH } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { PlanEntitlementService, resolveFeature } from '../plans-subscriptions-trials';

/**
 * WaDesk's `access_analytics` gate on the analytics page (WD-DASH-022). WaDesk showed the data behind a paywall overlay; here
 * the API refuses with PLAN_FEATURE_LOCKED (the rebuild decision the inventory asks to record). The dashboard has no plan gate.
 */
@Injectable()
export class AnalyticsPlanGuard implements CanActivate {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  async canActivate(): Promise<boolean> {
    const e = await this.entitlements.forOrg(RequestContextStore.require().orgId);
    if (e && resolveFeature(e, 'analytics')) return true;
    throw new AppError(
      ERROR_CODES.PLAN_FEATURE_LOCKED,
      "Your plan doesn't include analytics. Upgrade to unlock it.",
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'feature', message: 'analytics' },
        { path: 'reason', message: 'feature_disabled' },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }
}
