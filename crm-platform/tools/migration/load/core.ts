import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAccessConfig } from '../access/config';
import { mapPermissions, type KeyDef } from '../access/policy';
import { NdjsonDirSource } from '../extract/source';
import { buildRolePlan } from '../transform/access-plan';
import { docKeys, type Doc } from '../util';
import { bumpRolesVersion, featureResolver, planRow } from './access';
import { digest } from './baseline';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * geta_core -> WaDesk for one client: the plan, the subscription, the business facts and the role grants of the roles that are already
 * loaded. Input: dumps/<client>/core.json, written by pilot/staging/core-opening.cjs (no credentials, no personal data).
 *
 *  - plans: ONE hidden platform plan per Waboo plan code (is_active = false: nobody can pick it, an organization already on it keeps it).
 *    Limits and features start from the platform `enterprise` plan; only what the Waboo plan states is changed (users, segments, flows
 *    caps; forms and extra channels closed when the Waboo plan has them off). The whole Waboo config stays in subscriptions.meta.
 *  - organizations.plan = that slug; org_plan_state.plan_ends_at = the next billing date; the business facts go to settings.legacy.waboo.
 *  - subscriptions: one row, gateway 'zoho' (the Waboo ids are Zoho Subscriptions ids), status active.
 *  - role grants: the REVIEWED permission map applied to the custom roles the roles step already created (that step skips a loaded role).
 * Dry run by default. Idempotent: nothing that exists is overwritten.
 */
export interface CoreLoadOptions {
  dumpsDir: string;
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  apply: boolean;
  log: (line: string) => void;
}

interface Core {
  workspace: { id: string; businessId: string; status?: string; provider?: string; credits?: { currency?: string } };
  business: { id: string; name?: string; domain?: string; schemaName?: string };
  subscription: {
    id: string;
    planCode: string;
    name?: string;
    status?: string;
    amount?: number;
    subTotal?: number;
    interval?: number;
    intervalUnit?: string;
    activation?: string;
    lastBilling?: string;
    nextBilling?: string;
    customerId?: string;
    quantity?: number;
    discount?: number;
    config: Array<{ code: string; name?: string; status?: unknown; limit?: unknown; visible?: unknown }>;
  };
  sub?: { number?: string; invoiceId?: string; paymentMethod?: string; paymentTerms?: string };
  readOn: string;
}

const PLAN_SLUG = /^[a-z0-9_]{1,32}$/;
export const slugOfPlan = (code: string): string =>
  code.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);

const isOff = (s: unknown): boolean => s === false || String(s).toLowerCase() === 'inactive';
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Pure: the plan row a Waboo plan config becomes, on top of the base (enterprise) limits and features. */
export function derivePlan(
  core: Core,
  base: { limits: Record<string, number>; features: Record<string, boolean> },
): { slug: string; name: string; amount: number; limits: Record<string, number>; features: Record<string, boolean>; notes: string[] } {
  const s = core.subscription;
  const slug = slugOfPlan(s.planCode);
  if (!PLAN_SLUG.test(slug) || !/[a-z]/.test(slug)) throw new Error(`CORE_PLAN_SLUG: ${s.planCode} gives no valid plan slug`);
  const cfg = new Map(s.config.map((c) => [c.code, c]));
  const on = (code: string): boolean => cfg.has(code) && !isOff(cfg.get(code)!.status);
  const limits = { ...base.limits };
  const features = { ...base.features };
  const notes: string[] = [];
  const users = num(cfg.get('user_limit')?.limit);
  if (users && users > 0) limits.users = users;
  const segments = num(cfg.get('segments')?.limit);
  if (segments && segments > 0) limits.segments = segments;
  const autos = num(cfg.get('automation_builder')?.limit);
  const flows = num(cfg.get('flows_for_bot')?.limit);
  if (autos && flows) limits.flows = autos + flows;
  if (!on('forms') && !on('application_forms')) {
    features.form_builder = false;
    features.forms_and_links = false;
    notes.push('forms closed (the Waboo plan has them off)');
  }
  if (!on('channels')) {
    features.extra_channels = false;
    notes.push('extra channels closed (the Waboo plan has them off)');
  }
  return {
    slug,
    name: `${s.name ?? s.planCode} (Waboo ${s.planCode})`.slice(0, 120),
    amount: s.subTotal ?? 0,
    limits,
    features,
    notes,
  };
}

async function collect(it: AsyncIterable<Doc>): Promise<Doc[]> {
  const out: Doc[] = [];
  for await (const d of it) out.push(d);
  return out;
}

