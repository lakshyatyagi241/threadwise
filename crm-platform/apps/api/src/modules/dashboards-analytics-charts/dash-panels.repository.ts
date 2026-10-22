import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AnalyticsPanels } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { parseUserAgent, type ParsedAgent } from '../auth';
import { channelOwnerSql } from '../../realtime';
import { countryOfPhone } from './platform-rules';

type Raw = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0);
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);

/** Reads behind the analytics list panels; read-only, scoped by forced RLS and an explicit `org_id`. */
@Injectable()
export class DashPanelsRepository {
  /** Senders, busiest first by their 24-hour counter (messages carry no sender device, so the counter the bridge keeps is the source). */
  async devices(tx: Tx, orgId: number): Promise<AnalyticsPanels['devices']> {
    const c = (
      await tx.execute(sql`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'connected' AND active)::int AS online
        FROM devices WHERE org_id = ${orgId}`)
    ).rows[0] as Raw;
    const rows = await tx.execute(sql`
      SELECT uuid, device_name, country_code, phone_number, sent_24h, status, active
      FROM devices WHERE org_id = ${orgId} ORDER BY sent_24h DESC, active DESC, id DESC LIMIT 8`);
    return {
      total: n(c.total),
      online: n(c.online),
      rows: (rows.rows as Raw[]).map((r) => ({
        uuid: String(r.uuid),
        label: `${String(r.device_name)} · +${s(r.country_code) ?? ''} ${String(r.phone_number ?? '').slice(0, 4)}xx`,
        sent: n(r.sent_24h),
        online: r.status === 'connected' && r.active === true,
      })),
    };
  }

  /**
   * Login devices: `auth_sessions` of the workspace started in the window, bucketed by the browser, operating system and kind
   * parsed from the user agent. The raw agent string is grouped and parsed here and never returned; the IP is not read at all.
   */
  async loginDevices(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
  ): Promise<AnalyticsPanels['loginDevices']> {
    const live = (
      await tx.execute(sql`
        SELECT count(*)::int AS n FROM auth_sessions
        WHERE org_id = ${orgId} AND revoked_at IS NULL AND expires_at > now()`)
    ).rows[0] as Raw;
    const res = await tx.execute(sql`
      SELECT user_agent, count(*)::int AS total,
             count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::int AS active
      FROM auth_sessions
      WHERE org_id = ${orgId}
        AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz
      GROUP BY user_agent`);
    type Bucket = { count: number; active: number };
    const browser = new Map<string, Bucket>();
    const os = new Map<string, Bucket>();
    const kind = new Map<string, Bucket>();
    let total = 0;
    const add = (m: Map<string, Bucket>, key: string, count: number, active: number) => {
      const b = m.get(key) ?? { count: 0, active: 0 };
      b.count += count;
      b.active += active;
      m.set(key, b);
    };
    for (const r of res.rows as Raw[]) {
      const p = parseUserAgent(s(r.user_agent));
      const count = n(r.total);
      const active = n(r.active);
      total += count;
      add(browser, p.browser, count, active);
      add(os, p.os, count, active);
      add(kind, p.kind, count, active);
    }
    const rows = <K extends string>(m: Map<string, Bucket>) =>
      [...m.entries()]
        .map(([key, b]) => ({ key: key as K, ...b }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    return {
      active: n(live.n),
      total,
      byBrowser: rows<ParsedAgent['browser']>(browser),
      byOs: rows<ParsedAgent['os']>(os),
      byKind: rows<ParsedAgent['kind']>(kind),
    };
  }

  async templates(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
  ): Promise<AnalyticsPanels['templates']> {
    // The eight busiest in the window: every template is ranked by its sends, so an older template that sent is listed too.
    const res = await tx.execute(sql`
      WITH counts AS (
        SELECT m.template_id, count(m.id)::int AS sends
        FROM messages m
        WHERE m.org_id = ${orgId} AND m.direction = 'out' AND m.template_id IS NOT NULL
          AND m.created_at >= ${from.toISOString()}::timestamptz AND m.created_at < ${to.toISOString()}::timestamptz
        GROUP BY m.template_id
      )
      SELECT t.uuid, t.template_name, t.category, t.language, coalesce(c.sends, 0) AS sends
      FROM wa_templates t
      LEFT JOIN counts c ON c.template_id = t.id
      WHERE t.org_id = ${orgId}
      ORDER BY sends DESC, t.updated_at DESC, t.template_name
      LIMIT 8`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: String(r.uuid),
      name: String(r.template_name),
      category: s(r.category),
      language: s(r.language),
      sends: n(r.sends),
    }));
  }

