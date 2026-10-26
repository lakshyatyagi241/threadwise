import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { RawCounts } from './dash-metrics';
import type { BreakdownRow } from './dash-breakdown';

type Raw = Record<string, unknown>;

/**
 * The live aggregates behind the dashboard and analytics (TW-DASH-002). Reference kept two message stores; here they are one stream
 * (`messages`: conversations, broadcast mirrors, sends), so every count reads that one table. Row-level security already scopes it
 * to the caller's workspace; the explicit `org_id` is the index prefix. Nothing is cached and nothing is pre-aggregated.
 */
/**
 * Delivered is Reference's delivered set (TW-DASH-002 rule 3): status delivered, read or sent, or a delivery / read time was recorded.
 * A message that is only `sent` counts as delivered, as in Reference. A migrated message carries no receipt (the chat history has
 * none; chat-delivery finds no billing-log match), so all migrated outbound history reads `sent`: without this its delivered rate is 0.
 */
export const DELIVERED = sql.raw(
  `(status IN ('delivered','read','sent') OR delivered_at IS NOT NULL OR read_at IS NOT NULL)`,
);
export const READ = sql.raw(`(read_at IS NOT NULL OR status = 'read')`);
/** Failed: the status says so, or a failure reason was recorded and nothing was ever delivered or read. */
const FAILED = sql.raw(
  `(status IN ('failed','undelivered') OR (failure_reason IS NOT NULL AND delivered_at IS NULL AND read_at IS NULL AND status NOT IN ('delivered','read')))`,
);

