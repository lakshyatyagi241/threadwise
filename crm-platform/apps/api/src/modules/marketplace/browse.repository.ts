import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { MarketAppKind } from '@crm/contracts';
import { decodeKeyset, encodeKeyset, likePattern, type AppRef } from './marketplace-rules';

type Raw = Record<string, unknown>;

export interface CardRow {
  id: number;
  uuid: string;
  slug: string;
  kind: MarketAppKind;
  name: string;
  tagline: string;
  first_party: boolean;
  featured: boolean;
  connector_type: string | null;
  install_count: number;
  published_at: Date | null;
  plan_feature: string | null;
  status: string;
  category_slug: string;
  category_name: string;
  version: string;
  manifest: Record<string, unknown>;
  listing: Record<string, unknown>;
  recipe_logo: string | null;
  inst_uuid: string | null;
  inst_status: 'active' | 'disabled' | 'killed' | null;
  inst_health: 'unknown' | 'healthy' | 'degraded' | 'error' | 'needs_reauth' | null;
  needs_reconsent: boolean;
  /** Sort key values, for the next cursor. */
  keys: string[];
}

export interface DetailRow extends CardRow {
  recipe: Record<string, unknown> | null;
  /** Newest first, published or retired only. */
  changelog: Array<{ version: string; notes: string; publishedAt: string | null }>;
}

export interface CategoryCountRow {
  id: number;
  uuid: string;
  kind: MarketAppKind;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  app_count: number;
}

export type AppSort = 'featured' | 'popular' | 'new' | 'name';

interface SortDef {
  /** Expressions of the sort tuple, then a.id; every expression sorts the same way, so one tuple comparison resumes the page. */
  keys: Array<{ expr: string; cast: string }>;
  dir: 'asc' | 'desc';
}
const SORTS: Record<AppSort, SortDef> = {
  featured: {
    keys: [
      { expr: 'CASE WHEN a.featured THEN 0 ELSE 1 END', cast: 'int' },
      { expr: 'a.sort_order', cast: 'int' },
      { expr: 'lower(a.name)', cast: 'text' },
    ],
    dir: 'asc',
  },
  popular: { keys: [{ expr: 'a.install_count', cast: 'int' }], dir: 'desc' },
  new: {
    keys: [{ expr: "coalesce(a.published_at, 'epoch'::timestamptz)", cast: 'timestamptz' }],
    dir: 'desc',
  },
  name: { keys: [{ expr: 'lower(a.name)', cast: 'text' }], dir: 'asc' },
};

const ref = (r: AppRef): SQL =>
  r.by === 'uuid' ? sql`a.uuid = ${r.value}::uuid` : sql`a.slug = ${r.value}`;

function toCard(r: Raw, width: number): CardRow {
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    slug: r.slug as string,
    kind: r.kind as MarketAppKind,
    name: r.name as string,
    tagline: r.tagline as string,
    first_party: r.first_party as boolean,
    featured: r.featured as boolean,
    connector_type: (r.connector_type as string | null) ?? null,
    install_count: Number(r.install_count),
    published_at: r.published_at ? new Date(r.published_at as string) : null,
    plan_feature: (r.plan_feature as string | null) ?? null,
    status: r.status as string,
    category_slug: r.category_slug as string,
    category_name: r.category_name as string,
    version: r.version as string,
    manifest: (r.manifest as Record<string, unknown>) ?? {},
    listing: (r.listing as Record<string, unknown>) ?? {},
    recipe_logo: (r.recipe_logo as string | null) ?? null,
    inst_uuid: (r.inst_uuid as string | null) ?? null,
    inst_status: (r.inst_status as CardRow['inst_status']) ?? null,
    inst_health: (r.inst_health as CardRow['inst_health']) ?? null,
    needs_reconsent: Boolean(r.needs_reconsent),
    keys: Array.from({ length: width }, (_, i) => String(r[`k${i}`])),
  };
}

