import { HttpStatus } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  daysUntil,
  includedBy,
  packPurchaseVerdict,
  type MarketAppPricingModel,
  type PackPurchaseVerdict,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';

const MESSAGES: Record<Exclude<PackPurchaseVerdict, 'ok'>, string> = {
  unavailable: 'This app is not available for subscription.',
  not_for_sale: 'This app is not being sold to new subscribers.',
  included: 'Your plan already includes this app, so there is nothing to buy.',
  paid_ahead: 'You have already paid for the coming period of this app. Renew closer to its end.',
};

interface Row {
  app_id: string | null;
  app_status: string | null;
  pricing_model: MarketAppPricingModel | null;
  purchasable: boolean | null;
  included_plan_feature: string | null;
  included_min_plan: string | null;
  sub_status: string | null;
  paid_until: string | null;
  catalogue: string[] | null;
  org_plan: string | null;
}

/**
 * The add-on that sells a Marketplace app is bought through the same checkout as any add-on, but under the Marketplace's rules, not the
 * paid-plan prerequisite of a boost: the app must be on offer and paid, not already included in the plan, and not paid far ahead
 * (`packPurchaseVerdict`, shared with the Marketplace page). Returns false when `slug` is not such an add-on, so the caller applies the
 * ordinary add-on rules; true when it is and may be sold; throws the refusal otherwise.
 *
 * It reads the Marketplace's tables by SQL only (no import of its code): the buyer's own transaction, so row-level security decides what
 * the buyer can see of the catalogue, exactly as on the Marketplace page.
 */
export async function assertMarketplacePack(
  tx: Tx,
  orgId: number,
  slug: string,
  featureEnabled: (key: string) => Promise<boolean>,
): Promise<boolean> {
  const res = await tx.execute(sql`
    SELECT a.id::text AS app_id, a.status AS app_status, a.pricing_model, a.purchasable, a.included_plan_feature, a.included_min_plan,
           s.status AS sub_status,
           (SELECT max(w.ends_at) FROM workspace_addons w
             WHERE w.org_id = ${orgId} AND w.package_id = p.id AND w.status = 'active' AND w.ends_at > now()) AS paid_until,
           (SELECT array_agg(c.slug ORDER BY c.sort_order, c.amount, c.slug) FROM plans c WHERE c.kind = 'plan') AS catalogue,
           (SELECT o.plan FROM organizations o WHERE o.id = ${orgId}) AS org_plan
    FROM plans p
    LEFT JOIN marketplace_apps a ON a.id = p.marketplace_app_id
    LEFT JOIN marketplace_subscriptions s ON s.org_id = ${orgId} AND s.app_id = p.marketplace_app_id
    WHERE p.slug = ${slug} AND p.marketplace_app_id IS NOT NULL`);
  const r = res.rows[0] as unknown as Row | undefined;
  if (!r) return false;

  const featureOn = r.included_plan_feature ? await featureEnabled(r.included_plan_feature) : false;
  const verdict = packPurchaseVerdict({
    visible: r.app_id !== null,
    appStatus: r.app_status,
    pricingModel: r.pricing_model,
    purchasable: r.purchasable ?? false,
    subscriptionActive: r.sub_status === 'active',
    included:
      includedBy({
        includedPlanFeature: r.included_plan_feature,
        planFeatureOn: featureOn,
        includedMinPlan: r.included_min_plan,
        orgPlanSlug: r.org_plan,
        planLapsed: false,
        catalogue: r.catalogue ?? [],
      }) !== null,
    remainingDays: r.paid_until ? daysUntil(new Date(r.paid_until), new Date()) : null,
  });
  if (verdict === 'ok') return true;
  throw new AppError(
    ERROR_CODES.PAYGW_PLAN_NOT_PURCHASABLE,
    MESSAGES[verdict],
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'marketplace', message: verdict }],
  );
}
