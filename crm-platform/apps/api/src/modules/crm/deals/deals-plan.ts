import { CanActivate, HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, PLAN_UPGRADE_PATH, type PlanLimitKey } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { PlanEntitlementService, type Entitlements } from '../../plans-subscriptions-trials';

/**
 * The plan side of deals (WD-DEAL-001, 044). WaDesk gated the whole area on `access_sales_pipeline` and let every GET through
 * (the page showed a paywall over data it had already sent); `pipelines_limit` was declared and never read.
 *
 * Both keys live in the plan's stored `features` / `limits` JSON under the names below. They are not in the plan-form registry
 * yet (PLAN_FEATURE_DEFS / PLAN_LIMIT_DEFS in @crm/contracts, which the plan editor in apps/web renders and tests message
 * keys for), so for now they are set on a plan or an organization override directly. A plan that carries neither key is not
 * locked and not capped, which is what every existing plan means.
 */
export const SALES_PIPELINE_FEATURE = 'sales_pipeline';
export const PIPELINES_LIMIT_KEY = 'pipelines' as PlanLimitKey;

/** Pure: the flag for one organization. Platform-owned and plan-less organizations are never locked out. */
export function salesPipelineEnabled(e: Entitlements | null): boolean {
  if (!e) return false;
  if (e.platformOwned) return true;
  const override = e.overrides.features?.[SALES_PIPELINE_FEATURE];
  if (typeof override === 'boolean') return override;
  if (!e.planKnown) return true;
  const stored = (e.planFeatures as Record<string, unknown>)[SALES_PIPELINE_FEATURE];
  return typeof stored === 'boolean' ? stored : true;
}

@Injectable()
export class DealsPlan {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  /** 422 PLAN_FEATURE_LOCKED when the plan has no sales pipeline. Reads are refused too (D-01). */
  async assertEnabled(orgId: number): Promise<void> {
    if (salesPipelineEnabled(await this.entitlements.forOrg(orgId))) return;
    throw new AppError(
      ERROR_CODES.PLAN_FEATURE_LOCKED,
      "Your plan doesn't include the sales pipeline. Upgrade to unlock it.",
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'feature', message: SALES_PIPELINE_FEATURE },
        { path: 'reason', message: 'feature_disabled' },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }

  /** 422 PLAN_LIMIT_REACHED when one more pipeline would pass the plan's cap (0 = unlimited). */
  async assertCanAddPipeline(orgId: number, used: number): Promise<void> {
    await this.entitlements.assertWithinLimit(orgId, PIPELINES_LIMIT_KEY, used);
  }
}

/** Every deals controller carries this: the plan check runs after authentication and the permission guard. */
@Injectable()
export class SalesPipelineGuard implements CanActivate {
  constructor(private readonly plan: DealsPlan) {}

  async canActivate(): Promise<boolean> {
    await this.plan.assertEnabled(RequestContextStore.require().orgId);
    return true;
  }
}
