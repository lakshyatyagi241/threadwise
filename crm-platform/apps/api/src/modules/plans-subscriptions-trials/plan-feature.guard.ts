import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { PLAN_FEATURE_LABELS, type PlanFeatureKey } from '@crm/contracts';
import { PlanEntitlementService } from './plan-entitlement.service';

export const REQUIRE_PLAN_FEATURE_KEY = 'plan:require-features';

/**
 * Declares which plan features a controller or route needs (WD-PLAN-019). Every key must be on, the first missing one decides the answer
 * (422 PLAN_FEATURE_LOCKED with `feature`, `reason: feature_disabled` and the upgrade link, the same problem the in-context guards raise).
 * Keys are typed, so a feature the registry does not know is a compile error (WaDesk's unknown keys silently resolved to "open").
 *
 * Unlike WaDesk's middleware this refuses READS too: its GET endpoints on a gated route still returned their data, and only the HTML page
 * showed a paywall. The web app draws the paywall sheet from the same 422 / the entitlements it already holds.
 */
export const RequirePlanFeature = (...keys: PlanFeatureKey[]) =>
  SetMetadata(REQUIRE_PLAN_FEATURE_KEY, keys);

/** The words a lock message uses for a feature: the registry label, e.g. "Analytics". */
export const planFeatureLabel = (key: PlanFeatureKey): string =>
  PLAN_FEATURE_LABELS[key] ?? key.replace(/_/g, ' ');

/**
 * Enforces `@RequirePlanFeature`. Registered app-wide after authentication and the permission guard (a request that is not allowed at all is
 * refused for that reason first). Platform operators pass (they are a different actor pool, WaDesk: "platform admins pass through"); API
 * keys are held to the workspace's plan like its users.
 */
@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const keys = this.reflector.getAllAndOverride<PlanFeatureKey[] | undefined>(
      REQUIRE_PLAN_FEATURE_KEY,
      targets,
    );
    if (!keys || keys.length === 0) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) &&
      !RequestContextStore.peek()?.orgId
    )
      return true;

    const ctx = RequestContextStore.peek();
    if (!ctx || (ctx.actorType !== 'user' && ctx.actorType !== 'api_key') || !(ctx.orgId > 0))
      return true;
    for (const key of keys) {
      if (!(await this.entitlements.featureEnabled(ctx.orgId, key))) {
        await this.entitlements.assertFeature(
          ctx.orgId,
          key,
          `Your plan doesn't include ${planFeatureLabel(key)}. Upgrade to unlock this feature.`,
        );
      }
    }
    return true;
  }
}
