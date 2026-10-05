import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface PageRow {
  id: number;
  uuid: string;
  pageId: string;
  name: string | null;
  category: string | null;
  username: string | null;
  pictureUrl: string | null;
  /** Encrypted. */
  accessToken: string | null;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  tasks: string[];
  status: string;
  connectMethod: string;
  fanCount: number | null;
  lastError: string | null;
  createdAt: Date;
  rowVersion: number;
}

interface Raw {
  id: number | string;
  uuid: string;
  page_id: string;
  name: string | null;
  category: string | null;
  username: string | null;
  picture_url: string | null;
  access_token: string | null;
  data_access_expires_at: Date | string | null;
  scopes: unknown;
  tasks: unknown;
  status: string;
  connect_method: string;
  fan_count: number | string | null;
  last_error: string | null;
  created_at: Date | string;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, page_id, name, category, username, picture_url, access_token, data_access_expires_at, scopes, tasks, status,
   connect_method, fan_count, last_error, created_at, row_version`,
);

const strings = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];

const toRow = (r: Raw): PageRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  pageId: r.page_id,
  name: r.name,
  category: r.category,
  username: r.username,
  pictureUrl: r.picture_url,
  accessToken: r.access_token,
  dataAccessExpiresAt:
    r.data_access_expires_at === null ? null : new Date(r.data_access_expires_at),
  scopes: strings(r.scopes),
  tasks: strings(r.tasks),
  status: r.status,
  connectMethod: r.connect_method,
  fanCount: r.fan_count === null ? null : Number(r.fan_count),
  lastError: r.last_error,
  createdAt: new Date(r.created_at),
  rowVersion: r.row_version,
});

export interface PageValues {
  userId: number | null;
  pageId: string;
  name: string | null;
  category: string | null;
  username: string | null;
  pictureUrl: string | null;
  /** Already encrypted. */
  accessToken: string;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  tasks: string[];
  connectMethod: string;
  fanCount: number | null;
}

/** `facebook_pages`, always inside the caller's tenant transaction (RLS scopes every statement). */
@Injectable()
export class PagesRepository {
  async list(tx: Tx, orgId: number): Promise<PageRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM facebook_pages WHERE org_id = ${orgId} ORDER BY lower(coalesce(name, page_id)), id`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async connectedCount(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM facebook_pages WHERE org_id = ${orgId} AND status = 'connected'`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<PageRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM facebook_pages WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<PageRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM facebook_pages WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findByPageId(tx: Tx, orgId: number, pageId: string): Promise<PageRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM facebook_pages WHERE org_id = ${orgId} AND page_id = ${pageId}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /**
   * One row per (organization, Page id): a Page connected again updates the same row, comes back `connected` with its error
   * cleared, and keeps its uuid. A Page token from a long-lived user token does not expire, so `token_expires_at` is cleared.
   */
  async upsert(tx: Tx, orgId: number, v: PageValues): Promise<{ row: PageRow; created: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO facebook_pages (org_id, user_id, page_id, name, category, username, picture_url, access_token, token_expires_at,
                                  data_access_expires_at, scopes, tasks, status, connect_method, fan_count, last_error)
      VALUES (${orgId}, ${v.userId}, ${v.pageId}, ${v.name}, ${v.category}, ${v.username}, ${v.pictureUrl}, ${v.accessToken}, NULL,
              ${v.dataAccessExpiresAt}, ${JSON.stringify(v.scopes)}::jsonb, ${JSON.stringify(v.tasks)}::jsonb, 'connected',
              ${v.connectMethod}, ${v.fanCount}, NULL)
      ON CONFLICT (org_id, page_id) DO UPDATE SET
        user_id = EXCLUDED.user_id, name = EXCLUDED.name, category = EXCLUDED.category, username = EXCLUDED.username,
        picture_url = EXCLUDED.picture_url, access_token = EXCLUDED.access_token, token_expires_at = NULL,
        data_access_expires_at = EXCLUDED.data_access_expires_at, scopes = EXCLUDED.scopes, tasks = EXCLUDED.tasks,
        status = 'connected', connect_method = EXCLUDED.connect_method, fan_count = EXCLUDED.fan_count, last_error = NULL
      RETURNING ${COLUMNS}, (xmax = 0) AS inserted`);
    const raw = (res.rows as unknown as Array<Raw & { inserted: boolean }>)[0]!;
    return { row: toRow(raw), created: raw.inserted };
  }

  /** The public profile Meta returned: a missing field keeps what is stored. */
  async setProfile(
    tx: Tx,
    orgId: number,
    id: number,
    p: {
      name: string | null;
      category: string | null;
      username: string | null;
      pictureUrl: string | null;
      fanCount: number | null;
    },
  ): Promise<PageRow> {
    const res = await tx.execute(sql`
      UPDATE facebook_pages SET name = coalesce(${p.name}, name), category = coalesce(${p.category}, category),
             username = coalesce(${p.username}, username), picture_url = coalesce(${p.pictureUrl}, picture_url),
             fan_count = coalesce(${p.fanCount}, fan_count)
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /** A health result: status and error are set together, the data-access clock only when Meta gave one. */
  async setHealth(
    tx: Tx,
    orgId: number,
    id: number,
    h: { status: string; lastError: string | null; dataAccessExpiresAt: Date | null },
  ): Promise<PageRow> {
    const res = await tx.execute(sql`
      UPDATE facebook_pages SET status = ${h.status}, last_error = ${h.lastError},
             data_access_expires_at = coalesce(${h.dataAccessExpiresAt}, data_access_expires_at)
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /** Flags a Page whose token Meta refused; nothing else about it changes. */
  async markExpired(tx: Tx, orgId: number, id: number, error: string): Promise<void> {
    await tx.execute(
      sql`UPDATE facebook_pages SET status = 'expired', last_error = ${error} WHERE org_id = ${orgId} AND id = ${id} AND status <> 'expired'`,
    );
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM facebook_pages WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Every org that has a Page worth health-checking: the sweep's work list. */
  async orgsWithPagesToCheck(tx: Tx): Promise<number[]> {
    const res = await tx.execute(
      sql`SELECT DISTINCT org_id FROM facebook_pages WHERE status IN ('connected', 'expired', 'error') ORDER BY org_id`,
    );
    return (res.rows as Array<{ org_id: number | string }>).map((r) => Number(r.org_id));
  }

  async toCheck(tx: Tx, orgId: number): Promise<PageRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM facebook_pages WHERE org_id = ${orgId} AND status IN ('connected', 'expired', 'error') ORDER BY id`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }
}
