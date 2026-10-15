import { isAdminClassKey } from '../access/admin-class';
import type { AccessConfig, PresetTarget } from '../access/config';
import { mapPermissions, type KeyDef } from '../access/policy';
import type { Source } from '../extract/source';
import { buildRolePlan, buildUserPlan, type AccessCtx } from '../transform/access-plan';
import type { TargetRef } from '../transform/types';
import { docKeys, type Doc } from '../util';
import { digest, type Baseline } from './baseline';
import { ORG_COLLECTION } from './org';
import { sql, withPrivileged, withTenant, type Database } from './db';

async function all(source: Source, client: string, collection: string): Promise<Doc[]> {
  if (!source.collections(client).includes(collection)) return [];
  const out: Doc[] = [];
  for await (const d of source.read(client, collection)) out.push(d);
  return out;
}

interface PlanRow {
  plan_found: boolean;
  platform_owned: boolean | null;
  overrides: { features?: Record<string, unknown> } | null;
  features: Record<string, unknown> | null;
  user_limit: string | null;
}

/** Same resolution order as PlanEntitlementService, but a flag nobody set is CLOSED here (fail closed), and an app is never installed yet. */
export function featureResolver(row: PlanRow | undefined): (feature: string) => boolean {
  return (feature) => {
    if (!row || !row.plan_found) return true; // no plan row: nothing is locked
    if (row.platform_owned) return true;
    const o = row.overrides?.features?.[feature];
    if (o !== undefined) return o === true;
    const p = row.features?.[feature];
    return p === true;
  };
}

export async function planRow(db: Database, orgId: number): Promise<PlanRow | undefined> {
  const r = await withTenant(db, { orgId }, (tx) =>
    tx.execute(sql`
      SELECT (p.id IS NOT NULL) AS plan_found, s.platform_owned, s.overrides, p.features,
             (p.limits->>'users') AS user_limit
      FROM organizations o
      LEFT JOIN org_plan_state s ON s.org_id = o.id
      LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
      WHERE o.id = ${orgId}`),
  );
  return r.rows[0] as unknown as PlanRow | undefined;
}

/** Everything the roles and users steps need from the target and the dump, read once before the steps run. */
export async function prepareAccess(a: {
  source: Source;
  client: string;
  db: Database;
  orgId: number;
  config: AccessConfig;
  ownerEmail: string | null;
}): Promise<{ access: AccessCtx; notes: string[] }> {
  const defsRows = (
    await a.db.execute(
      sql`SELECT key, category, supports_scope, plan_feature, app_slug FROM permission_defs`,
    )
  ).rows as Array<{
    key: string;
    category: string;
    supports_scope: boolean;
    plan_feature: string | null;
    app_slug: string | null;
  }>;
  const defs = new Map<string, KeyDef>(
    defsRows.map((r) => [
      r.key,
      {
        category: r.category,
        supportsScope: r.supports_scope,
        planFeature: r.plan_feature,
        appSlug: r.app_slug,
      },
    ]),
  );
  const presets: AccessCtx['presets'] = {};
  const presetRows = await withTenant(a.db, { orgId: a.orgId }, (tx) =>
    tx.execute(
      sql`SELECT id, uuid::text AS uuid, system_key FROM roles WHERE org_id = ${a.orgId} AND system_key IS NOT NULL`,
    ),
  );
  for (const r of presetRows.rows as Array<{
    id: number | string;
    uuid: string;
    system_key: string;
  }>)
    presets[r.system_key as 'admin' | PresetTarget] = {
      table: 'roles',
      id: Number(r.id),
      uuid: r.uuid,
    } satisfies TargetRef;
  const featureOpen = featureResolver(await planRow(a.db, a.orgId));

  const roleDocs = await all(a.source, a.client, 'roles');
  const userDocs = await all(a.source, a.client, 'user');
  const access: AccessCtx = {
    client: a.client,
    config: a.config,
    defs,
    featureOpen,
    presets,
    ownerEmail: a.ownerEmail,
    roles: buildRolePlan(a.client, roleDocs, a.config),
    users: buildUserPlan(userDocs, a.ownerEmail),
  };

  // the admin-class denylist as compiled from this target's catalogue, and the plan-gap table, for the run log
  const notes: string[] = [];
  const admin = [...defs].filter(([k, d]) => isAdminClassKey(k, d.category)).map(([k]) => k);
  notes.push(`admin-class keys withheld from migrated roles unless approved: ${admin.length}`);
  const need = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const d of roleDocs) {
    const plan = access.roles.get(docKeys(d)[0]?.key ?? '');
    if (!plan || seen.has(plan.key) || plan.deleted || plan.target !== 'custom') continue;
    seen.add(plan.key);
    const res = mapPermissions({
      permissionConfig: d.permission_config,
      map: a.config.permissionMap,
      defs,
      featureOpen: () => true,
      allowAdminClass: true,
    });
    for (const g of res.grants) {
      const f = defs.get(g.key)?.planFeature;
      if (f && !featureOpen(f)) need.set(f, (need.get(f) ?? new Set()).add(plan.name));
    }
  }
  for (const [f, rs] of need)
    notes.push(
      `PLAN GAP: feature "${f}" is closed for this plan but used by role(s) ${[...rs].join(', ')}; their grants of it are withheld (PERM_PLAN_LOCKED)`,
    );
  return { access, notes };
}