const CARD_COLUMNS = sql.raw(`
  a.id, a.uuid, a.slug, a.kind, a.name, a.tagline, a.first_party, a.featured, a.connector_type, a.install_count, a.published_at,
  a.plan_feature, a.status, c.slug AS category_slug, c.name AS category_name, a.listing,
  coalesce(iv.version, cv.version) AS version, coalesce(iv.manifest, cv.manifest) AS manifest,
  coalesce(iv.recipe, cv.recipe) ->> 'logo' AS recipe_logo,
  i.uuid AS inst_uuid, i.status AS inst_status, i.health_status AS inst_health, (i.pending_version_id IS NOT NULL) AS needs_reconsent`);

/**
 * The workspace's reads of the catalogue. Everything runs in the caller's tenant transaction: row-level security already limits what a
 * workspace can see to published listings and the ones it has installed, and these statements narrow it further to what browsing shows.
 */
@Injectable()
export class BrowseRepository {
  async categories(tx: Tx, kind?: MarketAppKind): Promise<CategoryCountRow[]> {
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.kind, c.slug, c.name, c.description, c.icon, c.sort_order,
             count(a.id) FILTER (WHERE a.status = 'published')::int AS app_count
      FROM marketplace_categories c
      LEFT JOIN marketplace_apps a ON a.category_id = c.id
      WHERE c.is_active ${kind ? sql`AND c.kind = ${kind}` : sql``}
      GROUP BY c.id
      ORDER BY c.kind, c.sort_order, c.name`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      kind: r.kind as MarketAppKind,
      slug: r.slug as string,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      icon: (r.icon as string | null) ?? null,
      sort_order: Number(r.sort_order),
      app_count: Number(r.app_count),
    }));
  }

  /** `limit + 1` rows so the caller can tell whether another page exists. */
  async list(
    tx: Tx,
    orgId: number,
    q: {
      kind?: MarketAppKind;
      category?: string;
      q?: string;
      installed?: boolean;
      featured?: boolean;
      sort: AppSort;
      limit: number;
      cursor?: string;
    },
  ): Promise<{ rows: CardRow[]; badCursor: boolean }> {
    const def = SORTS[q.sort];
    const where: SQL[] = [];
    // Published listings only; the Installed filter also shows what the workspace installed that is no longer published.
    if (q.installed === true) where.push(sql`i.id IS NOT NULL`);
    else where.push(sql`a.status = 'published'`);
    if (q.installed === false) where.push(sql`i.id IS NULL`);
    if (q.featured) where.push(sql`a.featured`);
    if (q.kind) where.push(sql`a.kind = ${q.kind}`);
    if (q.category) where.push(sql`c.slug = ${q.category}`);
    if (q.q) {
      const like = likePattern(q.q);
      where.push(sql`(a.name ILIKE ${like} OR a.tagline ILIKE ${like} OR c.name ILIKE ${like})`);
    }
    let badCursor = false;
    if (q.cursor) {
      const k = decodeKeyset(q.cursor, def.keys.length);
      if (!k) badCursor = true;
      else {
        const cmp = def.dir === 'asc' ? sql.raw('>') : sql.raw('<');
        const left = sql.join([...def.keys.map((x) => sql.raw(x.expr)), sql.raw('a.id')], sql`, `);
        const right = sql.join(
          [...def.keys.map((x, n) => sql`${k.keys[n]!}::${sql.raw(x.cast)}`), sql`${k.id}::bigint`],
          sql`, `,
        );
        where.push(sql`(${left}) ${cmp} (${right})`);
      }
    }
    const keyCols = sql.raw(def.keys.map((x, n) => `(${x.expr})::text AS k${n}`).join(', '));
    const order = sql.raw(
      [...def.keys.map((x) => x.expr), 'a.id']
        .map((e) => `${e} ${def.dir.toUpperCase()}`)
        .join(', '),
    );
    const res = await tx.execute(sql`
      SELECT ${CARD_COLUMNS}, ${keyCols}
      FROM marketplace_apps a
      JOIN marketplace_categories c ON c.id = a.category_id
      LEFT JOIN marketplace_app_versions cv ON cv.id = a.current_version_id
      LEFT JOIN workspace_app_installations i ON i.app_id = a.id AND i.org_id = ${orgId}
      LEFT JOIN marketplace_app_versions iv ON iv.id = i.installed_version_id
      WHERE ${sql.join(where, sql` AND `)} AND coalesce(iv.version, cv.version) IS NOT NULL
      ORDER BY ${order}
      LIMIT ${q.limit + 1}`);
    return { rows: (res.rows as Raw[]).map((r) => toCard(r, def.keys.length)), badCursor };
  }

  /** A shelf: the same cards, a fixed sort and size. */
  async shelf(
    tx: Tx,
    orgId: number,
    kind: MarketAppKind,
    sort: AppSort,
    limit: number,
    featured = false,
  ): Promise<CardRow[]> {
    const { rows } = await this.list(tx, orgId, { kind, sort, limit, featured });
    return rows.slice(0, limit);
  }

  async detail(tx: Tx, orgId: number, r: AppRef): Promise<DetailRow | null> {
    const res = await tx.execute(sql`
      SELECT ${CARD_COLUMNS}, coalesce(iv.recipe, cv.recipe) AS recipe,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('version', h.version, 'notes', h.changelog,
                          'publishedAt', to_char(h.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                          ORDER BY h.published_at DESC NULLS LAST, h.id DESC), '[]'::jsonb)
           FROM (SELECT * FROM marketplace_app_versions v
                  WHERE v.app_id = a.id AND v.status IN ('published', 'retired')
                  ORDER BY v.published_at DESC NULLS LAST, v.id DESC LIMIT 5) h) AS changelog
      FROM marketplace_apps a
      JOIN marketplace_categories c ON c.id = a.category_id
      LEFT JOIN marketplace_app_versions cv ON cv.id = a.current_version_id
      LEFT JOIN workspace_app_installations i ON i.app_id = a.id AND i.org_id = ${orgId}
      LEFT JOIN marketplace_app_versions iv ON iv.id = i.installed_version_id
      WHERE ${ref(r)} AND coalesce(iv.version, cv.version) IS NOT NULL`);
    const row = (res.rows as Raw[])[0];
    if (!row) return null;
    return {
      ...toCard(row, 0),
      recipe: (row.recipe as Record<string, unknown> | null) ?? null,
      changelog: (row.changelog as DetailRow['changelog']) ?? [],
    };
  }

  /** The published version a new installation of the app gets, with its manifest and recipe. The app must be published. */
  async installable(
    tx: Tx,
    r: AppRef,
  ): Promise<{
    appId: number;
    appUuid: string;
    slug: string;
    name: string;
    kind: MarketAppKind;
    planFeature: string | null;
    versionId: number;
    version: string;
    scopes: string[];
    manifest: Record<string, unknown>;
    recipe: Record<string, unknown> | null;
  } | null> {
    const res = await tx.execute(sql`
      SELECT a.id, a.uuid, a.slug, a.name, a.kind, a.plan_feature, v.id AS version_id, v.version, v.scopes, v.manifest, v.recipe
      FROM marketplace_apps a JOIN marketplace_app_versions v ON v.id = a.current_version_id
      WHERE ${ref(r)} AND a.status = 'published' AND v.status = 'published'`);
    const row = (res.rows as Raw[])[0];
    if (!row) return null;
    return {
      appId: Number(row.id),
      appUuid: row.uuid as string,
      slug: row.slug as string,
      name: row.name as string,
      kind: row.kind as MarketAppKind,
      planFeature: (row.plan_feature as string | null) ?? null,
      versionId: Number(row.version_id),
      version: row.version as string,
      scopes: (row.scopes as string[]) ?? [],
      manifest: row.manifest as Record<string, unknown>,
      recipe: (row.recipe as Record<string, unknown> | null) ?? null,
    };
  }

  /** Whether the app exists for this workspace at all (published, or installed), whatever its state: to tell 404 from 409. */
  async exists(tx: Tx, r: AppRef): Promise<boolean> {
    const res = await tx.execute(sql`SELECT 1 FROM marketplace_apps a WHERE ${ref(r)}`);
    return (res.rows as Raw[]).length > 0;
  }

  async installedCount(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM workspace_app_installations WHERE org_id = ${orgId}`,
    );
    return Number((res.rows as Raw[])[0]!.n);
  }

  nextCursor(
    rows: CardRow[],
    limit: number,
  ): { items: CardRow[]; nextCursor: string | null; hasMore: boolean } {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? encodeKeyset(last.keys, last.id) : null,
    };
  }
}
