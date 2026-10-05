import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { MarketAppKind, MarketAppStatus, MarketVersionStatus } from '@crm/contracts';
import { PlatformStore } from '../auth';
import { decodeKeyset, encodeKeyset, likePattern, type AppRef } from './marketplace-rules';
import { APP_PRICING_COLUMNS_TEXT, readAppPricing, type AppPricingRow } from './pricing-model';
import { jsonb, textArray, toDate } from './sql-helpers';

type Raw = Record<string, unknown>;

export interface OpAppRow {
  id: number;
  uuid: string;
  slug: string;
  kind: MarketAppKind;
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  name: string;
  tagline: string;
  status: MarketAppStatus;
  firstParty: boolean;
  featured: boolean;
  planFeature: string | null;
  pricing: AppPricingRow;
  /** The add-on that sells the app exists (the app has been priced at least once). */
  packExists: boolean;
  /** Subscriptions in force: not ending, not ended. */
  activeSubscriptions: number;
  sortOrder: number;
  connectorType: string | null;
  listing: Record<string, unknown>;
  currentVersionId: number | null;
  publishedVersion: string | null;
  latestVersion: string | null;
  installCount: number;
  killReason: string | null;
  killedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
  cursor: string;
}

export interface OpVersionRow {
  id: number;
  uuid: string;
  appId: number;
  version: string;
  status: MarketVersionStatus;
  manifest: Record<string, unknown>;
  recipe: Record<string, unknown> | null;
  scopes: string[];
  changelog: string;
  reviewNote: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  rowVersion: number;
}

export interface OpCategoryRow {
  id: number;
  uuid: string;
  kind: MarketAppKind;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  appCount: number;
  rowVersion: number;
}

const APP_COLUMNS = sql.raw(`
  a.id, a.uuid, a.slug, a.kind, a.category_id, c.slug AS category_slug, c.name AS category_name, a.name, a.tagline, a.status, a.first_party,
  a.featured, a.plan_feature, a.sort_order, a.connector_type, a.listing, a.current_version_id, pv.version AS published_version,
  ${APP_PRICING_COLUMNS_TEXT},
  EXISTS (SELECT 1 FROM plans p WHERE p.marketplace_app_id = a.id) AS pack_exists,
  (SELECT count(*)::int FROM marketplace_subscriptions s WHERE s.app_id = a.id AND s.status = 'active' AND NOT s.cancel_at_period_end
     AND (s.current_period_end IS NULL OR s.current_period_end > now())) AS active_subs,
  (SELECT v.version FROM marketplace_app_versions v WHERE v.app_id = a.id ORDER BY v.created_at DESC, v.id DESC LIMIT 1) AS latest_version,
  a.install_count, a.kill_reason, a.killed_at, a.published_at, a.created_at, a.updated_at, a.row_version, a.created_at::text AS k0`);
const APP_FROM = sql`
  FROM marketplace_apps a
  JOIN marketplace_categories c ON c.id = a.category_id
  LEFT JOIN marketplace_app_versions pv ON pv.id = a.current_version_id AND pv.status = 'published'`;

const toApp = (r: Raw): OpAppRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  slug: r.slug as string,
  kind: r.kind as MarketAppKind,
  categoryId: Number(r.category_id),
  categorySlug: r.category_slug as string,
  categoryName: r.category_name as string,
  name: r.name as string,
  tagline: r.tagline as string,
  status: r.status as MarketAppStatus,
  firstParty: r.first_party as boolean,
  featured: r.featured as boolean,
  planFeature: (r.plan_feature as string | null) ?? null,
  pricing: readAppPricing(r),
  packExists: r.pack_exists === true,
  activeSubscriptions: Number(r.active_subs ?? 0),
  sortOrder: Number(r.sort_order),
  connectorType: (r.connector_type as string | null) ?? null,
  listing: (r.listing as Record<string, unknown>) ?? {},
  currentVersionId: r.current_version_id === null ? null : Number(r.current_version_id),
  publishedVersion: (r.published_version as string | null) ?? null,
  latestVersion: (r.latest_version as string | null) ?? null,
  installCount: Number(r.install_count),
  killReason: (r.kill_reason as string | null) ?? null,
  killedAt: toDate(r.killed_at),
  publishedAt: toDate(r.published_at),
  createdAt: toDate(r.created_at)!,
  updatedAt: toDate(r.updated_at)!,
  rowVersion: Number(r.row_version),
  cursor: encodeKeyset([String(r.k0)], Number(r.id)),
});

