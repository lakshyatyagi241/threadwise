import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  GrowthAction,
  GrowthActionStatus,
  GrowthActionType,
  GrowthActionsQuery,
  GrowthCampaignRow,
  GrowthConfig,
  GrowthFeature,
  ServiceRule,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { PropensityRow } from './growth.rules';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

const MAX_AUDIENCE = 50_000;

export interface StoredSettings {
  features: unknown;
  config: unknown;
  rowVersion: number;
}

export interface ActionWrite {
  type: GrowthActionType;
  contactId: number;
  conversationId?: number | null;
  digestId?: number | null;
  severity?: 'info' | 'attention' | 'urgent';
  title: string;
  detail?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey: string;
}

export interface ActionRow {
  id: number;
  uuid: string;
  type: GrowthActionType;
  contactId: number;
  contactUuid: string;
  contactName: string | null;
  conversationId: number | null;
  conversationUuid: string | null;
  status: GrowthActionStatus;
  payload: Record<string, unknown>;
}

const toAction = (r: Raw): GrowthAction => ({
  id: String(r.uuid),
  type: r.type as GrowthActionType,
  severity: r.severity as GrowthAction['severity'],
  contactId: String(r.contact_uuid),
  contactName: str(r.contact_name),
  conversationId: str(r.conversation_uuid),
  title: String(r.title),
  detail: str(r.detail),
  payload: (r.payload ?? {}) as Record<string, unknown>,
  status: r.status as GrowthActionStatus,
  createdAt: date(r.created_at).toISOString(),
  decidedAt: r.decided_at ? date(r.decided_at).toISOString() : null,
});

const ACTION_SELECT = sql`
  a.id, a.uuid, a.type, a.severity, a.title, a.detail, a.payload, a.status, a.created_at, a.decided_at,
  c.uuid AS contact_uuid, c.name AS contact_name, cv.uuid AS conversation_uuid`;
const ACTION_FROM = sql`
  FROM growth_actions a
  JOIN contacts c ON c.org_id = a.org_id AND c.id = a.contact_id
  LEFT JOIN conversations cv ON cv.org_id = a.org_id AND cv.id = a.conversation_id`;

/** A stage as the audiences and rules need it: ordered, with the closing flags. */
export interface Stage {
  value: string;
  label: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
}

/** All SQL of the growth pilot. Every method takes the caller's transaction (tenant context already set by txAs, or privileged). */
@Injectable()
export class GrowthRepository {
  // --- settings -----------------------------------------------------------------------------------------------------

  async getSettings(tx: Tx, orgId: number): Promise<StoredSettings | null> {
    const res = await tx.execute(
      sql`SELECT features, config, row_version FROM growth_settings WHERE org_id = ${orgId}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? { features: r.features, config: r.config, rowVersion: num(r.row_version) } : null;
  }

  /** First save inserts; later saves need the version they read. False on a conflict. */
  async saveSettings(
    tx: Tx,
    orgId: number,
    features: Record<string, boolean>,
    config: Partial<GrowthConfig>,
    rowVersion: number | undefined,
  ): Promise<boolean> {
    if (rowVersion === undefined) {
      const res = await tx.execute(sql`
        INSERT INTO growth_settings (org_id, features, config)
        VALUES (${orgId}, ${JSON.stringify(features)}::jsonb, ${JSON.stringify(config)}::jsonb)
        ON CONFLICT (org_id) DO NOTHING RETURNING org_id`);
      return res.rows.length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE growth_settings SET features = ${JSON.stringify(features)}::jsonb, config = ${JSON.stringify(config)}::jsonb
       WHERE org_id = ${orgId} AND row_version = ${rowVersion} RETURNING org_id`);
    return res.rows.length > 0;
  }

