import { sql } from 'drizzle-orm';
import type { PlanAddonImpactResponse } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

/**
 * For one plan (by slug): how many of its workspaces hold each plain add-on pack (no Marketplace app) with a subscription that still renews,
 * which is exactly the set `AddonRedundancyService` ends at the term end once the plan includes the pack. The operator reads it before
 * switching "Included in this plan" on. A count per pack, never a workspace name; packs nobody renews are left out.
 *
 * The same status list as the job (`active`, `past_due`) so the figure and the effect cannot drift. Runs in the operator's privileged
 * transaction (the plan store's), like the other cross-tenant counts of this module.
 */
export async function addonRenewalImpact(
  tx: Tx,
  planSlug: string,
): Promise<PlanAddonImpactResponse> {
  const res = await tx.execute(sql`
    SELECT p.uuid AS pack_id, count(DISTINCT s.org_id)::int AS renewing
    FROM organizations o
    JOIN subscriptions s ON s.org_id = o.id AND s.kind = 'addon' AND s.status IN ('active', 'past_due')
    JOIN workspace_addons wa ON wa.org_id = s.org_id AND wa.id = s.workspace_addon_id
    JOIN plans p ON p.id = wa.package_id AND p.marketplace_app_id IS NULL
    WHERE o.plan = ${planSlug}
    GROUP BY p.uuid
    ORDER BY p.uuid`);
  return {
    data: (res.rows as Raw[]).map((r) => ({
      packId: String(r.pack_id),
      renewing: Number(r.renewing),
    })),
  };
}
