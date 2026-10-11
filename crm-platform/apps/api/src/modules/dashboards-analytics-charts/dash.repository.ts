import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { RawCounts } from './dash-metrics';

type Raw = Record<string, unknown>;

/**
 * The live aggregates behind the dashboard and analytics (TW-DASH-002). Reference kept two message stores; here they are one stream
 * (`messages`: conversations, broadcast mirrors, sends), so every count reads that one table. Row-level security already scopes it
 * to the caller's workspace; the explicit `org_id` is the index prefix. Nothing is cached and nothing is pre-aggregated.
 */
const DELIVERED = sql.raw(`status IN ('delivered','read','sent')`);
const READ = sql.raw(`(read_at IS NOT NULL OR status = 'read')`);

/** The message stream over [from, to). */
function stream(orgId: number, from: Date, to: Date): SQL {
  const f = from.toISOString();
  const t = to.toISOString();
  return sql`(
    SELECT created_at, direction, status, read_at, template_id, kind, conversation_id
      FROM messages WHERE org_id = ${orgId} AND kind <> 'reaction'
        AND created_at >= ${f}::timestamptz AND created_at < ${t}::timestamptz
  ) m`;
}

const n = (v: unknown): number => Number(v ?? 0);

@Injectable()
export class DashRepository {
  async orgTimezone(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT settings ->> 'timezone' AS tz FROM organizations WHERE id = ${orgId}`,
    );
    return ((res.rows[0] as Raw | undefined)?.tz as string | null | undefined) ?? null;
  }

  /**
   * Headline counts of one window. `contactsReplied` is a funnel stage, so it only counts conversations messaged in this window
   * (never above `contactsMessaged`); `repliers` is every conversation that wrote in, messaged or not.
   */
  async counts(tx: Tx, orgId: number, from: Date, to: Date): Promise<RawCounts> {
    const res = await tx.execute(sql`
      WITH s AS (SELECT * FROM ${stream(orgId, from, to)})
      SELECT
        count(*) FILTER (WHERE direction = 'out')::int AS sent,
        count(*) FILTER (WHERE direction = 'out' AND ${DELIVERED})::int AS delivered,
        count(*) FILTER (WHERE direction = 'out' AND status = 'failed')::int AS failed,
        count(*) FILTER (WHERE direction = 'out' AND ${READ})::int AS read,
        count(*) FILTER (WHERE direction = 'in')::int AS replies,
        count(DISTINCT conversation_id) FILTER (WHERE direction = 'in')::int AS repliers,
        count(DISTINCT conversation_id) FILTER (WHERE direction = 'out')::int AS contacts_messaged,
        count(DISTINCT conversation_id) FILTER (WHERE direction = 'out' AND ${DELIVERED})::int AS contacts_delivered,
        count(DISTINCT conversation_id) FILTER (
          WHERE direction = 'in'
            AND conversation_id IN (SELECT conversation_id FROM s WHERE direction = 'out')
        )::int AS contacts_replied
      FROM s`);
    const r = (res.rows[0] ?? {}) as Raw;
    return {
      contactsGoalCompleted: await this.goalCompleted(tx, orgId, from, to),
      sent: n(r.sent),
      delivered: n(r.delivered),
      failed: n(r.failed),
      read: n(r.read),
      replies: n(r.replies),
      repliers: n(r.repliers),
      contactsMessaged: n(r.contacts_messaged),
      contactsDelivered: n(r.contacts_delivered),
      contactsReplied: n(r.contacts_replied),
    };
  }

  /**
   * The Engagement funnel's "Goal completed" stage: distinct conversations (the contact proxy) with at least one flow run that
   * finished (`status = 'completed'`, i.e. the run reached its end; failed, cancelled, expired and still-live runs never count) with
   * `ended_at` inside [from, to). A run carries its own `conversation_id`; runs without one (no conversation yet) cannot be a
   * funnel contact and are skipped. Empty flow tables give 0.
   */
  async goalCompleted(tx: Tx, orgId: number, from: Date, to: Date): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(DISTINCT conversation_id)::int AS c FROM flow_runs
      WHERE org_id = ${orgId} AND status = 'completed' AND conversation_id IS NOT NULL
        AND ended_at >= ${from.toISOString()}::timestamptz AND ended_at < ${to.toISOString()}::timestamptz`);
    return n((res.rows[0] as Raw | undefined)?.c);
  }

  /** Outbound counts per whole hour back from `now`: index 0 is the hour just ended. Length `hours`. */
  async hourlyOut(tx: Tx, orgId: number, now: Date, hours: number): Promise<number[]> {
    const from = new Date(now.getTime() - hours * 3_600_000);
    const res = await tx.execute(sql`
      SELECT floor(extract(epoch FROM (${now.toISOString()}::timestamptz - created_at)) / 3600)::int AS h, count(*)::int AS c
      FROM ${stream(orgId, from, new Date(now.getTime() + 1))}
      WHERE direction = 'out' AND created_at <= ${now.toISOString()}::timestamptz
      GROUP BY 1`);
    const out = new Array<number>(hours).fill(0);
    for (const r of res.rows as Raw[]) {
      const h = n(r.h);
      if (h >= 0 && h < hours) out[h] = n(r.c);
    }
    return out;
  }

  /**
   * Outbound per bucket (sent, delivered, failed) over [from, to): `hour` buckets count from `from`; `day` buckets are the
   * workspace zone's calendar days counted from `fromDate`. Buckets with no rows are missing from the result.
   */
  async buckets(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
    kind: { bucket: 'hour' } | { bucket: 'day'; fromDate: string; tz: string },
  ): Promise<Map<number, { sent: number; delivered: number; failed: number }>> {
    const idx =
      kind.bucket === 'hour'
        ? sql`floor(extract(epoch FROM (created_at - ${from.toISOString()}::timestamptz)) / 3600)::int`
        : sql`((created_at AT TIME ZONE ${kind.tz})::date - ${kind.fromDate}::date)::int`;
    const res = await tx.execute(sql`
      SELECT ${idx} AS i,
        count(*)::int AS sent,
        count(*) FILTER (WHERE ${DELIVERED})::int AS delivered,
        count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM ${stream(orgId, from, to)} WHERE direction = 'out' GROUP BY 1`);
    return new Map(
      (res.rows as Raw[]).map((r) => [
        n(r.i),
        { sent: n(r.sent), delivered: n(r.delivered), failed: n(r.failed) },
      ]),
    );
  }

  /** Outbound by display type; template wins over media (TW-DASH-027 rule 7). */
  async types(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
  ): Promise<Array<{ key: string; count: number; delivered: number }>> {
    const res = await tx.execute(sql`
      SELECT CASE
          WHEN template_id IS NOT NULL OR kind = 'template' THEN 'template'
          WHEN kind IN ('image','video','audio','voice','document','sticker') THEN 'media'
          WHEN kind = 'location' THEN 'location'
          WHEN kind IN ('contact','interactive') THEN 'interactive'
          ELSE 'text' END AS k, count(*)::int AS c,
          count(*) FILTER (WHERE ${DELIVERED})::int AS d
      FROM ${stream(orgId, from, to)} WHERE direction = 'out' GROUP BY 1`);
    return (res.rows as Raw[]).map((r) => ({
      key: r.k as string,
      count: n(r.c),
      delivered: n(r.d),
    }));
  }

  /** Message volume by weekday (Sunday 0) and hour in the zone, both directions (TW-DASH-031). */
  async heatmap(tx: Tx, orgId: number, from: Date, to: Date, tz: string): Promise<number[][]> {
    const res = await tx.execute(sql`
      SELECT extract(dow FROM created_at AT TIME ZONE ${tz})::int AS d,
             extract(hour FROM created_at AT TIME ZONE ${tz})::int AS h, count(*)::int AS c
      FROM ${stream(orgId, from, to)} GROUP BY 1, 2`);
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const r of res.rows as Raw[]) grid[n(r.d)]![n(r.h)] = n(r.c);
    return grid;
  }
}
