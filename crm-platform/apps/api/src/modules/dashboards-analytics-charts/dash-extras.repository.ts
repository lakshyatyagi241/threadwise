import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DashWidgets } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0);

/** WaDesk shows "n / 12" (a conceptual total, 12 integrations on its catalog page); we count the ten that have connection tables here. */
export const INTEGRATION_CATALOG_SIZE = 12;

/**
 * The dashboard cards that read other domains' tables (Instagram band, flow counters, integration status). Read-only, RLS-scoped; each
 * method is one transaction-local aggregate and returns the empty shape rather than failing the page (WaDesk: any exception hides the band).
 */
@Injectable()
export class DashExtrasRepository {
  /** WD-DASH-008. Null when no Instagram account is linked. Fixed 7-day window; not range-scoped. */
  async instagram(tx: Tx, orgId: number, now: Date): Promise<DashWidgets['instagram']> {
    const accounts = (
      await tx.execute(sql`
        SELECT username, name, avatar, status, coalesce(followers, 0) AS followers
        FROM workspace_ig_accounts WHERE org_id = ${orgId}
        ORDER BY followers DESC NULLS LAST, id`)
    ).rows as Raw[];
    if (accounts.length === 0) return null;
    const from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const c = (
      await tx.execute(sql`
        SELECT count(*) FILTER (WHERE NOT cv.archived)::int AS open,
               count(*) FILTER (WHERE NOT cv.archived AND (cv.unread_count > 0 OR
                 (cv.last_inbound_at IS NOT NULL AND (cv.last_outbound_at IS NULL OR cv.last_inbound_at > cv.last_outbound_at))))::int AS needs_reply,
               coalesce(sum(cv.unread_count) FILTER (WHERE NOT cv.archived), 0)::int AS unread
        FROM conversations cv JOIN channels ch ON ch.org_id = cv.org_id AND ch.id = cv.channel_id
        WHERE cv.org_id = ${orgId} AND ch.kind = 'instagram'`)
    ).rows[0] as Raw;
    const m = (
      await tx.execute(sql`
        SELECT count(*) FILTER (WHERE m.direction = 'in')::int AS dms_in,
               count(*) FILTER (WHERE m.direction = 'out')::int AS dms_out
        FROM messages m JOIN conversations cv ON cv.org_id = m.org_id AND cv.id = m.conversation_id
          JOIN channels ch ON ch.org_id = cv.org_id AND ch.id = cv.channel_id
        WHERE m.org_id = ${orgId} AND ch.kind = 'instagram' AND m.created_at >= ${from}::timestamptz`)
    ).rows[0] as Raw;
    const dmsIn = n(m.dms_in);
    const dmsOut = n(m.dms_out);
    return {
      accountsCount: accounts.length,
      accounts: accounts.map((a) => ({
        handle: `@${String(a.username ?? a.name ?? '').replace(/^@/, '')}`,
        avatar: a.avatar ? String(a.avatar) : null,
        status: String(a.status),
      })),
      needsReply: n(c.needs_reply),
      open: n(c.open),
      unread: n(c.unread),
      dmsIn7d: dmsIn,
      dmsOut7d: dmsOut,
      replyRatePct: dmsIn > 0 ? Math.round(Math.min(100, (dmsOut / dmsIn) * 100)) : 0,
      followers: accounts.reduce((a, r) => a + n(r.followers), 0),
    };
  }

  /** WD-DASH-017: counters ignore range and engine; the list is the six most recently updated flows. */
  async flows(tx: Tx, orgId: number): Promise<DashWidgets['flows']> {
    const c = (
      await tx.execute(sql`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active)::int AS active,
               (SELECT count(*) FROM flow_subscribers s WHERE s.org_id = ${orgId})::int AS subscribers
        FROM flows WHERE org_id = ${orgId}`)
    ).rows[0] as Raw;
    const rows = await tx.execute(sql`
      SELECT f.uuid, f.flow_name, f.is_active, f.trigger_kind,
             CASE WHEN jsonb_typeof(f.flow_data -> 'flowNodes') = 'array'
                  THEN jsonb_array_length(f.flow_data -> 'flowNodes') ELSE 0 END AS steps,
             (SELECT count(*) FROM flow_subscribers s WHERE s.org_id = f.org_id AND s.flow_id = f.id)::int AS subs
      FROM flows f WHERE f.org_id = ${orgId} ORDER BY f.updated_at DESC, f.id DESC LIMIT 6`);
    return {
      total: n(c.total),
      active: n(c.active),
      subscribers: n(c.subscribers),
      recent: (rows.rows as Raw[]).map((r) => ({
        uuid: String(r.uuid),
        name: String(r.flow_name ?? '').trim() || 'Untitled flow',
        active: Boolean(r.is_active),
        trigger: String(r.trigger_kind || 'keyword'),
        steps: n(r.steps),
        subscribers: n(r.subs),
      })),
    };
  }

  /** WD-DASH-020, the rebuild requirement: per workspace, from the real connection tables (no cross-tenant webhook signal). */
  async integrations(tx: Tx, orgId: number, now: Date): Promise<DashWidgets['integrations']> {
    const from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const r = (
      await tx.execute(sql`
        SELECT
          EXISTS (SELECT 1 FROM woocommerce_integrations WHERE org_id = ${orgId} AND status = 'active') AS woo,
          (SELECT count(*) FROM woocommerce_integration_logs WHERE org_id = ${orgId} AND created_at >= ${from}::timestamptz)::int AS woo_events,
          EXISTS (SELECT 1 FROM shopify_integrations WHERE org_id = ${orgId} AND status = 'active') AS shopify,
          EXISTS (SELECT 1 FROM user_settings WHERE org_id = ${orgId} AND sheets_key_hash IS NOT NULL) AS sheets,
          EXISTS (SELECT 1 FROM wa_catalogs WHERE org_id = ${orgId}) AS meta,
          EXISTS (SELECT 1 FROM hubspot_integrations WHERE org_id = ${orgId} AND status = 'active') AS hubspot,
          EXISTS (SELECT 1 FROM slack_integrations WHERE org_id = ${orgId} AND status = 'active') AS slack,
          EXISTS (SELECT 1 FROM trello_integrations WHERE org_id = ${orgId} AND status = 'active') AS trello,
          EXISTS (SELECT 1 FROM webhooks WHERE org_id = ${orgId} AND status) AS webhooks,
          EXISTS (SELECT 1 FROM incoming_webhooks WHERE org_id = ${orgId} AND is_active) AS incoming,
          EXISTS (SELECT 1 FROM workspace_ig_accounts WHERE org_id = ${orgId}) AS instagram`)
    ).rows[0] as Raw;
    const flags = [
      'woo',
      'shopify',
      'sheets',
      'meta',
      'hubspot',
      'slack',
      'trello',
      'webhooks',
      'incoming',
      'instagram',
    ];
    return {
      connected: flags.filter((k) => r[k] === true).length,
      total: INTEGRATION_CATALOG_SIZE,
      rows: [
        { code: 'woocommerce', connected: r.woo === true, events7d: n(r.woo_events) },
        { code: 'shopify', connected: r.shopify === true, events7d: null },
        { code: 'google_sheets', connected: r.sheets === true, events7d: null },
        { code: 'meta_catalog', connected: r.meta === true, events7d: null },
      ],
    };
  }
}