/** The message stream over [from, to). */
function stream(orgId: number, from: Date, to: Date): SQL {
  const f = from.toISOString();
  const t = to.toISOString();
  return sql`(
    SELECT created_at, direction, status, delivered_at, read_at, failure_reason, template_id, kind, conversation_id
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

  /** Headline counts of one window: `countsMany` with a single window. */
  async counts(tx: Tx, orgId: number, from: Date, to: Date): Promise<RawCounts> {
    return (await this.countsMany(tx, orgId, [{ from, to }]))[0]!;
  }

  /**
   * Headline counts of several windows in one statement, in the order given (a window with no messages gives zeros).
   * `contactsReplied` is a funnel stage, so it only counts conversations messaged in this window (never above `contactsMessaged`);
   * `repliers` is every conversation that wrote in, messaged or not.
   */
  async countsMany(
    tx: Tx,
    orgId: number,
    windows: ReadonlyArray<{ from: Date; to: Date }>,
  ): Promise<RawCounts[]> {
    if (windows.length === 0) return [];
    // One pass over the messages of every window together, counted per conversation; the headline numbers are then sums and counts of
    // those rows. The distinct counts and the "conversation also has an outbound message" test are plain per-conversation flags this way,
    // instead of a DISTINCT sort per filter and a sub-select per row (280 ms to 99 ms on 90,000 messages, same result). Each window is a
    // set of FILTER columns over one range scan with fixed bounds, so partitions are pruned and the index range is used. (Joining the
    // windows as a VALUES list instead made Postgres read the workspace's whole history once per window.)
    const f = (i: number) => {
      const w = windows[i]!;
      return sql`(created_at >= ${w.from.toISOString()}::timestamptz AND created_at < ${w.to.toISOString()}::timestamptz)`;
    };
    const perWindow = windows.map(
      (_, i) => sql`
          count(*) FILTER (WHERE ${f(i)} AND direction = 'out') AS ${sql.identifier(`sent${i}`)},
          count(*) FILTER (WHERE ${f(i)} AND direction = 'out' AND ${DELIVERED}) AS ${sql.identifier(`delivered${i}`)},
          count(*) FILTER (WHERE ${f(i)} AND direction = 'out' AND ${FAILED}) AS ${sql.identifier(`failed${i}`)},
          count(*) FILTER (WHERE ${f(i)} AND direction = 'out' AND ${READ}) AS ${sql.identifier(`read${i}`)},
          count(*) FILTER (WHERE ${f(i)} AND direction = 'in') AS ${sql.identifier(`replies${i}`)}`,
    );
    const sums = windows.map((_, i) => {
      const c = (k: string) => sql.identifier(`${k}${i}`);
      return sql`
        SELECT ${i}::int AS w_i,
          coalesce(sum(${c('sent')}), 0)::int AS sent,
          coalesce(sum(${c('delivered')}), 0)::int AS delivered,
          coalesce(sum(${c('failed')}), 0)::int AS failed,
          coalesce(sum(${c('read')}), 0)::int AS read,
          coalesce(sum(${c('replies')}), 0)::int AS replies,
          count(*) FILTER (WHERE ${c('replies')} > 0)::int AS repliers,
          count(*) FILTER (WHERE ${c('sent')} > 0)::int AS contacts_messaged,
          count(*) FILTER (WHERE ${c('delivered')} > 0)::int AS contacts_delivered,
          count(*) FILTER (WHERE ${c('replies')} > 0 AND ${c('sent')} > 0)::int AS contacts_replied
        FROM per`;
    });
    const lo = new Date(Math.min(...windows.map((w) => w.from.getTime())));
    const hi = new Date(Math.max(...windows.map((w) => w.to.getTime())));
    const res = await tx.execute(sql`
      WITH per AS (
        SELECT conversation_id, ${sql.join(perWindow, sql`, `)}
        FROM ${stream(orgId, lo, hi)}
        GROUP BY conversation_id)
      ${sql.join(sums, sql` UNION ALL `)}`);
    const byWindow = new Map((res.rows as Raw[]).map((r) => [n(r.w_i), r]));
    const out: RawCounts[] = [];
    for (const [i, w] of windows.entries()) {
      const r = byWindow.get(i) ?? {};
      out.push({
        contactsGoalCompleted: await this.goalCompleted(tx, orgId, w.from, w.to),
        sent: n(r.sent),
        delivered: n(r.delivered),
        failed: n(r.failed),
        read: n(r.read),
        replies: n(r.replies),
        repliers: n(r.repliers),
        contactsMessaged: n(r.contacts_messaged),
        contactsDelivered: n(r.contacts_delivered),
        contactsReplied: n(r.contacts_replied),
      });
    }
    return out;
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
        count(*) FILTER (WHERE ${FAILED})::int AS failed
      FROM ${stream(orgId, from, to)} WHERE direction = 'out' GROUP BY 1`);
    return new Map(
      (res.rows as Raw[]).map((r) => [
        n(r.i),
        { sent: n(r.sent), delivered: n(r.delivered), failed: n(r.failed) },
      ]),
    );
  }

  /**
   * Conversations with activity in [from, to) (a message, or a resolve / close in the window), split open / resolved / closed and
   * assigned / unassigned (a person, a team or an AI agent holds it). Resolving does not touch the last message, so a chat resolved
   * today counts as resolved today even when its last message is older. Archived chats are left out, as the inbox does.
   */
  async conversationStates(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
  ): Promise<{
    total: number;
    open: number;
    resolved: number;
    closed: number;
    assigned: number;
    unassigned: number;
  }> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
        count(*) FILTER (WHERE status = 'closed')::int AS closed,
        count(*) FILTER (
          WHERE assignee_user_id IS NOT NULL OR assignee_team_id IS NOT NULL OR assignee_agent_id IS NOT NULL
        )::int AS assigned
      FROM conversations
      WHERE org_id = ${orgId} AND NOT archived
        AND (
          (last_message_at >= ${from.toISOString()}::timestamptz AND last_message_at < ${to.toISOString()}::timestamptz)
          OR (resolved_at >= ${from.toISOString()}::timestamptz AND resolved_at < ${to.toISOString()}::timestamptz)
        )`);
    const r = (res.rows[0] ?? {}) as Raw;
    const total = n(r.total);
    const resolved = n(r.resolved);
    const closed = n(r.closed);
    return {
      total,
      open: total - resolved - closed,
      resolved,
      closed,
      assigned: n(r.assigned),
      unassigned: total - n(r.assigned),
    };
  }

  /**
   * The window's messages grouped once by local day, weekday, hour, direction and display type (template wins over media,
   * TW-DASH-027 rule 7), each with its delivered and failed counts. The overview's daily series, type mix and weekday-by-hour heatmap
   * are all sums of these few hundred rows (`foldBreakdown`), so they cost one pass over the messages, not three.
   */
  async breakdown(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
    kind: { fromDate: string; tz: string },
  ): Promise<BreakdownRow[]> {
    const res = await tx.execute(sql`
      SELECT ((created_at AT TIME ZONE ${kind.tz})::date - ${kind.fromDate}::date)::int AS d,
        extract(dow FROM created_at AT TIME ZONE ${kind.tz})::int AS dow,
        extract(hour FROM created_at AT TIME ZONE ${kind.tz})::int AS h,
        direction,
        CASE
          WHEN template_id IS NOT NULL OR kind = 'template' THEN 'template'
          WHEN kind IN ('image','video','audio','voice','document','sticker') THEN 'media'
          WHEN kind = 'location' THEN 'location'
          WHEN kind IN ('contact','interactive') THEN 'interactive'
          ELSE 'text' END AS k,
        count(*)::int AS c,
        count(*) FILTER (WHERE ${DELIVERED})::int AS delivered,
        count(*) FILTER (WHERE ${FAILED})::int AS failed
      FROM ${stream(orgId, from, to)} GROUP BY 1, 2, 3, 4, 5`);
    return (res.rows as Raw[]).map((r) => ({
      day: n(r.d),
      dow: n(r.dow),
      hour: n(r.h),
      direction: String(r.direction),
      type: String(r.k),
      count: n(r.c),
      delivered: n(r.delivered),
      failed: n(r.failed),
    }));
  }
}
