import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { FlowGraph, FlowStatusFilter } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeFlowCursor, likePattern, statusPredicate } from './flow-rules';

/** One flow as the SQL returns it. The graph is only selected when asked for (the list never ships graphs). */
export interface FlowRow {
  id: number;
  uuid: string;
  userId: number | null;
  name: string;
  category: string | null;
  flowType: string;
  triggerKind: string;
  triggerValue: number | null;
  triggerKeywords: string | null;
  triggerDeviceId: number | null;
  /** The inbox channel (`channels.id`) the flow listens on and sends through: what the runtime reads. */
  triggerChannelId: number | null;
  provider: string;
  isPublished: boolean;
  isActive: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** `updated_at` at the database's microsecond precision: the list cursor. */
  updatedAtIso: string;
  rowVersion: number;
  nodeCount: number;
  edgeCount: number;
  subscribers: { active: number; completed: number; failed: number };
  graph?: FlowGraph;
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const toGraph = (v: unknown): FlowGraph => {
  const g = (v ?? {}) as Partial<FlowGraph>;
  return {
    flowNodes: Array.isArray(g.flowNodes) ? g.flowNodes : [],
    flowEdges: Array.isArray(g.flowEdges) ? g.flowEdges : [],
    vars: Array.isArray(g.vars) ? g.vars : [],
  };
};

const toRow = (r: Raw): FlowRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  userId: r.user_id === null || r.user_id === undefined ? null : Number(r.user_id),
  name: r.flow_name as string,
  category: (r.category as string | null) ?? null,
  flowType: r.flow_type as string,
  triggerKind: r.trigger_kind as string,
  triggerValue: r.trigger_value === null || r.trigger_value === undefined ? null : Number(r.trigger_value),
  triggerKeywords: (r.trigger_keywords as string | null) ?? null,
  triggerDeviceId:
    r.trigger_device_id === null || r.trigger_device_id === undefined ? null : Number(r.trigger_device_id),
  triggerChannelId:
    r.trigger_channel_id === null || r.trigger_channel_id === undefined ? null : Number(r.trigger_channel_id),
  provider: r.provider as string,
  isPublished: r.is_published as boolean,
  isActive: r.is_active as boolean,
  publishedAt: r.published_at ? new Date(r.published_at as string) : null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  updatedAtIso: r.updated_at_iso as string,
  rowVersion: Number(r.row_version),
  nodeCount: num(r.node_count),
  edgeCount: num(r.edge_count),
  subscribers: {
    active: num(r.sub_active),
    completed: num(r.sub_completed),
    failed: num(r.sub_failed),
  },
  graph: r.flow_data === undefined ? undefined : toGraph(r.flow_data),
});

