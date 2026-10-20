import { CanActivate, HttpStatus, Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import {
  ERROR_CODES,
  PLAN_UPGRADE_PATH,
  type PlanFeatureKey,
  type PlanLimitKey,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import {
  PlanEntitlementService,
  resolveFeature,
  type Entitlements,
} from '../../plans-subscriptions-trials';

/**
 * The plan side of deals (TW-DEAL-001, 044). Reference gated the whole area on `access_sales_pipeline` and let every GET through
 * (the page showed a paywall over data it had already sent); `pipelines_limit` was declared and never read.
 *
 * Both keys are in the plan registry (PLAN_FEATURE_DEFS / PLAN_LIMIT_DEFS in @crm/contracts), so the plan editor renders them.
 * `sales_pipeline` defaults to enabled and `pipelines` to unlimited, so a plan row that predates them is neither locked nor
 * capped, which is what every existing plan means.
 */
export const SALES_PIPELINE_FEATURE = 'sales_pipeline' satisfies PlanFeatureKey;
export const PIPELINES_LIMIT_KEY = 'pipelines' satisfies PlanLimitKey;

/** Pure: the flag for one organization. Platform-owned and plan-less organizations are never locked out. */
export function salesPipelineEnabled(e: Entitlements | null): boolean {
  return e ? resolveFeature(e, SALES_PIPELINE_FEATURE) : false;
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

  /** Serialises pipeline creation per workspace until the caller's transaction ends (QA Sheet3 #15, D-05). */
  lockPipelines(tx: Tx, orgId: number): Promise<void> {
    return this.entitlements.lockLimit(tx, orgId, PIPELINES_LIMIT_KEY);
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