/** Users counted like MembersRepository.seatsUsed (status <> inactive) against plans.limits.users (0 or none = unlimited). */
export async function seatWarning(db: Database, orgId: number): Promise<string | null> {
  const plan = await planRow(db, orgId);
  const limit = Number(plan?.user_limit ?? 0);
  if (!limit || limit < 0) return null;
  const n = await withTenant(db, { orgId }, (tx) =>
    tx.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE org_id = ${orgId} AND status <> 'inactive'`,
    ),
  );
  const used = (n.rows[0] as { n: number }).n;
  return used > limit
    ? `SEATS: ${used} active users but the plan allows ${limit}: the app will refuse new invitations until seats are freed`
    : null;
}

export const ROLES_VERSION_STEP = 'roles-version';

/**
 * RBAC caches a grant set per organization under roles_version: after roles, grants or assignments were written, bump it once so no
 * stale answer survives. Done by the owner connection (the worker cannot write organizations). The organizations row is part of the
 * baseline digest, so the new digest is recorded in the same transaction.
 */
export async function bumpRolesVersion(a: {
  client: string;
  orgId: number;
  ownerDb: Database;
  inserted: boolean;
  touched: boolean;
}): Promise<{ bumped: boolean; before: number; after: number }> {
  return withPrivileged(a.ownerDb, async (tx) => {
    const cur = await tx.execute(
      sql`SELECT roles_version FROM organizations WHERE id = ${a.orgId}`,
    );
    const now = Number((cur.rows[0] as { roles_version: number | string }).roles_version);
    const marker = (
      await tx.execute(
        sql`SELECT counts FROM migration.run_log WHERE source_client = ${a.client} AND collection = ${ORG_COLLECTION} AND step = ${ROLES_VERSION_STEP}`,
      )
    ).rows[0] as { counts?: { before: number; after: number } } | undefined;
    if (!a.touched || (marker?.counts && !a.inserted))
      return { bumped: false, before: marker?.counts?.before ?? now, after: now };
    await tx.execute(
      sql`UPDATE organizations SET roles_version = roles_version + 1 WHERE id = ${a.orgId}`,
    );
    const after = now + 1;
    const before = marker?.counts?.before ?? now;
    await tx.execute(sql`
      INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
      VALUES (${a.client}, ${ORG_COLLECTION}, ${ROLES_VERSION_STEP}, 'access', 0, 'done', ${JSON.stringify({ before, after })}::jsonb)
      ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
    // the organizations row is in the baseline: record its new digest
    const rec = (
      await tx.execute(
        sql`SELECT counts FROM migration.run_log WHERE source_client = ${a.client} AND collection = ${ORG_COLLECTION} AND step = 'baseline'`,
      )
    ).rows[0] as { counts?: Baseline } | undefined;
    if (rec?.counts) {
      const fresh = await digest(tx, a.orgId, []);
      await tx.execute(sql`
        UPDATE migration.run_log SET counts = ${JSON.stringify({ ...rec.counts, organizations: fresh.organizations })}::jsonb, updated_at = now()
        WHERE source_client = ${a.client} AND collection = ${ORG_COLLECTION} AND step = 'baseline'`);
    }
    return { bumped: true, before, after };
  });
}