const COLUMNS = sql`
  f.id, f.uuid, f.user_id, f.flow_name, f.category, f.flow_type, f.trigger_kind, f.trigger_value, f.trigger_keywords,
  f.trigger_device_id, f.trigger_channel_id, f.provider, f.is_published, f.is_active, f.published_at, f.created_at, f.updated_at,
  to_char(f.updated_at at time zone 'UTC', ${sql.raw(ISO)}) AS updated_at_iso, f.row_version,
  coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(f.flow_data->'flowNodes') = 'array' THEN f.flow_data->'flowNodes' END), 0) AS node_count,
  coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(f.flow_data->'flowEdges') = 'array' THEN f.flow_data->'flowEdges' END), 0) AS edge_count,
  (SELECT count(*) FROM flow_subscribers s WHERE s.org_id = f.org_id AND s.flow_id = f.id AND s.status = 'active') AS sub_active,
  (SELECT count(*) FROM flow_subscribers s WHERE s.org_id = f.org_id AND s.flow_id = f.id AND s.status = 'completed') AS sub_completed,
  (SELECT count(*) FROM flow_subscribers s WHERE s.org_id = f.org_id AND s.flow_id = f.id AND s.status = 'failed') AS sub_failed
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RefTable =
  | 'tags'
  | 'contact_groups'
  | 'pipeline_stages'
  | 'devices'
  | 'wa_provider_configs'
  | 'workspace_ig_accounts'
  | 'facebook_pages'
  | 'tiktok_accounts'
  | 'telegram_bots'
  | 'line_channels'
  | 'wechat_channels'
  | 'viber_channels'
  | 'workspace_email_accounts';

export interface FlowFilter {
  status: FlowStatusFilter;
  category: string;
  q?: string;
}

function conds(orgId: number, f: FlowFilter): SQL[] {
  const out: SQL[] = [sql`f.org_id = ${orgId}`];
  const p = statusPredicate(f.status);
  if (p) out.push(sql.raw(`(${p})`));
  if (f.category && f.category !== 'all') out.push(sql`f.category = ${f.category}`);
  if (f.q) out.push(sql`f.flow_name ILIKE ${likePattern(f.q)}`);
  return out;
}

export interface NewFlow {
  userId: number | null;
  name: string;
  graph: FlowGraph;
  category: string | null;
  flowType: string;
  triggerKind: string;
  triggerValue: number | null;
  triggerKeywords: string | null;
  triggerDeviceId: number | null;
  triggerChannelId: number | null;
  provider: string | null;
  /** Only a duplicate sets it (WaDesk's replicate() kept the source's pause switch); everything else starts active. */
  isActive?: boolean;
}

export interface FlowUpdate {
  name: string;
  graph: FlowGraph;
  /** Replaces the category only when non-empty (a category cannot be cleared through save: WaDesk rule). */
  category: string | null;
  flowType: string;
  triggerKind: string;
  triggerValue: number | null;
  triggerKeywords: string | null;
  triggerDeviceId: number | null;
  triggerChannelId: number | null;
  /** Only changes when the trigger names a valid engine prefix. */
  provider: string | null;
}

/** Data access for flows. Every query carries the org: RLS is the backstop, not the filter. */
@Injectable()
export class FlowsRepository {
  async list(
    tx: Tx,
    orgId: number,
    filter: FlowFilter,
    page: { cursor?: string; limit: number },
  ): Promise<FlowRow[]> {
    const c = conds(orgId, filter);
    if (page.cursor) {
      const cur = decodeFlowCursor(page.cursor);
      c.push(
        sql`(f.updated_at < ${cur.updatedAtIso}::timestamptz OR (f.updated_at = ${cur.updatedAtIso}::timestamptz AND f.id < ${cur.id}))`,
      );
    }
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM flows f WHERE ${sql.join(c, sql` AND `)}
      ORDER BY f.updated_at DESC, f.id DESC LIMIT ${page.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  async count(tx: Tx, orgId: number, filter: FlowFilter): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*) AS n FROM flows f WHERE ${sql.join(conds(orgId, filter), sql` AND `)}`,
    );
    return num((res.rows[0] as Raw).n);
  }

  /** Counts of every state (ignoring the filters) in one pass. */
  async statusCounts(
    tx: Tx,
    orgId: number,
  ): Promise<{ all: number; live: number; paused: number; draft: number }> {
    const res = await tx.execute(sql`
      SELECT count(*) AS total,
        count(*) FILTER (WHERE is_published AND is_active) AS live,
        count(*) FILTER (WHERE is_published AND NOT is_active) AS paused,
        count(*) FILTER (WHERE NOT is_published) AS draft
      FROM flows WHERE org_id = ${orgId}
    `);
    const r = res.rows[0] as Raw;
    return { all: num(r.total), live: num(r.live), paused: num(r.paused), draft: num(r.draft) };
  }

  /** Counts by `COALESCE(category, 'uncategorized')` plus `all`. */
  async categoryCounts(tx: Tx, orgId: number): Promise<Record<string, number>> {
    const res = await tx.execute(sql`
      SELECT coalesce(category, 'uncategorized') AS category, count(*) AS n
      FROM flows WHERE org_id = ${orgId} GROUP BY 1
    `);
    const out: Record<string, number> = { all: 0 };
    for (const r of res.rows as Raw[]) {
      const n = num(r.n);
      out[r.category as string] = n;
      out.all = (out.all ?? 0) + n;
    }
    return out;
  }

  /** WaDesk's "most used" card: published first, then active, then most recently updated (no usage metric is involved). */
  async featured(tx: Tx, orgId: number): Promise<FlowRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS}, f.flow_data FROM flows f WHERE f.org_id = ${orgId}
      ORDER BY f.is_published DESC, f.is_active DESC, f.updated_at DESC, f.id DESC LIMIT 1
    `);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : null;
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string, forUpdate = false): Promise<FlowRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS}, f.flow_data FROM flows f WHERE f.org_id = ${orgId} AND f.uuid = ${uuid}
      ${forUpdate ? sql`FOR UPDATE OF f` : sql``}
    `);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : null;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<FlowRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS}, f.flow_data FROM flows f WHERE f.org_id = ${orgId} AND f.id = ${id}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : null;
  }

  async countAll(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`SELECT count(*) AS n FROM flows WHERE org_id = ${orgId}`);
    return num((res.rows[0] as Raw).n);
  }

  async insert(tx: Tx, orgId: number, f: NewFlow): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO flows (org_id, user_id, flow_name, flow_data, category, flow_type, trigger_kind, trigger_value,
        trigger_keywords, trigger_device_id, trigger_channel_id, provider, is_published, is_active)
      VALUES (${orgId}, ${f.userId}, ${f.name}, ${JSON.stringify(f.graph)}::jsonb, ${f.category}, ${f.flowType},
        ${f.triggerKind}, ${f.triggerValue}, ${f.triggerKeywords}, ${f.triggerDeviceId}, ${f.triggerChannelId},
        coalesce(${f.provider}, 'baileys'), false, ${f.isActive ?? true})
      RETURNING id
    `);
    return Number((res.rows[0] as Raw).id);
  }

  /** Returns false when the row was changed by someone else since `expectedVersion`. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    f: FlowUpdate,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE flows SET flow_name = ${f.name}, flow_data = ${JSON.stringify(f.graph)}::jsonb,
        category = coalesce(${f.category}, category), flow_type = ${f.flowType}, trigger_kind = ${f.triggerKind},
        trigger_value = ${f.triggerValue}, trigger_keywords = ${f.triggerKeywords},
        trigger_device_id = ${f.triggerDeviceId}, trigger_channel_id = ${f.triggerChannelId}, provider = coalesce(${f.provider}, provider)
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  async rename(tx: Tx, orgId: number, id: number, name: string): Promise<void> {
    await tx.execute(sql`UPDATE flows SET flow_name = ${name} WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setActive(tx: Tx, orgId: number, id: number, active: boolean): Promise<void> {
    await tx.execute(sql`UPDATE flows SET is_active = ${active} WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setPublished(tx: Tx, orgId: number, id: number, published: boolean): Promise<void> {
    await tx.execute(
      published
        ? sql`UPDATE flows SET is_published = true, published_at = now() WHERE org_id = ${orgId} AND id = ${id}`
        : sql`UPDATE flows SET is_published = false, published_at = NULL WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM flows WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return res.rows.length > 0;
  }

  // --- trigger reference resolution (uuid on the wire -> internal id in the column) --------------------------------------

  /** `table` is one of a closed list the service maps from the trigger, never user input. */
  async resolveRef(tx: Tx, orgId: number, table: RefTable, uuid: string): Promise<number | null> {
    if (!UUID_RE.test(uuid)) return null;
    const res = await tx.execute(
      sql`SELECT id FROM ${sql.raw(table)} WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? Number(r.id) : null;
  }

  /**
   * The inbox channel (`channels.id`) a sender key points at, or null when that sender has no channel row (yet). A sender is
   * named `<engine>:<uuid>` after its engine's own table (devices, wa_provider_configs, ...); the runtime matches on
   * `channels`, so the save translates once: an unofficial device is the `whatsapp_qr` channel whose handle is its uuid, a
   * WABA / Twilio number is the channel linked to its connection, any other engine a channel of that kind with the uuid as
   * handle. The lookup is scoped by org, so another workspace's sender never resolves.
   */
  async resolveChannel(tx: Tx, orgId: number, engine: string, uuid: string): Promise<number | null> {
    if (!UUID_RE.test(uuid)) return null;
    const res =
      engine === 'baileys'
        ? await tx.execute(
            sql`SELECT id FROM channels WHERE org_id = ${orgId} AND kind = 'whatsapp_qr' AND external_id = ${uuid} ORDER BY id LIMIT 1`,
          )
        : engine === 'waba' || engine === 'twilio'
          ? await tx.execute(sql`
              SELECT c.id FROM channels c
              JOIN wa_provider_configs w ON w.org_id = c.org_id AND w.id = c.waba_config_id
              WHERE c.org_id = ${orgId} AND w.uuid = ${uuid} ORDER BY c.id LIMIT 1`)
          : await tx.execute(
              sql`SELECT id FROM channels WHERE org_id = ${orgId} AND kind = ${engine} AND external_id = ${uuid} ORDER BY id LIMIT 1`,
            );
    const r = res.rows[0] as Raw | undefined;
    return r ? Number(r.id) : null;
  }
}
