import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/**
 * A workspace's own switch on an add-on it is entitled to (`workspace_addon_activation`, docs/specs/addons-lifecycle-and-permissions.md).
 * `disabled` is an opt-out: the features the add-on grants stop applying to that workspace, and (phase 2) the plan does not install it again.
 * No row means active. It covers plain add-ons and the add-on of a Marketplace app; the app's own install and uninstall write it too.
 *
 * Plain functions over a transaction, so the workspace's routes (tenant), the Marketplace's install and uninstall (tenant) and the operator's views
 * (privileged) share one definition.
 */

export type ActivationState = 'active' | 'disabled';
export type ActivationSource = 'user' | 'operator' | 'system';

type Raw = Record<string, unknown>;

/** Switches an add-on on or off for a workspace (one row per add-on; switching back on keeps the row as history). */
export async function setActivation(
  tx: Tx,
  orgId: number,
  addonId: number,
  state: ActivationState,
  by: { userId: number | null; source?: ActivationSource },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO workspace_addon_activation (org_id, addon_id, state, source, changed_by, changed_at)
    VALUES (${orgId}, ${addonId}, ${state}, ${by.source ?? 'user'}, ${by.userId}, now())
    ON CONFLICT (org_id, addon_id) DO UPDATE
      SET state = EXCLUDED.state, source = EXCLUDED.source, changed_by = EXCLUDED.changed_by, changed_at = now()`);
}

/** The add-on pack (plan row id) that sells a Marketplace app, or null when the app has none (a free app). */
export async function packIdOfApp(tx: Tx, appId: number): Promise<number | null> {
  const res = await tx.execute(
    sql`SELECT id::int AS id FROM plans WHERE kind = 'addon' AND marketplace_app_id = ${appId} LIMIT 1`,
  );
  return (res.rows[0] as { id: number } | undefined)?.id ?? null;
}

/**
 * An app's uninstall or disable records the workspace's opt-out on its add-on; an install or enable lifts one that exists (and writes nothing when
 * there is none, so an ordinary install leaves no row). A free app has no add-on: nothing to write. A pause the subscription caused is not an
 * opt-out and does not come through here.
 */
export async function syncAppActivation(
  tx: Tx,
  orgId: number,
  appId: number,
  state: ActivationState,
  userId: number | null,
): Promise<void> {
  const packId = await packIdOfApp(tx, appId);
  if (packId === null) return;
  if (state === 'disabled') {
    await setActivation(tx, orgId, packId, 'disabled', { userId });
    return;
  }
  await tx.execute(sql`
    UPDATE workspace_addon_activation SET state = 'active', source = 'user', changed_by = ${userId}, changed_at = now()
    WHERE org_id = ${orgId} AND addon_id = ${packId} AND state = 'disabled'`);
}

/** One workspace's activation by add-on row id (only what it has chosen): 'disabled' or 'active'. */
export async function activationOf(tx: Tx, orgId: number): Promise<Map<number, ActivationState>> {
  const res = await tx.execute(
    sql`SELECT addon_id::int AS addon_id, state FROM workspace_addon_activation WHERE org_id = ${orgId}`,
  );
  return new Map((res.rows as Raw[]).map((r) => [Number(r.addon_id), r.state as ActivationState]));
}
