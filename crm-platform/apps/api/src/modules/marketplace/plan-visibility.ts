import { sql, type SQL } from 'drizzle-orm';
import type { Entitlements } from '../plans-subscriptions-trials';

/**
 * Which paid apps a workspace may SEE in the Marketplace. A plan makes a paid app's add-on visible (`plan_visible_addons`); using it
 * still needs a purchase (the entitlement key the add-on grants). The one rule, here, for browse, search, shelves, categories, an app's
 * page, install and subscribe (checkout holds the same rule in platform-payment-gateways/marketplace-pack.ts, which reads by SQL only):
 *
 *   an app is shown to a workspace unless it is paid, not plan-gated by an inclusion rule, not enabled by the workspace's plan, and not
 *   already the workspace's (installed, subscribed to, bought through an add-on, or switched on by an override).
 *
 * The last clause is what keeps existing customers whole: a plan that stops showing an app, or a downgrade, never hides or disables an
 * app the workspace already has. A free app and an app with an `included_*` rule are never narrowed (the inclusion rule decides what
 * they cost the workspace, not whether it may see them).
 */
export interface PlanVisibility {
  /** True where nothing narrows the catalogue: a platform-owned workspace, or one on a plan with no catalogue row. */
  all: boolean;
  /** `marketplace_apps.id` of the paid apps the plan enables. */
  appIds: number[];
}

export const visibilityOf = (e: Entitlements | null): PlanVisibility =>
  e ? { all: e.visibleApps.all, appIds: [...e.visibleApps.appIds] } : { all: true, appIds: [] };

/** A bigint[] literal as a bound text parameter (an empty list is `{}`). */
const ids = (list: readonly number[]): SQL => sql`${`{${list.join(',')}}`}::bigint[]`;

/** Whether the workspace already has the app, through any road that is not the plan. `a` is the `marketplace_apps` alias. */
export const heldByWorkspace = (orgId: number): SQL => sql`(
  EXISTS (SELECT 1 FROM workspace_app_installations wi WHERE wi.app_id = a.id AND wi.org_id = ${orgId})
  OR EXISTS (SELECT 1 FROM marketplace_subscriptions ms WHERE ms.app_id = a.id AND ms.org_id = ${orgId})
  OR EXISTS (SELECT 1 FROM workspace_addons wa JOIN plans ap ON ap.id = wa.package_id
              WHERE wa.org_id = ${orgId} AND ap.marketplace_app_id = a.id AND wa.status = 'active'
                AND (wa.ends_at IS NULL OR wa.ends_at > now()))
  OR EXISTS (SELECT 1 FROM org_plan_state ops WHERE ops.org_id = ${orgId}
              AND ops.overrides -> 'features' -> ('mkt_' || replace(a.slug, '-', '_')) = 'true'::jsonb))`;

/** The WHERE clause that hides what the workspace may not see. `a` is the `marketplace_apps` alias. */
export function shownToWorkspace(orgId: number, vis: PlanVisibility): SQL {
  return sql`(
    a.pricing_model <> 'paid_monthly'
    OR a.included_plan_feature IS NOT NULL OR a.included_min_plan IS NOT NULL
    OR ${vis.all}::boolean
    OR a.id = ANY(${ids(vis.appIds)})
    OR ${heldByWorkspace(orgId)})`;
}