export async function coreLoad(o: CoreLoadOptions): Promise<void> {
  const core = JSON.parse(readFileSync(join(o.dumpsDir, o.client, 'core.json'), 'utf8')) as Core;
  if (!core.subscription?.planCode) throw new Error('CORE_EMPTY: core.json has no subscription');
  const owner = connect(o.ownerUrl, 'owner');
  const worker = connect(o.targetUrl, 'worker');
  try {
    // --- organization ----------------------------------------------------------------------------------------------------------
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(
          sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`,
        ),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org) throw new Error(`CORE_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);

    // --- plan ------------------------------------------------------------------------------------------------------------------
    const baseRow = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(sql`SELECT limits, features FROM plans WHERE slug = 'enterprise' AND kind = 'plan'`),
      )
    ).rows[0] as { limits: Record<string, number>; features: Record<string, boolean> } | undefined;
    if (!baseRow) throw new Error('CORE_NO_BASE_PLAN: the platform plan "enterprise" is missing');
    const plan = derivePlan(core, baseRow);
    const s = core.subscription;
    o.log(`  core  ${o.client}: org ${orgId}; Waboo plan ${s.planCode} -> platform plan "${plan.slug}" (hidden), price ${plan.amount}`);
    o.log(`  core  limits changed: ${Object.entries(plan.limits).filter(([k, v]) => baseRow.limits[k] !== v).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}; ${plan.notes.join('; ') || 'no feature closed'}`);

    // --- role grants (computed in both modes) ------------------------------------------------------------------------------------
    const config = loadAccessConfig();
    const roleDocs = await collect(new NdjsonDirSource(o.dumpsDir).read(o.client, 'roles'));
    const rolePlans = buildRolePlan(o.client, roleDocs, config);
    const defsRows = (await worker.db.execute(sql`SELECT key, category, supports_scope, plan_feature, app_slug FROM permission_defs`)).rows as Array<{
      key: string; category: string; supports_scope: boolean; plan_feature: string | null; app_slug: string | null;
    }>;
    const defs = new Map<string, KeyDef>(
      defsRows.map((r) => [r.key, { category: r.category, supportsScope: r.supports_scope, planFeature: r.plan_feature, appSlug: r.app_slug }]),
    );
    // the plan decides which feature-gated keys stay open: judge against the NEW plan's features (it is not stored yet in a dry run)
    const featureOpen = (f: string): boolean => plan.features[f] === true;
    const grantPlan: Array<{ name: string; roleId: number; grants: Array<{ key: string; scope: string }>; withheld: number; unmapped: number }> = [];
    for (const d of roleDocs) {
      const rp = rolePlans.get(docKeys(d)[0]?.key ?? '');
      if (!rp || rp.deleted || rp.target !== 'custom') continue;
      const res = mapPermissions({
        permissionConfig: d.permission_config,
        map: config.permissionMap,
        defs,
        featureOpen,
        allowAdminClass: Boolean(rp.entry?.allowAdminClass && rp.entry.approvedBy),
      });
      const mapped = (
        await worker.db.execute(
          sql`SELECT target_id FROM migration.id_map WHERE source_client = ${o.client} AND source_collection = 'roles' AND source_key = ${rp.key}`,
        )
      ).rows[0] as { target_id: number | string } | undefined;
      if (!mapped) {
        o.log(`  core  role ${rp.name}: not loaded yet, skipped`);
        continue;
      }
      grantPlan.push({ name: rp.name, roleId: Number(mapped.target_id), grants: res.grants, withheld: res.adminWithheld.length, unmapped: res.unmapped.length });
    }
    for (const g of grantPlan)
      o.log(`  core  role "${g.name}": ${g.grants.length} grants (${g.grants.filter((x) => x.scope === 'own').length} own-scope), ${g.withheld} admin-class withheld, ${g.unmapped} Waboo permissions grant nothing`);

    if (!o.apply) {
      o.log('  core  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
      return;
    }

    // --- write: platform plan, organization, plan state (owner connection) ---------------------------------------------------------
    const currency = (core.workspace.credits?.currency ?? 'INR').toUpperCase();
    const legacy = {
      coreBusinessId: core.business.id,
      coreSchema: core.business.schemaName ?? null,
      domain: core.business.domain ?? null,
      planCode: s.planCode,
      subscriptionId: s.id,
      customerId: s.customerId ?? null,
      provider: core.workspace.provider ?? null,
      readOn: core.readOn,
    };
    const periodEnd = s.nextBilling ? new Date(`${s.nextBilling}T00:00:00+05:30`).toISOString() : null;
    const planInserted = await withPrivileged(owner.db, async (tx) => {
      const ins = await tx.execute(sql`
        INSERT INTO plans (slug, name, detail, kind, amount, currency, billing_unit, billing_duration, is_active, is_default, sort_order, limits, features)
        VALUES (${plan.slug}, ${plan.name},
                ${`Created by the Waboo migration from the geta_core plan ${s.planCode}. Hidden: no new workspace can pick it.`},
                'plan', ${plan.amount}, ${currency}, 'months', ${s.interval ?? 1}, false, false, 900,
                ${JSON.stringify(plan.limits)}::jsonb, ${JSON.stringify(plan.features)}::jsonb)
        ON CONFLICT (slug) DO NOTHING RETURNING 1`);
      await tx.execute(sql`
        UPDATE organizations SET plan = ${plan.slug},
               settings = jsonb_set(settings, '{legacy,waboo}', coalesce(settings #> '{legacy,waboo}', '{}'::jsonb) || ${JSON.stringify(legacy)}::jsonb),
               updated_at = now()
        WHERE id = ${orgId}`);
      await tx.execute(sql`
        UPDATE org_plan_state SET plan_ends_at = ${periodEnd}::timestamptz, trial_ends_at = NULL, billing_cycle = 'monthly',
               updated_at = now(), row_version = row_version + 1
        WHERE org_id = ${orgId}`);
      return ins.rows.length > 0;
    });
    o.log(`  core  plan "${plan.slug}": ${planInserted ? 'created' : 'already existed, left as it is'}; organization on it; plan ends ${periodEnd ?? 'n/a'}`);

    // --- subscription (tenant) -------------------------------------------------------------------------------------------------------
    const meta = {
      legacy: {
        waboo: {
          planCode: s.planCode, planName: s.name ?? null, subscriptionNumber: core.sub?.number ?? null, invoiceId: core.sub?.invoiceId ?? null,
          paymentMethod: core.sub?.paymentMethod ?? null, paymentTerms: core.sub?.paymentTerms ?? null, subTotal: s.subTotal ?? null,
          discount: s.discount ?? null, quantity: s.quantity ?? null, activation: s.activation ?? null, lastBilling: s.lastBilling ?? null,
          interval: s.interval ?? null, intervalUnit: s.intervalUnit ?? null, status: s.status ?? null, config: s.config,
        },
      },
    };
    const subIns = await withTenant(worker.db, { orgId }, (tx) =>
      tx.execute(sql`
        INSERT INTO subscriptions (org_id, kind, plan_id, gateway, gateway_subscription_id, gateway_plan_id, gateway_customer_id, billing_cycle,
                                   status, amount, currency, current_period_end, renewals_count, meta, created_at)
        SELECT ${orgId}, 'plan', ${plan.slug}, 'zoho', ${s.id}, ${s.planCode}, ${s.customerId ?? null}, 'monthly',
               ${s.status === 'live' ? 'active' : 'pending'}, ${s.amount ?? plan.amount}, ${currency}, ${periodEnd}::timestamptz, 0,
               ${JSON.stringify(meta)}::jsonb, ${s.activation ? new Date(`${s.activation}T00:00:00+05:30`).toISOString() : null}::timestamptz
        WHERE NOT EXISTS (SELECT 1 FROM subscriptions x WHERE x.org_id = ${orgId} AND x.gateway = 'zoho' AND x.gateway_subscription_id = ${s.id})
        RETURNING 1`),
    );
    o.log(`  core  subscription ${s.id}: ${subIns.rows.length ? 'created (active)' : 'already existed'}`);

    // --- role grants (tenant) --------------------------------------------------------------------------------------------------------
    let inserted = 0;
    for (const g of grantPlan)
      for (const gr of g.grants) {
        const r = await withTenant(worker.db, { orgId }, (tx) =>
          tx.execute(sql`
            INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
            SELECT ${orgId}, ${g.roleId}, ${gr.key}, 'allow', ${gr.scope}
            WHERE NOT EXISTS (SELECT 1 FROM role_grants x WHERE x.org_id = ${orgId} AND x.role_id = ${g.roleId} AND x.permission_key = ${gr.key})
            RETURNING 1`),
        );
        inserted += r.rows.length;
      }
    o.log(`  core  role grants: ${inserted} inserted`);
    if (inserted > 0) {
      const b = await bumpRolesVersion({ client: o.client, orgId, ownerDb: owner.db, inserted: true, touched: true });
      o.log(`  core  roles_version ${b.before} -> ${b.after}`);
    }

    // --- the baseline: what this command changed is not an unexplained change to the verifier ------------------------------------
    await withPrivileged(owner.db, async (tx) => {
      const rec = (
        await tx.execute(
          sql`SELECT counts FROM migration.run_log WHERE source_client = ${o.client} AND collection = '_org' AND step = 'baseline'`,
        )
      ).rows[0] as { counts?: Record<string, string[]> } | undefined;
      if (!rec?.counts) return;
      const fresh = await digest(tx, orgId, ['org_plan_state', 'subscriptions']);
      await tx.execute(sql`
        UPDATE migration.run_log SET counts = ${JSON.stringify({ ...rec.counts, ...fresh })}::jsonb, updated_at = now()
        WHERE source_client = ${o.client} AND collection = '_org' AND step = 'baseline'`);
    });
    const after = await planRow(worker.db, orgId);
    o.log(`  core  done: plan found ${after?.plan_found ? 'yes' : 'no'}, feature gate sample (form_builder) ${featureResolver(after)('form_builder') ? 'open' : 'closed'}`);
  } finally {
    await worker.close();
    await owner.close();
  }
}