  /** The workspaces of the pilot that have this part switched on: what a sweeper loops over, and nothing else. */
  async pilotOrgs(tx: Tx, slugs: readonly string[], feature: GrowthFeature): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT o.id FROM organizations o
        JOIN growth_settings g ON g.org_id = o.id
       WHERE o.slug IN (SELECT jsonb_array_elements_text(${JSON.stringify(slugs)}::jsonb))
         AND g.features ->> ${feature} = 'true'`);
    return (res.rows as Raw[]).map((r) => num(r.id));
  }

  async orgSlug(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(sql`SELECT slug FROM organizations WHERE id = ${orgId}`);
    return str((res.rows[0] as Raw | undefined)?.slug);
  }

  async timezone(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT timezone FROM workspace_settings WHERE org_id = ${orgId}`,
    );
    return str((res.rows[0] as Raw | undefined)?.timezone);
  }

  async stages(tx: Tx, orgId: number): Promise<Stage[]> {
    const res = await tx.execute(sql`
      SELECT value, label, position, is_won, is_lost FROM status_options
       WHERE org_id = ${orgId} AND module_key = 'contacts' AND option_group = 'lifecycle_stage' AND is_active
       ORDER BY position, id`);
    return (res.rows as Raw[]).map((r) => ({
      value: String(r.value),
      label: String(r.label),
      position: num(r.position),
      isWon: r.is_won === true,
      isLost: r.is_lost === true,
    }));
  }

  // --- campaigns: the replies that happened -----------------------------------------------------------------------------

  /** One row per campaign sent in the last `days` days, with the replies that really followed the send. */
  async campaignReport(tx: Tx, orgId: number, days: number): Promise<GrowthCampaignRow[]> {
    const res = await tx.execute(sql`
      WITH r AS (
        SELECT w.campaign_id, w.sent_at, w.delivered_at, w.read_at, w.responded_at,
               (SELECT min(m.created_at) FROM conversations cv
                  JOIN messages m ON m.org_id = cv.org_id AND m.conversation_id = cv.id
                 WHERE cv.org_id = w.org_id AND cv.contact_id = w.contact_id AND cv.peer_key NOT LIKE '%@g.us'
                   AND m.direction = 'in' AND m.sender_kind = 'customer' AND m.kind <> 'reaction' AND m.deleted_at IS NULL
                   AND m.created_at > w.sent_at AND m.created_at <= w.sent_at + interval '72 hours') AS first_in
          FROM wp_campaign_contacts w
         WHERE w.org_id = ${orgId} AND w.sent_at >= now() - make_interval(days => ${days}) AND w.contact_id IS NOT NULL)
      SELECT c.uuid, c.campaign_name, t.template_name, min(r.sent_at) AS sent_at,
             count(r.sent_at) AS sent, count(r.delivered_at) AS delivered, count(r.read_at) AS read,
             count(*) FILTER (WHERE r.first_in <= r.sent_at + interval '24 hours') AS replied24,
             count(*) FILTER (WHERE r.first_in IS NOT NULL) AS replied72,
             count(r.responded_at) AS recorded
        FROM r
        JOIN wpcampaigns c ON c.org_id = ${orgId} AND c.id = r.campaign_id
        LEFT JOIN wa_templates t ON t.org_id = c.org_id AND t.id = c.template_id
       GROUP BY c.uuid, c.campaign_name, t.template_name
       ORDER BY min(r.sent_at) DESC`);
    return (res.rows as Raw[]).map((r) => {
      const sent = num(r.sent);
      return {
        id: String(r.uuid),
        name: String(r.campaign_name),
        templateName: str(r.template_name),
        sentAt: r.sent_at ? date(r.sent_at).toISOString() : null,
        sent,
        delivered: num(r.delivered),
        read: num(r.read),
        replied24h: num(r.replied24),
        replied72h: num(r.replied72),
        recordedResponses: num(r.recorded),
        readRate: sent > 0 ? Math.round((num(r.read) / sent) * 1000) / 1000 : 0,
        replyRate24h: sent > 0 ? Math.round((num(r.replied24) / sent) * 1000) / 1000 : 0,
      };
    });
  }

  /** The real reply rate of each approved template (replies within a day of a send, over the last 180 days). */
  async templateReplyRates(
    tx: Tx,
    orgId: number,
  ): Promise<Map<number, { sent: number; replyRate24h: number | null }>> {
    const res = await tx.execute(sql`
      WITH r AS (
        SELECT c.template_id, w.sent_at,
               (SELECT min(m.created_at) FROM conversations cv
                  JOIN messages m ON m.org_id = cv.org_id AND m.conversation_id = cv.id
                 WHERE cv.org_id = w.org_id AND cv.contact_id = w.contact_id AND m.direction = 'in' AND m.sender_kind = 'customer'
                   AND m.kind <> 'reaction' AND m.deleted_at IS NULL
                   AND m.created_at > w.sent_at AND m.created_at <= w.sent_at + interval '24 hours') AS first_in
          FROM wp_campaign_contacts w JOIN wpcampaigns c ON c.org_id = w.org_id AND c.id = w.campaign_id
         WHERE w.org_id = ${orgId} AND w.sent_at >= now() - interval '180 days' AND w.contact_id IS NOT NULL AND c.template_id IS NOT NULL)
      SELECT template_id, count(*) AS sent, count(first_in) AS replied FROM r GROUP BY template_id`);
    const out = new Map<number, { sent: number; replyRate24h: number | null }>();
    for (const r of res.rows as Raw[]) {
      const sent = num(r.sent);
      out.set(num(r.template_id), { sent, replyRate24h: sent > 0 ? num(r.replied) / sent : null });
    }
    return out;
  }

  /**
   * Gives every recipient that wrote to us within 72 hours of the send a response time (the first message after it). Nothing wrote
   * that time before. Returns the campaigns whose counts need to be recounted and how many recipients were stamped.
   */
  async stampResponses(
    tx: Tx,
    orgId: number,
    days: number,
  ): Promise<{ stamped: number; campaignIds: number[] }> {
    const res = await tx.execute(sql`
      WITH r AS (
        SELECT w.id, w.campaign_id,
               (SELECT min(m.created_at) FROM conversations cv
                  JOIN messages m ON m.org_id = cv.org_id AND m.conversation_id = cv.id
                 WHERE cv.org_id = w.org_id AND cv.contact_id = w.contact_id AND cv.peer_key NOT LIKE '%@g.us'
                   AND m.direction = 'in' AND m.sender_kind = 'customer' AND m.kind <> 'reaction' AND m.deleted_at IS NULL
                   AND m.created_at > w.sent_at AND m.created_at <= w.sent_at + interval '72 hours') AS first_in
          FROM wp_campaign_contacts w
         WHERE w.org_id = ${orgId} AND w.sent_at >= now() - make_interval(days => ${days}) AND w.contact_id IS NOT NULL
           AND w.responded_at IS NULL)
      UPDATE wp_campaign_contacts w SET responded_at = r.first_in
        FROM r WHERE w.org_id = ${orgId} AND w.id = r.id AND r.first_in IS NOT NULL
      RETURNING w.campaign_id`);
    const ids = [...new Set((res.rows as Raw[]).map((r) => num(r.campaign_id)))];
    return { stamped: res.rows.length, campaignIds: ids };
  }

  // --- audiences ---------------------------------------------------------------------------------------------------------

  private clean = sql`NOT c.is_archived AND NOT c.is_unsubscribed`;

  async engagedIds(tx: Tx, orgId: number, minOpens: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT w.contact_id FROM wp_campaign_contacts w JOIN contacts c ON c.org_id = w.org_id AND c.id = w.contact_id
       WHERE w.org_id = ${orgId} AND w.read_at >= now() - interval '30 days' AND ${this.clean}
       GROUP BY w.contact_id HAVING count(*) >= ${minOpens} LIMIT ${MAX_AUDIENCE}`);
    return (res.rows as Raw[]).map((r) => num(r.contact_id));
  }

  /** Received three or more campaigns in 30 days and opened none, and wrote nothing either. */
  async silentIds(tx: Tx, orgId: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT w.contact_id FROM wp_campaign_contacts w JOIN contacts c ON c.org_id = w.org_id AND c.id = w.contact_id
       WHERE w.org_id = ${orgId} AND w.sent_at >= now() - interval '30 days' AND ${this.clean}
         AND NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.org_id = w.org_id AND cv.contact_id = w.contact_id
                          AND cv.last_inbound_at >= now() - interval '30 days')
       GROUP BY w.contact_id HAVING count(w.sent_at) >= 3 AND count(w.read_at) = 0 LIMIT ${MAX_AUDIENCE}`);
    return (res.rows as Raw[]).map((r) => num(r.contact_id));
  }

  /** Customers (a won stage, or the stage called customer) who opened nothing and wrote nothing for `days` days. */
  async lapsedIds(tx: Tx, orgId: number, days: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT c.id FROM contacts c
        LEFT JOIN status_options so ON so.org_id = c.org_id AND so.module_key = 'contacts'
                                   AND so.option_group = 'lifecycle_stage' AND so.value = c.lifecycle_stage
       WHERE c.org_id = ${orgId} AND ${this.clean}
         AND (c.won_at IS NOT NULL OR COALESCE(so.is_won, false) OR c.lifecycle_stage IN ('customer', 'won'))
         AND c.created_at < now() - make_interval(days => ${days})
         AND NOT EXISTS (SELECT 1 FROM wp_campaign_contacts w WHERE w.org_id = c.org_id AND w.contact_id = c.id
                          AND w.read_at >= now() - make_interval(days => ${days}))
         AND NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.org_id = c.org_id AND cv.contact_id = c.id
                          AND cv.last_inbound_at >= now() - make_interval(days => ${days}))
       LIMIT ${MAX_AUDIENCE}`);
    return (res.rows as Raw[]).map((r) => num(r.id));
  }

  /** Contacts whose chat was read as ready to buy in the last 14 days. */
  async hotChatIds(tx: Tx, orgId: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT d.contact_id FROM lead_chat_digests d JOIN contacts c ON c.org_id = d.org_id AND c.id = d.contact_id
       WHERE d.org_id = ${orgId} AND d.created_at >= now() - interval '14 days' AND ${this.clean}
         AND (d.intent = 'ready_to_buy' OR d.signals ->> 'readyToBuy' = 'true') LIMIT ${MAX_AUDIENCE}`);
    return (res.rows as Raw[]).map((r) => num(r.contact_id));
  }

  /** The top tenth by conversion score, among those who have not converted yet. */
  async highPropensityIds(tx: Tx, orgId: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT p.contact_id FROM contact_propensity p JOIN contacts c ON c.org_id = p.org_id AND c.id = p.contact_id
       WHERE p.org_id = ${orgId} AND ${this.clean} AND c.won_at IS NULL AND c.lifecycle_stage NOT IN ('customer', 'won')
         AND p.score >= GREATEST(30, (SELECT COALESCE(percentile_disc(0.9) WITHIN GROUP (ORDER BY score), 100)
                                        FROM contact_propensity WHERE org_id = ${orgId}))
       ORDER BY p.score DESC LIMIT ${MAX_AUDIENCE}`);
    return (res.rows as Raw[]).map((r) => num(r.contact_id));
  }

  /** Contacts whose date property is `afterDays` to `untilDays` days ago (a repair done, a purchase made). */
  async serviceDueIds(tx: Tx, orgId: number, rule: ServiceRule): Promise<number[]> {
    const until = rule.untilDays ?? rule.afterDays + 30;
    const res = await tx.execute(sql`
      SELECT c.id FROM contacts c
       WHERE c.org_id = ${orgId} AND ${this.clean} AND c.data ->> ${rule.dateField} ~ '^\\d{4}-\\d{2}-\\d{2}'
         AND substring(c.data ->> ${rule.dateField} from 1 for 10)::date
             BETWEEN (current_date - ${until}::int) AND (current_date - ${rule.afterDays}::int)
       LIMIT ${MAX_AUDIENCE}`);
    return (res.rows as Raw[]).map((r) => num(r.id));
  }

  // --- send times ----------------------------------------------------------------------------------------------------------

  async hourHistograms(
    tx: Tx,
    orgId: number,
    timezone: string,
  ): Promise<{ inbound: number[]; read: number[] }> {
    const inbound = Array<number>(24).fill(0);
    const read = Array<number>(24).fill(0);
    const a = await tx.execute(sql`
      SELECT extract(hour FROM COALESCE(m.provider_ts, m.created_at) AT TIME ZONE ${timezone})::int AS h, count(*) AS n
        FROM messages m
       WHERE m.org_id = ${orgId} AND m.direction = 'in' AND m.sender_kind = 'customer' AND m.kind <> 'reaction'
         AND m.deleted_at IS NULL AND m.created_at >= now() - interval '90 days'
       GROUP BY 1`);
    for (const r of a.rows as Raw[]) inbound[num(r.h)] = num(r.n);
    const b = await tx.execute(sql`
      SELECT extract(hour FROM w.read_at AT TIME ZONE ${timezone})::int AS h, count(*) AS n
        FROM wp_campaign_contacts w WHERE w.org_id = ${orgId} AND w.read_at >= now() - interval '90 days' GROUP BY 1`);
    for (const r of b.rows as Raw[]) read[num(r.h)] = num(r.n);
    return { inbound, read };
  }

  // --- the Growth inbox ----------------------------------------------------------------------------------------------------

  /** Writes an action unless one with the same key is already open. Returns its internal id, or null when it was a repeat. */
  async insertAction(tx: Tx, orgId: number, w: ActionWrite): Promise<number | null> {
    const res = await tx.execute(sql`
      INSERT INTO growth_actions (org_id, type, contact_id, conversation_id, digest_id, severity, title, detail, payload, dedupe_key)
      VALUES (${orgId}, ${w.type}, ${w.contactId}, ${w.conversationId ?? null}, ${w.digestId ?? null}, ${w.severity ?? 'info'},
              ${w.title}, ${w.detail ?? null}, ${JSON.stringify(w.payload ?? {})}::jsonb, ${w.dedupeKey})
      ON CONFLICT (org_id, dedupe_key) WHERE status = 'open' DO NOTHING
      RETURNING id`);
    const r = res.rows[0] as Raw | undefined;
    return r ? num(r.id) : null;
  }

  async listActions(
    tx: Tx,
    orgId: number,
    q: GrowthActionsQuery,
  ): Promise<{ items: GrowthAction[]; hasMore: boolean; nextCursor: string | null }> {
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await tx.execute(sql`
      SELECT ${ACTION_SELECT}, a.id AS aid ${ACTION_FROM}
       WHERE a.org_id = ${orgId} AND a.status = ${q.status}
         ${q.type ? sql`AND a.type = ${q.type}` : sql``}
         ${cur ? sql`AND (a.created_at, a.id) < (${cur.at.toISOString()}::timestamptz, ${cur.id})` : sql``}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows as Raw[];
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(toAction),
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor(date(last.created_at), num(last.aid ?? last.id)) : null,
    };
  }

  async openByType(tx: Tx, orgId: number): Promise<Record<string, number>> {
    const res = await tx.execute(sql`
      SELECT type, count(*) AS n FROM growth_actions WHERE org_id = ${orgId} AND status = 'open' GROUP BY type`);
    const out: Record<string, number> = {};
    for (const r of res.rows as Raw[]) out[String(r.type)] = num(r.n);
    return out;
  }

  async actionByUuid(tx: Tx, orgId: number, uuid: string): Promise<ActionRow | null> {
    const res = await tx.execute(sql`
      SELECT a.id, a.uuid, a.type, a.contact_id, a.conversation_id, a.status, a.payload,
             c.uuid AS contact_uuid, c.name AS contact_name, cv.uuid AS conversation_uuid
        ${ACTION_FROM} WHERE a.org_id = ${orgId} AND a.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: num(r.id),
          uuid: String(r.uuid),
          type: r.type as GrowthActionType,
          contactId: num(r.contact_id),
          contactUuid: String(r.contact_uuid),
          contactName: str(r.contact_name),
          conversationId: r.conversation_id === null ? null : num(r.conversation_id),
          conversationUuid: str(r.conversation_uuid),
          status: r.status as GrowthActionStatus,
          payload: (r.payload ?? {}) as Record<string, unknown>,
        }
      : null;
  }

  /** Marks one open action decided. False when it was no longer open. */
  async decideAction(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'done' | 'dismissed',
    userId: number | null,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE growth_actions SET status = ${status}, decided_by = ${userId}, decided_at = now()
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'open' RETURNING id`);
    return res.rows.length > 0;
  }

  /** An open action whose key matches is no longer true (a hot lead who bought, a question that was answered). */
  async closeByKey(tx: Tx, orgId: number, dedupeKey: string): Promise<void> {
    await tx.execute(sql`
      UPDATE growth_actions SET status = 'expired', decided_at = now()
       WHERE org_id = ${orgId} AND dedupe_key = ${dedupeKey} AND status = 'open'`);
  }

  async expireOldActions(tx: Tx, days: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE growth_actions SET status = 'expired', decided_at = now()
       WHERE status = 'open' AND created_at < now() - make_interval(days => ${days}) RETURNING 1`);
    return res.rows.length;
  }

  // --- unanswered buying questions --------------------------------------------------------------------------------------------

  async unansweredIntent(
    tx: Tx,
    orgId: number,
    hours: number,
  ): Promise<
    Array<{
      conversationId: number;
      conversationUuid: string;
      contactId: number;
      digestId: number;
      intent: string;
      hoursWaiting: number;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT cv.id, cv.uuid, cv.contact_id, d.id AS digest_id, d.intent,
             extract(epoch FROM now() - cv.last_inbound_at) / 3600 AS hours_waiting
        FROM conversations cv
        JOIN LATERAL (SELECT id, intent, signals FROM lead_chat_digests d
                       WHERE d.org_id = cv.org_id AND d.contact_id = cv.contact_id ORDER BY d.created_at DESC, d.id DESC LIMIT 1) d ON true
       WHERE cv.org_id = ${orgId} AND cv.contact_id IS NOT NULL AND cv.peer_key NOT LIKE '%@g.us'
         AND (d.intent IN ('ready_to_buy', 'asking_price') OR d.signals ->> 'readyToBuy' = 'true' OR d.signals ->> 'askedPrice' = 'true')
         AND cv.last_inbound_at < now() - make_interval(hours => ${hours}) AND cv.last_inbound_at > now() - interval '14 days'
         AND (cv.last_outbound_at IS NULL OR cv.last_outbound_at < cv.last_inbound_at)
       LIMIT 200`);
    return (res.rows as Raw[]).map((r) => ({
      conversationId: num(r.id),
      conversationUuid: String(r.uuid),
      contactId: num(r.contact_id),
      digestId: num(r.digest_id),
      intent: String(r.intent),
      hoursWaiting: Math.round(num(r.hours_waiting)),
    }));
  }

  // --- the conversion model ------------------------------------------------------------------------------------------------------

  async propensityRows(tx: Tx, orgId: number): Promise<PropensityRow[]> {
    const res = await tx.execute(sql`
      WITH camp AS (
        SELECT contact_id,
               count(*) FILTER (WHERE read_at >= now() - interval '30 days') AS opens,
               count(*) FILTER (WHERE sent_at >= now() - interval '30 days') AS recv,
               count(*) FILTER (WHERE clicked AND clicked_at >= now() - interval '30 days') AS clk
          FROM wp_campaign_contacts WHERE org_id = ${orgId} AND contact_id IS NOT NULL GROUP BY contact_id),
      msg AS (
        SELECT cv.contact_id,
               count(*) FILTER (WHERE m.direction = 'in' AND m.sender_kind = 'customer' AND m.kind <> 'reaction'
                                  AND m.created_at >= now() - interval '30 days') AS inb30,
               count(*) AS total
          FROM conversations cv JOIN messages m ON m.org_id = cv.org_id AND m.conversation_id = cv.id
         WHERE cv.org_id = ${orgId} AND cv.contact_id IS NOT NULL AND m.org_id = ${orgId} AND m.deleted_at IS NULL
         GROUP BY cv.contact_id),
      grp AS (SELECT contact_id, count(*) AS g FROM contact_group_members WHERE org_id = ${orgId} GROUP BY contact_id)
      SELECT c.id,
             COALESCE(camp.opens, 0) AS opens, COALESCE(camp.recv, 0) AS recv, COALESCE(msg.inb30, 0) AS inb30,
             COALESCE(camp.clk, 0) AS clk, COALESCE(grp.g, 0) AS g, (c.email IS NOT NULL)::int AS has_email,
             COALESCE(msg.total, 0) AS total, extract(epoch FROM now() - c.created_at) / 86400 AS age_days,
             (c.won_at IS NOT NULL OR COALESCE(so.is_won, false) OR c.lifecycle_stage IN ('customer', 'won')) AS converted
        FROM contacts c
        LEFT JOIN camp ON camp.contact_id = c.id
        LEFT JOIN msg ON msg.contact_id = c.id
        LEFT JOIN grp ON grp.contact_id = c.id
        LEFT JOIN status_options so ON so.org_id = c.org_id AND so.module_key = 'contacts'
                                   AND so.option_group = 'lifecycle_stage' AND so.value = c.lifecycle_stage
       WHERE c.org_id = ${orgId} AND NOT c.is_archived`);
    return (res.rows as Raw[]).map((r) => ({
      contactId: num(r.id),
      raw: [
        num(r.opens),
        num(r.recv),
        num(r.inb30),
        num(r.clk),
        num(r.g),
        num(r.has_email),
        num(r.total),
        num(r.age_days),
      ],
      y: r.converted === true ? 1 : 0,
    }));
  }

  /** Replaces the propensity of the workspace's contacts, in chunks. */
  async savePropensity(
    tx: Tx,
    orgId: number,
    rows: ReadonlyArray<{ contactId: number; score: number; features: Record<string, number> }>,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = JSON.stringify(
        rows.slice(i, i + 500).map((r) => ({ c: r.contactId, s: r.score, f: r.features })),
      );
      await tx.execute(sql`
        INSERT INTO contact_propensity (org_id, contact_id, score, features, computed_at)
        SELECT ${orgId}, (e ->> 'c')::bigint, (e ->> 's')::smallint, e -> 'f', now() FROM jsonb_array_elements(${chunk}::jsonb) e
        ON CONFLICT (org_id, contact_id) DO UPDATE SET score = EXCLUDED.score, features = EXCLUDED.features, computed_at = now()`);
    }
  }

  async propensityOf(
    tx: Tx,
    orgId: number,
    contactUuid: string,
  ): Promise<{ score: number; features: Record<string, number>; computedAt: Date } | null> {
    const res = await tx.execute(sql`
      SELECT p.score, p.features, p.computed_at FROM contact_propensity p JOIN contacts c ON c.org_id = p.org_id AND c.id = p.contact_id
       WHERE p.org_id = ${orgId} AND c.uuid = ${contactUuid}::uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          score: num(r.score),
          features: (r.features ?? {}) as Record<string, number>,
          computedAt: date(r.computed_at),
        }
      : null;
  }

  // --- engagement stage rule --------------------------------------------------------------------------------------------------------

  /** Contacts in `fromStage` that opened enough campaigns (and are in a group, when asked) and have no open suggestion. */
  async engagementStageCandidates(
    tx: Tx,
    orgId: number,
    fromStage: string,
    rule: GrowthConfig['stageRule'],
  ): Promise<Array<{ contactId: number; opens: number; groups: number }>> {
    const res = await tx.execute(sql`
      SELECT c.id, o.opens, COALESCE(g.n, 0) AS groups
        FROM contacts c
        JOIN (SELECT contact_id, count(*) AS opens FROM wp_campaign_contacts
               WHERE org_id = ${orgId} AND read_at >= now() - make_interval(days => ${rule.windowDays}) AND contact_id IS NOT NULL
               GROUP BY contact_id HAVING count(*) >= ${rule.minOpens}) o ON o.contact_id = c.id
        LEFT JOIN (SELECT contact_id, count(*) AS n FROM contact_group_members WHERE org_id = ${orgId} GROUP BY contact_id) g ON g.contact_id = c.id
       WHERE c.org_id = ${orgId} AND c.lifecycle_stage = ${fromStage} AND ${this.clean}
         AND (${!rule.requireGroup} OR COALESCE(g.n, 0) >= 1)
         AND (c.lifecycle_stage_date IS NULL OR c.lifecycle_stage_date < now() - interval '3 days')
         AND NOT EXISTS (SELECT 1 FROM lifecycle_stage_suggestions s WHERE s.org_id = c.org_id AND s.contact_id = c.id
                          AND (s.status = 'pending' OR (s.source = 'engagement' AND s.created_at > now() - interval '14 days')))
       ORDER BY o.opens DESC LIMIT 500`);
    return (res.rows as Raw[]).map((r) => ({
      contactId: num(r.id),
      opens: num(r.opens),
      groups: num(r.groups),
    }));
  }

  // --- guarded automatic stage changes ------------------------------------------------------------------------------------------

  async autoAppliedToday(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*) AS n FROM lifecycle_stage_suggestions
       WHERE org_id = ${orgId} AND status = 'auto_applied' AND decided_at >= date_trunc('day', now())`);
    return num((res.rows[0] as Raw).n);
  }

  /** Open suggestions confident enough to apply by themselves, newest first. */
  async autoStageCandidates(
    tx: Tx,
    orgId: number,
    minConfidence: number,
    limit: number,
  ): Promise<
    Array<{
      id: number;
      uuid: string;
      contactId: number;
      fromStage: string;
      toStage: string;
      confidence: number;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT s.id, s.uuid, s.contact_id, s.from_stage, s.to_stage, s.confidence FROM lifecycle_stage_suggestions s
       WHERE s.org_id = ${orgId} AND s.status = 'pending' AND s.confidence >= ${minConfidence}
       ORDER BY s.confidence DESC, s.created_at DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      id: num(r.id),
      uuid: String(r.uuid),
      contactId: num(r.contact_id),
      fromStage: String(r.from_stage),
      toStage: String(r.to_stage),
      confidence: num(r.confidence),
    }));
  }

  /** The thread a contact's stage line goes into: the newest one-to-one conversation, as its channel and peer. */
  async threadOf(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<{ channelUuid: string; peerKey: string } | null> {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, cv.peer_key FROM conversations cv
        JOIN channels ch ON ch.org_id = cv.org_id AND ch.id = cv.channel_id
       WHERE cv.org_id = ${orgId} AND cv.contact_id = ${contactId} AND cv.peer_key NOT LIKE '%@g.us'
       ORDER BY cv.last_message_at DESC NULLS LAST, cv.id DESC LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { channelUuid: String(r.channel_uuid), peerKey: String(r.peer_key) } : null;
  }

  async markSuggestion(
    tx: Tx,
    orgId: number,
    id: number,
    from: 'pending' | 'auto_applied',
    to: 'auto_applied' | 'undone',
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE lifecycle_stage_suggestions SET status = ${to}, decided_at = now()
       WHERE org_id = ${orgId} AND id = ${id} AND status = ${from} RETURNING id`);
    return res.rows.length > 0;
  }

  async autoStageLog(tx: Tx, orgId: number, limit: number) {
    const res = await tx.execute(sql`
      SELECT s.uuid, s.status, s.from_stage, s.to_stage, s.confidence, s.decided_at, s.contact_id,
             c.uuid AS contact_uuid, c.name AS contact_name, c.lifecycle_stage AS current_stage
        FROM lifecycle_stage_suggestions s JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
       WHERE s.org_id = ${orgId} AND s.status IN ('auto_applied', 'undone')
       ORDER BY s.decided_at DESC NULLS LAST, s.id DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      id: String(r.uuid),
      contactUuid: String(r.contact_uuid),
      contactName: str(r.contact_name),
      status: r.status as 'auto_applied' | 'undone',
      fromStage: String(r.from_stage),
      toStage: String(r.to_stage),
      currentStage: String(r.current_stage),
      confidence: num(r.confidence),
      decidedAt: r.decided_at ? date(r.decided_at) : new Date(),
    }));
  }

  async suggestionForUndo(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{
    id: number;
    contactId: number;
    contactUuid: string;
    fromStage: string;
    toStage: string;
    status: string;
  } | null> {
    const res = await tx.execute(sql`
      SELECT s.id, s.contact_id, s.from_stage, s.to_stage, s.status, c.uuid AS contact_uuid
        FROM lifecycle_stage_suggestions s JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
       WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: num(r.id),
          contactId: num(r.contact_id),
          contactUuid: String(r.contact_uuid),
          fromStage: String(r.from_stage),
          toStage: String(r.to_stage),
          status: String(r.status),
        }
      : null;
  }

  // --- the contact, as the actions need it ------------------------------------------------------------------------------------------

  async contactCore(tx: Tx, orgId: number, contactId: number) {
    const res = await tx.execute(sql`
      SELECT id, uuid, name, email, owner_id, data, lifecycle_stage, is_unsubscribed FROM contacts
       WHERE org_id = ${orgId} AND id = ${contactId} AND NOT is_archived`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: num(r.id),
          uuid: String(r.uuid),
          name: str(r.name),
          email: str(r.email),
          ownerId: r.owner_id === null ? null : num(r.owner_id),
          data: (r.data ?? {}) as Record<string, unknown>,
          lifecycleStage: String(r.lifecycle_stage),
          isUnsubscribed: r.is_unsubscribed === true,
        }
      : null;
  }

  async contactIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? num(r.id) : null;
  }

  /** The active user holding the fewest open conversations: who a hot lead is routed to when nobody owns the contact. */
  async leastBusyUser(
    tx: Tx,
    orgId: number,
  ): Promise<{ id: number; uuid: string; name: string } | null> {
    const res = await tx.execute(sql`
      SELECT u.id, u.uuid, u.full_name,
             (SELECT count(*) FROM conversations cv WHERE cv.org_id = u.org_id AND cv.assignee_user_id = u.id
                 AND cv.status IN ('open', 'pending')) AS open_count
        FROM users u WHERE u.org_id = ${orgId} AND u.status = 'active'
       ORDER BY open_count ASC, u.id ASC LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { id: num(r.id), uuid: String(r.uuid), name: String(r.full_name) } : null;
  }

  async userById(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{ id: number; uuid: string; name: string } | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, full_name FROM users WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { id: num(r.id), uuid: String(r.uuid), name: String(r.full_name) } : null;
  }

  async propertyKeyExists(tx: Tx, orgId: number, key: string): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM fields WHERE org_id = ${orgId} AND module_key = 'contacts' AND key = ${key} AND is_active LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Sets the language of a thread when it has none yet; a person's or an earlier choice is never overwritten. */
  async setConversationLanguage(
    tx: Tx,
    orgId: number,
    conversationId: number,
    language: string,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE conversations SET customer_language = ${language}
       WHERE org_id = ${orgId} AND id = ${conversationId} AND customer_language IS NULL RETURNING id`);
    return res.rows.length > 0;
  }

  // --- the assistant ----------------------------------------------------------------------------------------------------------------

  async audienceCandidates(
    tx: Tx,
    orgId: number,
  ): Promise<Array<{ groupId: string; name: string; size: number }>> {
    const res = await tx.execute(sql`
      SELECT g.uuid, g.name, count(m.contact_id) AS size
        FROM contact_groups g JOIN contact_group_members m ON m.org_id = g.org_id AND m.group_id = g.id
       WHERE g.org_id = ${orgId}
       GROUP BY g.uuid, g.name HAVING count(m.contact_id) >= 5 ORDER BY count(m.contact_id) DESC LIMIT 40`);
    return (res.rows as Raw[]).map((r) => ({
      groupId: String(r.uuid),
      name: String(r.name),
      size: num(r.size),
    }));
  }

  async templateCandidates(
    tx: Tx,
    orgId: number,
  ): Promise<
    Array<{
      internalId: number;
      id: string;
      name: string;
      category: string | null;
      body: string | null;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, category, template_body FROM wa_templates
       WHERE org_id = ${orgId} AND status = 'approved' ORDER BY updated_at DESC LIMIT 40`);
    return (res.rows as Raw[]).map((r) => ({
      internalId: num(r.id),
      id: String(r.uuid),
      name: String(r.template_name),
      category: str(r.category),
      body: str(r.template_body),
    }));
  }

  // --- enrichment ------------------------------------------------------------------------------------------------------------------

  /** Contacts with a business email that were never looked up (or not found more than 30 days ago). */
  async enrichmentCandidates(
    tx: Tx,
    orgId: number,
    limit: number,
  ): Promise<Array<{ id: number; email: string }>> {
    const res = await tx.execute(sql`
      SELECT c.id, c.email::text AS email FROM contacts c
        LEFT JOIN contact_enrichment e ON e.org_id = c.org_id AND e.contact_id = c.id
       WHERE c.org_id = ${orgId} AND NOT c.is_archived AND c.email IS NOT NULL
         AND lower(split_part(c.email::text, '@', 2)) NOT IN
             ('gmail.com','googlemail.com','yahoo.com','yahoo.in','outlook.com','hotmail.com','live.com','icloud.com','aol.com','proton.me','protonmail.com','rediffmail.com')
         AND (e.contact_id IS NULL OR (e.status <> 'found' AND e.fetched_at < now() - interval '30 days'))
       ORDER BY c.last_activity_at DESC NULLS LAST, c.id LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({ id: num(r.id), email: String(r.email) }));
  }

  async saveEnrichment(
    tx: Tx,
    orgId: number,
    contactId: number,
    provider: string,
    status: 'found' | 'not_found' | 'failed',
    data: Record<string, unknown>,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO contact_enrichment (org_id, contact_id, provider, status, data, fetched_at)
      VALUES (${orgId}, ${contactId}, ${provider}, ${status}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (org_id, contact_id) DO UPDATE
        SET provider = EXCLUDED.provider, status = EXCLUDED.status, data = EXCLUDED.data, fetched_at = now()`);
  }

  async enrichmentCounts(
    tx: Tx,
    orgId: number,
  ): Promise<{ found: number; notFound: number; failed: number }> {
    const res = await tx.execute(sql`
      SELECT status, count(*) AS n FROM contact_enrichment WHERE org_id = ${orgId} GROUP BY status`);
    const out = { found: 0, notFound: 0, failed: 0 };
    for (const r of res.rows as Raw[]) {
      if (r.status === 'found') out.found = num(r.n);
      else if (r.status === 'not_found') out.notFound = num(r.n);
      else out.failed = num(r.n);
    }
    return out;
  }

  async enrichmentOf(
    tx: Tx,
    orgId: number,
    contactUuid: string,
  ): Promise<{ status: string; data: Record<string, unknown>; fetchedAt: Date } | null> {
    const res = await tx.execute(sql`
      SELECT e.status, e.data, e.fetched_at FROM contact_enrichment e JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
       WHERE e.org_id = ${orgId} AND c.uuid = ${contactUuid}::uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          status: String(r.status),
          data: (r.data ?? {}) as Record<string, unknown>,
          fetchedAt: date(r.fetched_at),
        }
      : null;
  }

  // --- quality and the daily digest -----------------------------------------------------------------------------------------------------

  async suggestionStats(tx: Tx, orgId: number, days: number) {
    const res = await tx.execute(sql`
      SELECT source, status, count(*) AS n FROM lifecycle_stage_suggestions
       WHERE org_id = ${orgId} AND created_at >= now() - make_interval(days => ${days}) GROUP BY source, status`);
    return res.rows as Raw[];
  }

  async actionStats(tx: Tx, orgId: number, days: number) {
    const res = await tx.execute(sql`
      SELECT type, status, count(*) AS n FROM growth_actions
       WHERE org_id = ${orgId} AND created_at >= now() - make_interval(days => ${days}) GROUP BY type, status`);
    return res.rows as Raw[];
  }

  /** (score, converted) of every scored contact, to measure how well the score separates those who converted. */
  async scoreOutcomes(tx: Tx, orgId: number): Promise<Array<{ score: number; y: 0 | 1 }>> {
    const res = await tx.execute(sql`
      SELECT c.lead_score, (c.won_at IS NOT NULL OR COALESCE(so.is_won, false) OR c.lifecycle_stage IN ('customer', 'won')) AS converted
        FROM contacts c
        LEFT JOIN status_options so ON so.org_id = c.org_id AND so.module_key = 'contacts'
                                   AND so.option_group = 'lifecycle_stage' AND so.value = c.lifecycle_stage
       WHERE c.org_id = ${orgId} AND NOT c.is_archived AND c.lead_score IS NOT NULL`);
    return (res.rows as Raw[]).map((r) => ({
      score: num(r.lead_score),
      y: r.converted === true ? 1 : 0,
    }));
  }

  async costStats(
    tx: Tx,
    orgId: number,
    days: number,
  ): Promise<{ calls: number; costUsd: number }> {
    const res = await tx.execute(sql`
      SELECT count(*) AS calls, COALESCE(sum(cost_usd), 0) AS cost FROM lead_scoring_runs
       WHERE org_id = ${orgId} AND created_at >= now() - make_interval(days => ${days}) AND status IN ('ok', 'kept', 'failed')`);
    const r = res.rows[0] as Raw;
    return { calls: num(r.calls), costUsd: Number(r.cost) };
  }

  async digestFacts(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM growth_actions WHERE org_id = ${orgId} AND status = 'open' AND type = 'hot_lead') AS hot,
        (SELECT count(*) FROM growth_actions WHERE org_id = ${orgId} AND status = 'open' AND type = 'unanswered_intent') AS unanswered,
        (SELECT count(*) FROM growth_actions WHERE org_id = ${orgId} AND status = 'open' AND type = 'opt_out') AS optouts,
        (SELECT count(*) FROM growth_actions WHERE org_id = ${orgId} AND status = 'open') AS open_actions,
        (SELECT count(*) FROM growth_actions WHERE org_id = ${orgId} AND status = 'open' AND type = 'lapsed') AS lapsed,
        (SELECT count(*) FROM lifecycle_stage_suggestions WHERE org_id = ${orgId} AND status = 'pending') AS pending,
        (SELECT count(*) FROM conversations WHERE org_id = ${orgId} AND created_at >= now() - interval '24 hours') AS new_chats,
        (SELECT count(*) FROM contact_propensity WHERE org_id = ${orgId} AND score >= 70) AS top_propensity,
        (SELECT count(*) FROM wp_campaign_contacts WHERE org_id = ${orgId} AND sent_at >= now() - interval '24 hours') AS sent,
        (SELECT count(*) FROM wp_campaign_contacts WHERE org_id = ${orgId} AND read_at >= now() - interval '24 hours') AS read,
        (SELECT count(*) FROM wp_campaign_contacts WHERE org_id = ${orgId} AND responded_at >= now() - interval '24 hours') AS replied`);
    return res.rows[0] as Raw;
  }

  async saveDigest(tx: Tx, orgId: number, day: string, payload: unknown): Promise<void> {
    await tx.execute(sql`
      INSERT INTO growth_daily_digests (org_id, day, payload) VALUES (${orgId}, ${day}::date, ${JSON.stringify(payload)}::jsonb)
      ON CONFLICT (org_id, day) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()`);
  }

  async latestDigest(tx: Tx, orgId: number): Promise<unknown | null> {
    const res = await tx.execute(sql`
      SELECT payload FROM growth_daily_digests WHERE org_id = ${orgId} ORDER BY day DESC LIMIT 1`);
    return (res.rows[0] as Raw | undefined)?.payload ?? null;
  }

  async deleteOldDigests(tx: Tx, days: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM growth_daily_digests WHERE day < current_date - ${days}::int RETURNING 1`);
    return res.rows.length;
  }

  // --- groups -----------------------------------------------------------------------------------------------------------------------

  async groupByName(
    tx: Tx,
    orgId: number,
    name: string,
  ): Promise<{ uuid: string; size: number } | null> {
    const res = await tx.execute(sql`
      SELECT g.uuid, (SELECT count(*) FROM contact_group_members m WHERE m.org_id = g.org_id AND m.group_id = g.id) AS size
        FROM contact_groups g WHERE g.org_id = ${orgId} AND lower(g.name) = lower(${name})`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { uuid: String(r.uuid), size: num(r.size) } : null;
  }

  /** When the audience group was last rebuilt (the group row is touched by every sync). */
  async groupSyncedAt(tx: Tx, orgId: number, name: string): Promise<Date | null> {
    const res = await tx.execute(sql`
      SELECT updated_at FROM contact_groups WHERE org_id = ${orgId} AND lower(name) = lower(${name})`);
    const t = (res.rows[0] as Raw | undefined)?.updated_at;
    return t ? date(t) : null;
  }

  async conversationVersion(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT row_version FROM conversations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? num(r.row_version) : null;
  }

  async channelKindOfConversation(
    tx: Tx,
    orgId: number,
    conversationId: number,
  ): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT ch.kind FROM conversations cv JOIN channels ch ON ch.org_id = cv.org_id AND ch.id = cv.channel_id
       WHERE cv.org_id = ${orgId} AND cv.id = ${conversationId}`);
    return str((res.rows[0] as Raw | undefined)?.kind);
  }

  async conversationContact(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; contactId: number | null } | null> {
    const res = await tx.execute(
      sql`SELECT id, contact_id FROM conversations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r
      ? { id: num(r.id), contactId: r.contact_id === null ? null : num(r.contact_id) }
      : null;
  }

  /** The newest reading of a contact within `days`: the summary, the intent and how it was made. */
  async latestSummary(
    tx: Tx,
    orgId: number,
    contactId: number,
    days: number,
  ): Promise<{ summary: string | null; intent: string; source: string } | null> {
    const res = await tx.execute(sql`
      SELECT summary, intent, source FROM lead_chat_digests
       WHERE org_id = ${orgId} AND contact_id = ${contactId} AND created_at >= now() - make_interval(days => ${days})
       ORDER BY created_at DESC, id DESC LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? { summary: str(r.summary), intent: String(r.intent), source: String(r.source) }
      : null;
  }

  /** Unanswered-question actions whose conversation has since been answered are no longer true. */
  async closeAnsweredUnanswered(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE growth_actions a SET status = 'expired', decided_at = now()
       WHERE a.org_id = ${orgId} AND a.type = 'unanswered_intent' AND a.status = 'open'
         AND EXISTS (SELECT 1 FROM conversations cv WHERE cv.org_id = a.org_id AND cv.id = a.conversation_id
                      AND cv.last_outbound_at IS NOT NULL AND cv.last_outbound_at >= cv.last_inbound_at)
      RETURNING 1`);
    return res.rows.length;
  }

  /** The groups a contact is in and the last campaign message it was sent: what a registration problem needs to be looked into. */
  async registrationFacts(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<{
    groups: string[];
    lastSend: { campaign: string; template: string | null; status: string; sentAt: string } | null;
  }> {
    const g = await tx.execute(sql`
      SELECT cg.name FROM contact_group_members m JOIN contact_groups cg ON cg.org_id = m.org_id AND cg.id = m.group_id
       WHERE m.org_id = ${orgId} AND m.contact_id = ${contactId} ORDER BY cg.name LIMIT 5`);
    const s = await tx.execute(sql`
      SELECT c.campaign_name, t.template_name, w.status, w.sent_at FROM wp_campaign_contacts w
        JOIN wpcampaigns c ON c.org_id = w.org_id AND c.id = w.campaign_id
        LEFT JOIN wa_templates t ON t.org_id = c.org_id AND t.id = c.template_id
       WHERE w.org_id = ${orgId} AND w.contact_id = ${contactId} AND w.sent_at IS NOT NULL
       ORDER BY w.sent_at DESC LIMIT 1`);
    const r = s.rows[0] as Raw | undefined;
    return {
      groups: (g.rows as Raw[]).map((x) => String(x.name)),
      lastSend: r
        ? {
            campaign: String(r.campaign_name),
            template: str(r.template_name),
            status: String(r.status),
            sentAt: date(r.sent_at).toISOString(),
          }
        : null,
    };
  }

  // --- stored models ----------------------------------------------------------------------------------------------------------------

  async saveModel(tx: Tx, orgId: number, name: string, payload: unknown): Promise<void> {
    await tx.execute(sql`
      INSERT INTO growth_models (org_id, name, payload) VALUES (${orgId}, ${name}, ${JSON.stringify(payload)}::jsonb)
      ON CONFLICT (org_id, name) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`);
  }

  async getModel(tx: Tx, orgId: number, name: string): Promise<unknown | null> {
    const res = await tx.execute(
      sql`SELECT payload FROM growth_models WHERE org_id = ${orgId} AND name = ${name}`,
    );
    return (res.rows[0] as Raw | undefined)?.payload ?? null;
  }
}

const encodeCursor = (at: Date, id: number): string =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
function decodeCursor(cursor: string): { at: Date; id: number } | null {
  const [a, i] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = new Date(a ?? '');
  const id = Number(i);
  return Number.isNaN(at.getTime()) || !Number.isInteger(id) ? null : { at, id };
}