const toVersion = (r: Raw): OpVersionRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  appId: Number(r.app_id),
  version: r.version as string,
  status: r.status as MarketVersionStatus,
  manifest: r.manifest as Record<string, unknown>,
  recipe: (r.recipe as Record<string, unknown> | null) ?? null,
  scopes: (r.scopes as string[]) ?? [],
  changelog: r.changelog as string,
  reviewNote: (r.review_note as string | null) ?? null,
  submittedAt: toDate(r.submitted_at),
  reviewedAt: toDate(r.reviewed_at),
  publishedAt: toDate(r.published_at),
  createdAt: toDate(r.created_at)!,
  rowVersion: Number(r.row_version),
});

const toCategory = (r: Raw): OpCategoryRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  kind: r.kind as MarketAppKind,
  slug: r.slug as string,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  icon: (r.icon as string | null) ?? null,
  sortOrder: Number(r.sort_order),
  isActive: r.is_active as boolean,
  appCount: Number(r.app_count ?? 0),
  rowVersion: Number(r.row_version),
});

const ref = (r: AppRef): SQL =>
  r.by === 'uuid' ? sql`a.uuid = ${r.value}::uuid` : sql`a.slug = ${r.value}`;

/**
 * Every statement of the operator's catalogue work, on the platform store (the privileged door). The catalogue is platform data: nothing
 * here takes an org except the cross-workspace statements of publishing and the kill switch, which act on every installation of one app.
 */