  /** A true top five over every conversation (Reference scanned only the 20 most recent). */
  async contacts(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
  ): Promise<AnalyticsPanels['contacts']> {
    const res = await tx.execute(sql`
      SELECT c.uuid, coalesce(c.title, c.peer_name, '+' || c.peer_key) AS title, c.peer_key, c.last_message_at, count(m.id)::int AS messages
      FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      WHERE m.org_id = ${orgId} AND ${channelOwnerSql('c')} IS NULL
        AND m.created_at >= ${from.toISOString()}::timestamptz AND m.created_at < ${to.toISOString()}::timestamptz
      GROUP BY c.uuid, c.title, c.peer_name, c.peer_key, c.last_message_at
      ORDER BY messages DESC, c.last_message_at DESC NULLS LAST LIMIT 5`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: String(r.uuid),
      title: String(r.title),
      phone: s(r.peer_key),
      lastAt: r.last_message_at ? new Date(r.last_message_at as string).toISOString() : null,
      messages: n(r.messages),
    }));
  }

  /** Conversations created in the window, credited to the current assignee (Reference's rule); minutes are raw wall-clock. */
  async team(tx: Tx, orgId: number, from: Date, to: Date): Promise<AnalyticsPanels['team']> {
    const res = await tx.execute(sql`
      WITH conv AS (
        SELECT id, assignee_user_id,
               CASE WHEN first_response_at >= created_at THEN extract(epoch FROM (first_response_at - created_at)) / 60 END AS first_min,
               CASE WHEN resolved_at >= created_at THEN extract(epoch FROM (resolved_at - created_at)) / 60 END AS resolution_min,
               resolved_at
        FROM conversations
        WHERE org_id = ${orgId} AND assignee_user_id IS NOT NULL
          AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz),
      last_csat AS (
        SELECT DISTINCT ON (conversation_id) conversation_id, rating FROM csat_responses
        WHERE org_id = ${orgId} AND rating IS NOT NULL ORDER BY conversation_id, coalesce(responded_at, created_at) DESC, id DESC)
      SELECT u.uuid, u.full_name, u.email::text AS email, count(*)::int AS conversations,
             count(conv.resolved_at)::int AS resolved,
             avg(conv.first_min) AS first_min, avg(conv.resolution_min) AS resolution_min,
             avg(cs.rating) AS csat_avg, count(cs.rating)::int AS csat_count
      FROM conv JOIN users u ON u.org_id = ${orgId} AND u.id = conv.assignee_user_id
      LEFT JOIN last_csat cs ON cs.conversation_id = conv.id
      GROUP BY u.uuid, u.full_name, u.email ORDER BY conversations DESC, u.full_name`);
    return (res.rows as Raw[]).map((r) => ({
      userUuid: String(r.uuid),
      name: String(r.full_name),
      email: String(r.email),
      conversations: n(r.conversations),
      resolved: n(r.resolved),
      avgFirstResponseMin: round1(num(r.first_min)),
      avgResolutionMin: round1(num(r.resolution_min)),
      csatAvg: num(r.csat_avg) === null ? null : Math.round(Number(r.csat_avg) * 100) / 100,
      csatCount: n(r.csat_count),
    }));
  }

  /**
   * TW-DASH-029 geography: conversations that saw a message in the window, by the country of the contact's number (Reference bucketed
   * device regions by a counter that was always 0). Top 7; a number that is not a phone number, or has no known prefix, is "Unspecified" (null).
   */
  async geo(tx: Tx, orgId: number, from: Date, to: Date): Promise<AnalyticsPanels['geo']> {
    const res = await tx.execute(sql`
      SELECT CASE WHEN c.peer_key ~ '^[+]?[0-9]{7,15}$' THEN left(regexp_replace(c.peer_key, '[^0-9]', '', 'g'), 3) END AS prefix,
             length(regexp_replace(c.peer_key, '[^0-9]', '', 'g')) AS len, count(*)::int AS n
      FROM conversations c
      WHERE c.org_id = ${orgId} AND EXISTS (
        SELECT 1 FROM messages m WHERE m.org_id = c.org_id AND m.conversation_id = c.id
          AND m.created_at >= ${from.toISOString()}::timestamptz AND m.created_at < ${to.toISOString()}::timestamptz)
      GROUP BY 1, 2`);
    const by = new Map<string | null, number>();
    for (const r of res.rows as Raw[]) {
      const digits = r.prefix === null ? null : String(r.prefix).padEnd(Number(r.len), '0');
      const code = digits === null ? null : countryOfPhone(digits);
      by.set(code, (by.get(code) ?? 0) + n(r.n));
    }
    return [...by.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)))
      .slice(0, 7);
  }

  /** TW-DASH-029 event stream: the six newest messages of the window, both directions, with the conversation's own number (Reference showed the workspace's number for inbound rows). */
  async events(tx: Tx, orgId: number, from: Date, to: Date): Promise<AnalyticsPanels['events']> {
    const res = await tx.execute(sql`
      SELECT m.uuid, m.direction, m.kind, m.status, m.created_at, c.peer_key, coalesce(c.title, c.peer_name) AS name
      FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      WHERE m.org_id = ${orgId} AND m.deleted_at IS NULL AND ${channelOwnerSql('c')} IS NULL
        AND m.created_at >= ${from.toISOString()}::timestamptz AND m.created_at < ${to.toISOString()}::timestamptz
      ORDER BY m.created_at DESC, m.id DESC LIMIT 6`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: String(r.uuid),
      direction: r.direction === 'in' ? ('in' as const) : ('out' as const),
      peer: s(r.peer_key) ?? s(r.name) ?? '',
      kind: String(r.kind),
      status: String(r.status),
      at: new Date(r.created_at as string).toISOString(),
    }));
  }

  /** TW-DASH-032: campaigns, broadcasts and contacts created in the window (the export's headline counts). */
  async created(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
  ): Promise<{ campaigns: number; broadcasts: number; contacts: number }> {
    const f = from.toISOString();
    const t = to.toISOString();
    const r = (
      await tx.execute(sql`
        SELECT (SELECT count(*) FROM wpcampaigns WHERE org_id = ${orgId} AND created_at >= ${f}::timestamptz AND created_at < ${t}::timestamptz)::int AS campaigns,
               (SELECT count(*) FROM broadcasts WHERE org_id = ${orgId} AND created_at >= ${f}::timestamptz AND created_at < ${t}::timestamptz)::int AS broadcasts,
               (SELECT count(*) FROM contacts WHERE org_id = ${orgId} AND created_at >= ${f}::timestamptz AND created_at < ${t}::timestamptz)::int AS contacts`)
    ).rows[0] as Raw;
    return { campaigns: n(r.campaigns), broadcasts: n(r.broadcasts), contacts: n(r.contacts) };
  }
}
