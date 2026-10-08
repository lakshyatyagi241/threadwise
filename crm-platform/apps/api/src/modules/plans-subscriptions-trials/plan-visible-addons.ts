import { sql } from 'drizzle-orm';
import type {
  PlanAddonOption,
  PlanBillingUnit,
  VisibleAddon,
  WorkspaceAddons,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';

/**
 * The plan -> Marketplace add-on visibility (`plan_visible_addons`). A plan makes a paid app's add-on VISIBLE to the workspaces on it;
 * nothing here grants it. Whether a workspace OWNS an add-on is `workspace_addons` (an active purchase, trial or comp), which is what the
 * entitlement service reads to let it use the app.
 *
 * Plain functions over a transaction, so the operator's writes (privileged), a workspace's reads (tenant) and the operator's per-workspace
 * view (privileged) share one definition of "visible" and of "owned".
 */

type Raw = Record<string, unknown>;

/** The add-on is held by the workspace right now: a purchase, trial or comp that has not ended. */
const OWNED = (orgId: number) => sql`EXISTS (
  SELECT 1 FROM workspace_addons wa
   WHERE wa.org_id = ${orgId} AND wa.package_id = ap.id AND wa.status = 'active'
     AND (wa.ends_at IS NULL OR wa.ends_at > now()))`;

const periodOf = (r: Raw) => ({
  unit: r.billing_unit as PlanBillingUnit,
  count: Number(r.billing_duration),
});

function toVisible(r: Raw): VisibleAddon {
  return {
    id: r.id as string,
    packSlug: r.pack_slug as string,
    app: { id: r.app_uuid as string, slug: r.app_slug as string, name: r.app_name as string },
    price: { amount: r.amount as string, currency: r.currency as string, period: periodOf(r) },
    owned: Boolean(r.owned),
  };
}

/** Every Marketplace add-on pack, for the plan form's selector: published ones first, then by app name. */
export async function addonOptions(tx: Tx): Promise<PlanAddonOption[]> {
  const res = await tx.execute(sql`
    SELECT ap.uuid AS id, ap.slug AS pack_slug, ap.name, ap.is_active, ap.amount::text AS amount, ap.currency,
           ap.billing_unit, ap.billing_duration,
           a.uuid AS app_uuid, a.slug AS app_slug, a.name AS app_name, a.status AS app_status
    FROM plans ap
    JOIN marketplace_apps a ON a.id = ap.marketplace_app_id
    WHERE ap.kind = 'addon'
    ORDER BY (a.status = 'published') DESC, lower(a.name), a.id`);
  return (res.rows as Raw[]).map((r) => ({
    id: r.id as string,
    packSlug: r.pack_slug as string,
    name: r.name as string,
    isActive: Boolean(r.is_active),
    amount: r.amount as string,
    currency: r.currency as string,
    billingUnit: r.billing_unit as PlanBillingUnit,
    billingDuration: Number(r.billing_duration),
    app: {
      id: r.app_uuid as string,
      slug: r.app_slug as string,
      name: r.app_name as string,
      status: r.app_status as string,
    },
  }));
}

/** The pack uuids each plan (by row id) makes visible, for every plan at once (the operator's list). */
export async function visibleAddonIdsByPlan(tx: Tx): Promise<Map<number, string[]>> {
  const res = await tx.execute(sql`
    SELECT pv.plan_id::text AS plan_id, ap.uuid AS id
    FROM plan_visible_addons pv JOIN plans ap ON ap.id = pv.addon_plan_id
    ORDER BY ap.id`);
  const out = new Map<number, string[]>();
  for (const r of res.rows as Raw[]) {
    const k = Number(r.plan_id);
    out.set(k, [...(out.get(k) ?? []), r.id as string]);
  }
  return out;
}

export async function visibleAddonIds(tx: Tx, planId: number): Promise<string[]> {
  return (await visibleAddonIdsByPlan(tx)).get(planId) ?? [];
}

/**
 * Makes `packIds` (pack uuids) exactly the set the plan shows. Every id must be an add-on pack of a Marketplace app: a plan, a plain
 * add-on or an unknown id is a validation error naming it (the table's trigger holds the same rule for any other writer). Returns what
 * changed, for the audit event.
 */
export async function replaceVisibleAddons(
  tx: Tx,
  planId: number,
  packIds: readonly string[],
): Promise<{ added: string[]; removed: string[] }> {
  const wanted = [...new Set(packIds)];
  const found = new Map<string, number>();
  if (wanted.length > 0) {
    const res = await tx.execute(sql`
      SELECT uuid, id::text AS id FROM plans
      WHERE kind = 'addon' AND marketplace_app_id IS NOT NULL
        AND uuid = ANY(${`{${wanted.join(',')}}`}::uuid[])`);
    for (const r of res.rows as Raw[]) found.set(r.uuid as string, Number(r.id));
  }
  const unknown = wanted.filter((u) => !found.has(u));
  if (unknown.length > 0)
    throw AppError.validation(
      'Only add-ons of Marketplace apps can be made visible on a plan.',
      unknown.map((u) => ({ path: 'visibleAddons', message: `unknown_addon:${u}` })),
    );

  const current = await tx.execute(sql`
    SELECT pv.addon_plan_id::text AS addon_plan_id, ap.uuid AS uuid
    FROM plan_visible_addons pv JOIN plans ap ON ap.id = pv.addon_plan_id
    WHERE pv.plan_id = ${planId} FOR UPDATE OF pv`);
  const have = new Map(
    (current.rows as Raw[]).map((r) => [r.uuid as string, Number(r.addon_plan_id)]),
  );
  const added = wanted.filter((u) => !have.has(u));
  const removed = [...have.keys()].filter((u) => !found.has(u));
  for (const u of added)
    await tx.execute(
      sql`INSERT INTO plan_visible_addons (plan_id, addon_plan_id) VALUES (${planId}, ${found.get(u)!})`,
    );
  for (const u of removed)
    await tx.execute(
      sql`DELETE FROM plan_visible_addons WHERE plan_id = ${planId} AND addon_plan_id = ${have.get(u)!}`,
    );
  return { added, removed };
}

/**
 * The published add-ons each of the given plans (by row id) makes visible, with whether workspace `orgId` owns each. Draft, in-review,
 * hidden and killed listings are left out: a plan can enable a pack whose app is not on sale yet, and it appears once the app is published.
 */
export async function visibleAddonsByPlan(
  tx: Tx,
  orgId: number,
  planIds: readonly number[],
): Promise<Map<number, VisibleAddon[]>> {
  const out = new Map<number, VisibleAddon[]>();
  if (planIds.length === 0) return out;
  const res = await tx.execute(sql`
    SELECT pv.plan_id::text AS plan_id, ap.uuid AS id, ap.slug AS pack_slug, ap.amount::text AS amount, ap.currency,
           ap.billing_unit, ap.billing_duration, a.uuid AS app_uuid, a.slug AS app_slug, a.name AS app_name,
           ${OWNED(orgId)} AS owned
    FROM plan_visible_addons pv
    JOIN plans ap ON ap.id = pv.addon_plan_id AND ap.is_active
    JOIN marketplace_apps a ON a.id = ap.marketplace_app_id AND a.status = 'published'
    WHERE pv.plan_id = ANY(${`{${planIds.join(',')}}`}::bigint[])
    ORDER BY lower(a.name), a.id`);
  for (const r of res.rows as Raw[]) {
    const k = Number(r.plan_id);
    out.set(k, [...(out.get(k) ?? []), toVisible(r)]);
  }
  return out;
}

/**
 * The published add-ons a workspace's entitlements make visible (`Entitlements.visibleApps`: everything for a platform-owned workspace
 * or one with no plan row, else the plan's set, the free plan's for a lapsed one), with whether it owns each.
 */
export async function visibleAddonsForApps(
  tx: Tx,
  orgId: number,
  visible: { all: boolean; appIds: ReadonlySet<number> },
): Promise<VisibleAddon[]> {
  if (!visible.all && visible.appIds.size === 0) return [];
  const scope = visible.all
    ? sql`true`
    : sql`ap.marketplace_app_id = ANY(${`{${[...visible.appIds].join(',')}}`}::bigint[])`;
  const res = await tx.execute(sql`
    SELECT ap.uuid AS id, ap.slug AS pack_slug, ap.amount::text AS amount, ap.currency, ap.billing_unit, ap.billing_duration,
           a.uuid AS app_uuid, a.slug AS app_slug, a.name AS app_name, ${OWNED(orgId)} AS owned
    FROM plans ap
    JOIN marketplace_apps a ON a.id = ap.marketplace_app_id AND a.status = 'published'
    WHERE ap.kind = 'addon' AND ap.is_active AND ${scope}
    ORDER BY lower(a.name), a.id`);
  return (res.rows as Raw[]).map(toVisible);
}

/** What the operator sees of one workspace: what its plan makes visible (with owned), and everything it owns now. */
export async function workspaceAddons(
  tx: Tx,
  orgId: number,
  planId: number | null,
  platformOwned: boolean,
): Promise<WorkspaceAddons> {
  // Same rule as the entitlement resolver: nothing narrows a platform-owned workspace or one whose plan has no catalogue row.
  const visible =
    platformOwned || planId === null
      ? await visibleAddonsForApps(tx, orgId, { all: true, appIds: new Set() })
      : ((await visibleAddonsByPlan(tx, orgId, [planId])).get(planId) ?? []);
  const owned = await tx.execute(sql`
    SELECT ap.uuid AS id, ap.slug AS pack_slug, a.uuid AS app_uuid, a.slug AS app_slug, a.name AS app_name,
           max(wa.ends_at) AS ends_at, bool_or(wa.ends_at IS NULL) AS open_ended,
           ${platformOwned || planId === null ? sql`true` : sql`EXISTS (SELECT 1 FROM plan_visible_addons pv WHERE pv.plan_id = ${planId} AND pv.addon_plan_id = ap.id)`} AS visible_on_plan
    FROM workspace_addons wa
    JOIN plans ap ON ap.id = wa.package_id AND ap.marketplace_app_id IS NOT NULL
    JOIN marketplace_apps a ON a.id = ap.marketplace_app_id
    WHERE wa.org_id = ${orgId} AND wa.status = 'active' AND (wa.ends_at IS NULL OR wa.ends_at > now())
    GROUP BY ap.id, a.id
    ORDER BY lower(a.name), a.id`);
  return {
    visible,
    owned: (owned.rows as Raw[]).map((r) => ({
      id: r.id as string,
      packSlug: r.pack_slug as string,
      app: { id: r.app_uuid as string, slug: r.app_slug as string, name: r.app_name as string },
      endsAt: r.open_ended || !r.ends_at ? null : new Date(r.ends_at as string).toISOString(),
      visibleOnPlan: Boolean(r.visible_on_plan),
    })),
  };
}