@Injectable()
export class OperatorCatalogueStore {
  constructor(private readonly platform: PlatformStore) {}

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.platform.tx(fn);
  }

  // --- categories ---------------------------------------------------------------------------------------------------------------------

  async categories(tx: Tx): Promise<OpCategoryRow[]> {
    const res = await tx.execute(sql`
      SELECT c.*, (SELECT count(*) FROM marketplace_apps a WHERE a.category_id = c.id)::int AS app_count
      FROM marketplace_categories c ORDER BY c.kind, c.sort_order, c.name`);
    return (res.rows as Raw[]).map(toCategory);
  }

  async categoryByUuid(tx: Tx, uuid: string): Promise<OpCategoryRow | null> {
    const res = await tx.execute(sql`
      SELECT c.*, (SELECT count(*) FROM marketplace_apps a WHERE a.category_id = c.id)::int AS app_count
      FROM marketplace_categories c WHERE c.uuid = ${uuid}::uuid`);
    const r = (res.rows as Raw[])[0];
    return r ? toCategory(r) : null;
  }

  async categoryBySlug(tx: Tx, kind: string, slug: string): Promise<OpCategoryRow | null> {
    const res = await tx.execute(sql`
      SELECT c.*, 0 AS app_count FROM marketplace_categories c WHERE c.kind = ${kind} AND c.slug = ${slug}`);
    const r = (res.rows as Raw[])[0];
    return r ? toCategory(r) : null;
  }

  async insertCategory(
    tx: Tx,
    c: {
      kind: string;
      slug: string;
      name: string;
      description: string | null;
      icon: string | null;
      sortOrder: number;
    },
  ): Promise<string> {
    const res = await tx.execute(sql`
      INSERT INTO marketplace_categories (kind, slug, name, description, icon, sort_order)
      VALUES (${c.kind}, ${c.slug}, ${c.name}, ${c.description}, ${c.icon}, ${c.sortOrder}) RETURNING uuid`);
    return (res.rows as Raw[])[0]!.uuid as string;
  }

  async updateCategory(
    tx: Tx,
    id: number,
    patch: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<boolean> {
    const sets = this.sets(patch);
    if (sets.length === 0) return true;
    const res = await tx.execute(sql`
      UPDATE marketplace_categories SET ${sql.join(sets, sql`, `)} WHERE id = ${id} AND row_version = ${expectedVersion} RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  async deleteCategory(tx: Tx, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM marketplace_categories WHERE id = ${id}`);
  }

  // --- apps ----------------------------------------------------------------------------------------------------------------------------

  async apps(
    tx: Tx,
    q: {
      status?: string;
      kind?: string;
      pricing?: 'free' | 'paid';
      q?: string;
      limit: number;
      cursor?: string;
    },
  ): Promise<{ rows: OpAppRow[]; badCursor: boolean }> {
    const where: SQL[] = [sql`true`];
    if (q.status) where.push(sql`a.status = ${q.status}`);
    if (q.kind) where.push(sql`a.kind = ${q.kind}`);
    if (q.pricing === 'free') where.push(sql`a.pricing_model = 'free'`);
    if (q.pricing === 'paid') where.push(sql`a.pricing_model <> 'free'`);
    if (q.q)
      where.push(sql`(a.name ILIKE ${likePattern(q.q)} OR a.slug ILIKE ${likePattern(q.q)})`);
    if (q.cursor) {
      const k = decodeKeyset(q.cursor, 1);
      if (!k) return { rows: [], badCursor: true };
      where.push(sql`(a.created_at, a.id) < (${k.keys[0]!}::timestamptz, ${k.id}::bigint)`);
    }
    const res = await tx.execute(sql`
      SELECT ${APP_COLUMNS} ${APP_FROM} WHERE ${sql.join(where, sql` AND `)}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${q.limit + 1}`);
    return { rows: (res.rows as Raw[]).map(toApp), badCursor: false };
  }

  async app(tx: Tx, r: AppRef, forUpdate = false): Promise<OpAppRow | null> {
    const res = await tx.execute(sql`
      SELECT ${APP_COLUMNS} ${APP_FROM} WHERE ${ref(r)} ${forUpdate ? sql`FOR UPDATE OF a` : sql``}`);
    const row = (res.rows as Raw[])[0];
    return row ? toApp(row) : null;
  }

  async insertApp(
    tx: Tx,
    a: {
      slug: string;
      kind: string;
      categoryId: number;
      name: string;
      tagline: string;
      firstParty: boolean;
      featured: boolean;
      planFeature: string | null;
      sortOrder: number;
      connectorType: string | null;
      listing: Record<string, unknown>;
      operatorId: number;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO marketplace_apps
        (slug, kind, category_id, name, tagline, first_party, featured, plan_feature, sort_order, connector_type, listing, created_by_operator_id)
      VALUES (${a.slug}, ${a.kind}, ${a.categoryId}, ${a.name}, ${a.tagline}, ${a.firstParty}, ${a.featured}, ${a.planFeature},
              ${a.sortOrder}, ${a.connectorType}, ${jsonb(a.listing)}, ${a.operatorId})
      RETURNING id`);
    return Number((res.rows as Raw[])[0]!.id);
  }

  /** Column (snake) to value; optimistic when `expectedVersion` is given. */
  async updateApp(
    tx: Tx,
    id: number,
    patch: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<boolean> {
    const sets = this.sets(patch);
    if (sets.length === 0) return true;
    const version =
      expectedVersion === undefined ? sql`` : sql` AND row_version = ${expectedVersion}`;
    const res = await tx.execute(
      sql`UPDATE marketplace_apps SET ${sql.join(sets, sql`, `)} WHERE id = ${id}${version} RETURNING id`,
    );
    return (res.rows as Raw[]).length > 0;
  }

  async deleteApp(tx: Tx, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM marketplace_apps WHERE id = ${id}`);
  }

  // --- pricing ------------------------------------------------------------------------------------------------------------------------

  /** Writes the operator's pricing of an app; false when `expectedVersion` is stale. */
  async setPricing(
    tx: Tx,
    id: number,
    p: {
      model: string;
      amount: string | null;
      currency: string | null;
      annualAmount: string | null;
      trialDays: number;
      purchasable: boolean;
      includedPlanFeature: string | null;
      includedMinPlan: string | null;
      grantsPlanFeatures: string[];
      grandfatherExisting: boolean;
      priceChanged: boolean;
    },
    expectedVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE marketplace_apps SET
        pricing_model = ${p.model}, price_amount = ${p.amount}::numeric, price_currency = ${p.currency},
        annual_amount = ${p.annualAmount}::numeric, trial_days = ${p.trialDays}, purchasable = ${p.purchasable},
        included_plan_feature = ${p.includedPlanFeature}, included_min_plan = ${p.includedMinPlan},
        grants_plan_features = ${textArray(p.grantsPlanFeatures)}, grandfather_existing = ${p.grandfatherExisting},
        price_changed_at = ${p.priceChanged ? sql`now()` : sql`price_changed_at`}
      WHERE id = ${id} AND row_version = ${expectedVersion} RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  /**
   * Creates or updates the billing add-on that sells the app: one month, the app's price, granting the one feature key that entitles a
   * workspace. Active while the app is paid; checkout, not this flag, decides whether the app may be sold right now.
   */
  async upsertPack(
    tx: Tx,
    p: {
      appId: number;
      slug: string;
      name: string;
      amount: string;
      currency: string;
      /** The feature keys the add-on grants: the app's own entitlement key, plus the plan features a first-party app owns. */
      features: string[];
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO plans (slug, kind, name, amount, currency, billing_unit, billing_duration, is_free, is_lifetime, is_active, sort_order,
                         cta_label, limits, features, marketplace_app_id)
      VALUES (${p.slug}, 'addon', ${p.name}, ${p.amount}::numeric, ${p.currency}, 'months', 1, false, false, true, 9000,
              'Subscribe', '{}'::jsonb, ${jsonb(Object.fromEntries(p.features.map((k) => [k, true])))}, ${p.appId})
      ON CONFLICT (marketplace_app_id) WHERE marketplace_app_id IS NOT NULL DO UPDATE SET
        name = EXCLUDED.name, amount = EXCLUDED.amount, currency = EXCLUDED.currency, is_active = true,
        features = EXCLUDED.features`);
  }

  /** The app is free now: its add-on can no longer be bought. Workspaces that hold it keep it until it ends. */
  async deactivatePack(tx: Tx, appId: number): Promise<void> {
    await tx.execute(sql`UPDATE plans SET is_active = false WHERE marketplace_app_id = ${appId}`);
  }

  async currencyActive(tx: Tx, code: string): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM currencies WHERE upper(code) = ${code} AND is_active`,
    );
    return (res.rows as Raw[]).length > 0;
  }

  async planExists(tx: Tx, slug: string): Promise<boolean> {
    const res = await tx.execute(sql`SELECT 1 FROM plans WHERE slug = ${slug} AND kind = 'plan'`);
    return (res.rows as Raw[]).length > 0;
  }

  // --- versions -------------------------------------------------------------------------------------------------------------------------

  async versions(tx: Tx, appId: number): Promise<OpVersionRow[]> {
    const res = await tx.execute(
      sql`SELECT * FROM marketplace_app_versions WHERE app_id = ${appId} ORDER BY created_at DESC, id DESC`,
    );
    return (res.rows as Raw[]).map(toVersion);
  }

  async version(
    tx: Tx,
    appId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<OpVersionRow | null> {
    const res = await tx.execute(sql`
      SELECT * FROM marketplace_app_versions WHERE app_id = ${appId} AND uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const r = (res.rows as Raw[])[0];
    return r ? toVersion(r) : null;
  }

  async versionById(tx: Tx, id: number): Promise<OpVersionRow | null> {
    const res = await tx.execute(sql`SELECT * FROM marketplace_app_versions WHERE id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toVersion(r) : null;
  }

  async latestApproved(tx: Tx, appId: number): Promise<OpVersionRow | null> {
    const res = await tx.execute(sql`
      SELECT * FROM marketplace_app_versions WHERE app_id = ${appId} AND status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 1`);
    const r = (res.rows as Raw[])[0];
    return r ? toVersion(r) : null;
  }

  async insertVersion(
    tx: Tx,
    v: {
      appId: number;
      version: string;
      manifest: unknown;
      recipe: unknown | null;
      scopes: string[];
      changelog: string;
      operatorId: number;
    },
  ): Promise<string> {
    const res = await tx.execute(sql`
      INSERT INTO marketplace_app_versions (app_id, version, manifest, recipe, scopes, changelog, created_by_operator_id)
      VALUES (${v.appId}, ${v.version}, ${jsonb(v.manifest)}, ${v.recipe === null ? sql`NULL` : jsonb(v.recipe)}, ${textArray(v.scopes)},
              ${v.changelog}, ${v.operatorId})
      RETURNING uuid`);
    return (res.rows as Raw[])[0]!.uuid as string;
  }

  async updateVersion(
    tx: Tx,
    id: number,
    patch: {
      version?: string;
      manifest?: unknown;
      recipe?: unknown | null;
      scopes?: string[];
      changelog?: string;
      status?: string;
      reviewNote?: string | null;
      submittedAt?: Date | null;
      reviewedAt?: Date | null;
      reviewedBy?: number | null;
      publishedAt?: Date | null;
    },
  ): Promise<void> {
    const sets: SQL[] = [];
    if (patch.version !== undefined) sets.push(sql`version = ${patch.version}`);
    if (patch.manifest !== undefined) sets.push(sql`manifest = ${jsonb(patch.manifest)}`);
    if (patch.recipe !== undefined)
      sets.push(sql`recipe = ${patch.recipe === null ? sql`NULL` : jsonb(patch.recipe)}`);
    if (patch.scopes !== undefined) sets.push(sql`scopes = ${textArray(patch.scopes)}`);
    if (patch.changelog !== undefined) sets.push(sql`changelog = ${patch.changelog}`);
    if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
    if (patch.reviewNote !== undefined) sets.push(sql`review_note = ${patch.reviewNote}`);
    if (patch.submittedAt !== undefined)
      sets.push(
        sql`submitted_at = ${patch.submittedAt ? sql`${patch.submittedAt.toISOString()}::timestamptz` : sql`NULL`}`,
      );
    if (patch.reviewedAt !== undefined)
      sets.push(
        sql`reviewed_at = ${patch.reviewedAt ? sql`${patch.reviewedAt.toISOString()}::timestamptz` : sql`NULL`}`,
      );
    if (patch.reviewedBy !== undefined)
      sets.push(sql`reviewed_by_operator_id = ${patch.reviewedBy}`);
    if (patch.publishedAt !== undefined)
      sets.push(
        sql`published_at = ${patch.publishedAt ? sql`${patch.publishedAt.toISOString()}::timestamptz` : sql`NULL`}`,
      );
    if (sets.length === 0) return;
    await tx.execute(
      sql`UPDATE marketplace_app_versions SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`,
    );
  }

  async retireOthers(tx: Tx, appId: number, keepId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_app_versions SET status = 'retired' WHERE app_id = ${appId} AND status = 'published' AND id <> ${keepId}`);
  }

  // --- cross-workspace actions ------------------------------------------------------------------------------------------------------------

  /**
   * A new version is published: installations whose granted scopes already cover its scopes move to it now (with the narrower grant); the
   * others keep running on the old version and wait for their admin's consent. A killed installation is left alone: a kill is not undone
   * by a new version. Each change gets an audit row and an outbox event in the
   * workspace it happened in. Returns how many of each.
   */
  async applyVersion(
    tx: Tx,
    appId: number,
    app: { slug: string },
    version: { id: number; version: string; scopes: string[] },
    operatorId: number,
  ): Promise<{ upgraded: number; awaitingConsent: number }> {
    const scopes = textArray(version.scopes);
    const up = await tx.execute(sql`
      WITH up AS (
        UPDATE workspace_app_installations i
           SET installed_version_id = ${version.id}, pending_version_id = NULL, granted_scopes = ${scopes}
         WHERE i.app_id = ${appId} AND i.status <> 'killed' AND i.installed_version_id <> ${version.id} AND i.granted_scopes @> ${scopes}
        RETURNING i.org_id, i.id, i.uuid
      ), au AS (
        INSERT INTO audit_log (org_id, actor_type, module, record_id, action, delta)
        SELECT org_id, 'system', 'marketplace', id, 'update',
               jsonb_build_object('version', jsonb_build_object('old', NULL, 'new', ${version.version}::text), 'by', jsonb_build_object('old', NULL, 'new', ${'operator:' + operatorId}::text))
          FROM up
        RETURNING 1
      ), ob AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT org_id, 'marketplace', id, 'marketplace.app.upgraded',
               jsonb_build_object('installation', uuid, 'app', ${app.slug}::text, 'version', ${version.version}::text)
          FROM up
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM up)::int AS n`);
    await tx.execute(sql`
      UPDATE workspace_app_installations i SET pending_version_id = ${version.id}
       WHERE i.app_id = ${appId} AND i.status <> 'killed' AND i.installed_version_id <> ${version.id} AND NOT (i.granted_scopes @> ${scopes})
         AND i.pending_version_id IS DISTINCT FROM ${version.id}`);
    const waiting = await tx.execute(sql`
      SELECT count(*)::int AS n FROM workspace_app_installations WHERE app_id = ${appId} AND status <> 'killed' AND pending_version_id = ${version.id}`);
    return {
      upgraded: Number((up.rows as Raw[])[0]!.n),
      awaitingConsent: Number((waiting.rows as Raw[])[0]!.n),
    };
  }

  /**
   * The kill switch: every installation of the app is switched off in this one transaction, its connections stop answering (the delivery
   * door reads the status on every request), and each workspace gets an audit row and an outbox event. Returns how many installations.
   */
  async killInstallations(
    tx: Tx,
    appId: number,
    app: { slug: string },
    reason: string,
    operatorId: number,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH k AS (
        UPDATE workspace_app_installations i
           SET status = 'killed', killed_at = now(), kill_reason = ${reason}, paused_by_subscription = false
         WHERE i.app_id = ${appId} AND i.status <> 'killed'
        RETURNING i.org_id, i.id, i.uuid
      ), cn AS (
        UPDATE marketplace_connections n SET status = 'disabled'
          FROM k WHERE n.org_id = k.org_id AND n.installation_id = k.id
        RETURNING 1
      ), au AS (
        INSERT INTO audit_log (org_id, actor_type, module, record_id, action, delta)
        SELECT org_id, 'system', 'marketplace', id, 'update',
               jsonb_build_object('status', jsonb_build_object('old', 'active', 'new', 'killed'),
                                  'reason', jsonb_build_object('old', NULL, 'new', ${reason}::text),
                                  'by', jsonb_build_object('old', NULL, 'new', ${'operator:' + operatorId}::text))
          FROM k
        RETURNING 1
      ), ob AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT org_id, 'marketplace', id, 'marketplace.app.killed',
               jsonb_build_object('installation', uuid, 'app', ${app.slug}::text, 'reason', ${reason}::text)
          FROM k
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM k)::int AS n`);
    return Number((res.rows as Raw[])[0]!.n);
  }

  // --- usage ----------------------------------------------------------------------------------------------------------------------------------

  async usage(tx: Tx): Promise<Raw[]> {
    const res = await tx.execute(sql`
      SELECT a.uuid, a.slug, a.name, a.kind, a.status,
        count(i.id) FILTER (WHERE i.status = 'active')::int AS active,
        count(i.id) FILTER (WHERE i.status = 'disabled')::int AS disabled,
        count(i.id) FILTER (WHERE i.status = 'killed')::int AS killed,
        count(i.id)::int AS total,
        count(i.id) FILTER (WHERE i.health_status = 'healthy')::int AS healthy,
        count(i.id) FILTER (WHERE i.health_status = 'degraded')::int AS degraded,
        count(i.id) FILTER (WHERE i.health_status = 'error')::int AS error,
        count(i.id) FILTER (WHERE i.health_status = 'needs_reauth')::int AS needs_reauth,
        count(i.id) FILTER (WHERE i.health_status = 'unknown')::int AS unknown
      FROM marketplace_apps a LEFT JOIN workspace_app_installations i ON i.app_id = a.id
      GROUP BY a.id ORDER BY a.status = 'published' DESC, total DESC, a.name`);
    return res.rows as Raw[];
  }

  /** Delivery counts per app over two windows, from the delivery rows (a repeat counts as one more `seen`). */
  async events(tx: Tx): Promise<Raw[]> {
    const res = await tx.execute(sql`
      SELECT a.uuid,
        count(*) FILTER (WHERE e.status = 'accepted' AND e.received_at > now() - interval '24 hours')::int AS a24,
        coalesce(sum(e.seen_count - 1) FILTER (WHERE e.status = 'accepted' AND e.last_seen_at > now() - interval '24 hours'), 0)::int AS d24,
        count(*) FILTER (WHERE e.status = 'rejected' AND e.received_at > now() - interval '24 hours')::int AS r24,
        count(*) FILTER (WHERE e.status = 'failed' AND e.received_at > now() - interval '24 hours')::int AS f24,
        count(*) FILTER (WHERE e.status = 'accepted')::int AS a7,
        coalesce(sum(e.seen_count - 1) FILTER (WHERE e.status = 'accepted'), 0)::int AS d7,
        count(*) FILTER (WHERE e.status = 'rejected')::int AS r7,
        count(*) FILTER (WHERE e.status = 'failed')::int AS f7
      FROM marketplace_connection_events e
      JOIN marketplace_connections n ON n.org_id = e.org_id AND n.id = e.connection_id
      JOIN workspace_app_installations i ON i.org_id = n.org_id AND i.id = n.installation_id
      JOIN marketplace_apps a ON a.id = i.app_id
      WHERE e.received_at > now() - interval '7 days'
      GROUP BY a.uuid`);
    return res.rows as Raw[];
  }

  private sets(patch: Record<string, unknown>): SQL[] {
    const sets: SQL[] = [];
    for (const [column, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (!/^[a-z_]+$/.test(column)) throw new Error(`bad column ${column}`);
      if (column === 'listing') sets.push(sql`listing = ${jsonb(value)}`);
      else if (value instanceof Date)
        sets.push(sql`${sql.raw(column)} = ${value.toISOString()}::timestamptz`);
      else sets.push(sql`${sql.raw(column)} = ${value}`);
    }
    return sets;
  }
}
