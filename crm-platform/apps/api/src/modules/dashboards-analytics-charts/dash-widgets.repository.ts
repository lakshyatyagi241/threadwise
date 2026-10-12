import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DashWidgets } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { channelOwnerSql } from '../../realtime';

type Raw = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0);
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/** Reference's status vocabulary mapped onto the broadcast statuses this stack writes. */
export const RUNNING = ['processing', 'sending', 'running', 'active'];
export const SCHEDULED = ['scheduled', 'pending', 'queued'];
export const PAUSED = ['paused', 'failed', 'cancelled'];
const list = (a: string[]) =>
  sql.join(
    a.map((x) => sql`${x}`),
    sql`, `,
  );

/**
 * The reads behind the dashboard's data cards. Read-only; forced row-level security scopes every table to the caller's workspace, the
 * explicit `org_id` is the index prefix. Each method is one small aggregate so a card that fails cannot take the page down.
 */
@Injectable()
export class DashWidgetsRepository {
  async contacts(tx: Tx, orgId: number, from: Date): Promise<DashWidgets['contacts']> {
    const r = (
      await tx.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE NOT is_unsubscribed)::int AS subscribed,
               count(*) FILTER (WHERE is_unsubscribed)::int AS blocked,
               count(*) FILTER (WHERE created_at < ${from.toISOString()}::timestamptz)::int AS before
        FROM contacts WHERE org_id = ${orgId} AND NOT is_archived`)
    ).rows[0] as Raw;
    const total = n(r.total);
    const before = n(r.before);
    const delta = before > 0 ? ((total - before) / before) * 100 : total > 0 ? 100 : 0;
    return {
      total,
      subscribed: n(r.subscribed),
      blocked: n(r.blocked),
      deltaPct: Math.round(delta * 10) / 10,
    };
  }

  async campaigns(tx: Tx, orgId: number): Promise<DashWidgets['campaigns']> {
    const c = (
      await tx.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status IN (${list(RUNNING)}))::int AS running,
               count(*) FILTER (WHERE status IN (${list(SCHEDULED)}))::int AS scheduled,
               count(*) FILTER (WHERE status IN (${list(PAUSED)}))::int AS paused
        FROM broadcasts WHERE org_id = ${orgId} AND NOT archived`)
    ).rows[0] as Raw;
    const rows = await tx.execute(sql`
      SELECT b.uuid, b.name, b.status, b.success_count, b.total_recipients, t.template_name, t.category
      FROM broadcasts b LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id
      WHERE b.org_id = ${orgId} AND NOT b.archived ORDER BY b.updated_at DESC LIMIT 4`);
    return {
      running: n(c.running),
      scheduled: n(c.scheduled),
      paused: n(c.paused),
      total: n(c.total),
      recent: (rows.rows as Raw[]).map((r) => {
        const total = n(r.total_recipients);
        const done = n(r.success_count);
        return {
          uuid: String(r.uuid),
          name: s(r.name),
          status: String(r.status),
          template: s(r.template_name),
          category: s(r.category),
          done,
          total,
          pct: total > 0 ? Math.round((done / total) * 100) : 0,
        };
      }),
    };
  }

  async devices(tx: Tx, orgId: number): Promise<Omit<DashWidgets['devices'], 'slotCap'>> {
    const c = (
      await tx.execute(sql`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'connected' AND active)::int AS online
        FROM devices WHERE org_id = ${orgId}`)
    ).rows[0] as Raw;
    const rows = await tx.execute(sql`
      SELECT uuid, device_name, country_code, phone_number, region, status, active, sent_24h, failed_24h
      FROM devices WHERE org_id = ${orgId} ORDER BY active DESC, last_seen_at DESC NULLS LAST, id DESC LIMIT 4`);
    return {
      total: n(c.total),
      online: n(c.online),
      rows: (rows.rows as Raw[]).map((r) => {
        const sent = n(r.sent_24h);
        const phone = r.phone_number
          ? `+${s(r.country_code) ?? ''} ${r.phone_number}`.replace('+ ', '+')
          : null;
        return {
          uuid: String(r.uuid),
          label: s(r.device_name) ?? phone ?? 'Device',
          phone,
          region: s(r.region),
          state:
            r.status === 'connected' && r.active
              ? ('online' as const)
              : r.status === 'connecting'
                ? ('connecting' as const)
                : ('offline' as const),
          sent24h: sent,
          deliveryPct: Math.max(
            0,
            Math.round((1 - n(r.failed_24h) / Math.max(1, sent)) * 1000) / 10,
          ),
        };
      }),
    };
  }

  /** The five most recently edited templates with their sends in the window, then ordered by sends (Reference's rule, kept). */
  async templates(tx: Tx, orgId: number, from: Date, to: Date): Promise<DashWidgets['templates']> {
    const count = (
      await tx.execute(sql`SELECT count(*)::int AS n FROM wa_templates WHERE org_id = ${orgId}`)
    ).rows[0] as Raw;
    const res = await tx.execute(sql`
      SELECT t.uuid, t.template_name, t.language, t.category, t.template_type, t.status,
             count(m.id)::int AS sent,
             count(m.id) FILTER (WHERE m.status IN ('delivered', 'read', 'sent'))::int AS delivered,
             count(m.id) FILTER (WHERE m.read_at IS NOT NULL OR m.status = 'read')::int AS read
      FROM (SELECT * FROM wa_templates WHERE org_id = ${orgId} ORDER BY updated_at DESC LIMIT 5) t
      LEFT JOIN messages m ON m.org_id = t.org_id AND m.template_id = t.id AND m.direction = 'out'
        AND m.created_at >= ${from.toISOString()}::timestamptz AND m.created_at < ${to.toISOString()}::timestamptz
      GROUP BY t.uuid, t.template_name, t.language, t.category, t.template_type, t.status
      ORDER BY sent DESC, t.template_name`);
    return {
      count: n(count.n),
      rows: (res.rows as Raw[]).map((r) => {
        const sent = n(r.sent);
        const read = n(r.read);
        const delivered = n(r.delivered);
        return {
          uuid: String(r.uuid),
          name: String(r.template_name),
          language: s(r.language),
          category: s(r.category),
          type: s(r.template_type),
          status: String(r.status),
          sent,
          delivered,
          read,
          readRatePct: sent > 0 ? Math.round((read / sent) * 1000) / 10 : null,
          performance: sent > 0 ? Math.min(100, Math.round((delivered / sent) * 100)) : 0,
        };
      }),
    };
  }

  /** Unread is counted in chats, after the inbox's own filter (not archived), like the inbox rail. */
  async inbox(tx: Tx, orgId: number): Promise<DashWidgets['inbox']> {
    const c = (
      await tx.execute(sql`
        SELECT count(*)::int AS unread, min(c.last_message_at) AS oldest
        FROM conversations c WHERE c.org_id = ${orgId} AND NOT c.archived AND c.unread_count > 0 AND ${channelOwnerSql('c')} IS NULL`)
    ).rows[0] as Raw;
    const rows = await tx.execute(sql`
      SELECT c.uuid, coalesce(c.title, c.peer_name, '+' || c.peer_key) AS title, c.last_message_at, coalesce(c.preview, '') AS preview, c.unread_count
      FROM conversations c WHERE c.org_id = ${orgId} AND NOT c.archived AND ${channelOwnerSql('c')} IS NULL
      ORDER BY c.last_message_at DESC NULLS LAST LIMIT 3`);
    return {
      unread: n(c.unread),
      oldestUnreadAt: iso(c.oldest),
      recent: (rows.rows as Raw[]).map((r) => ({
        uuid: String(r.uuid),
        title: String(r.title),
        at: iso(r.last_message_at),
        preview: String(r.preview).slice(0, 60),
        unread: n(r.unread_count),
      })),
    };
  }

  async pipeline(
    tx: Tx,
    orgId: number,
    monthStart: Date,
  ): Promise<NonNullable<DashWidgets['pipeline']>> {
    const r = (
      await tx.execute(sql`
        SELECT coalesce((SELECT currency FROM pipelines WHERE org_id = ${orgId} ORDER BY is_default DESC, sort_order LIMIT 1), 'USD') AS currency,
               coalesce(sum(value_minor) FILTER (WHERE status = 'open'), 0)::text AS open_value,
               count(*) FILTER (WHERE status = 'open')::int AS open_deals,
               coalesce(sum(value_minor) FILTER (WHERE status = 'won' AND won_at >= ${monthStart.toISOString()}::timestamptz), 0)::text AS won_value,
               count(*) FILTER (WHERE status = 'won')::int AS won,
               count(*) FILTER (WHERE status = 'lost')::int AS lost
        FROM deals WHERE org_id = ${orgId}`)
    ).rows[0] as Raw;
    const closed = n(r.won) + n(r.lost);
    return {
      currency: String(r.currency),
      openValueMinor: String(r.open_value),
      openDeals: n(r.open_deals),
      wonThisMonthMinor: String(r.won_value),
      winRatePct: closed > 0 ? Math.round((n(r.won) / closed) * 100) : 0,
    };
  }

  async activity(tx: Tx, orgId: number): Promise<DashWidgets['activity']> {
    const rows = await tx.execute(sql`
      SELECT a.at, u.full_name AS actor, a.module, a.action
      FROM audit_log a LEFT JOIN users u ON a.actor_type = 'user' AND u.org_id = a.org_id AND u.id = a.actor_id
      WHERE a.org_id = ${orgId} ORDER BY a.at DESC LIMIT 8`);
    return (rows.rows as Raw[]).map((r) => ({
      at: new Date(r.at as string).toISOString(),
      actor: s(r.actor),
      module: String(r.module),
      action: String(r.action),
    }));
  }
}
