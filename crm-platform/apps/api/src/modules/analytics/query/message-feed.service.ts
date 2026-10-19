import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { METRIC, MESSAGE_STATUS_CODE, feedType, type MessageStatusName } from '@crm/contracts';
import type { Tx } from '@crm/db';

/**
 * The Message History's message counts from the rollups (docs/superpowers/specs/2026-10-19-message-count-rollup-design.md).
 *
 * A window `[from, to)` is read in four pieces and stitched, all in the workspace's timezone (the zone the worker buckets in):
 *   1. whole local days inside it: `an_rollup_day`;
 *   2. the whole hours around those days: `an_rollup_hour`;
 *   3. the events recorded since the worker's watermark (not rolled up yet) whose message was created in the whole-hour part;
 *   4. the partial hours at the two ends, straight from `messages` (an index range scan of at most two hours).
 * Rollup rows of both sources are read: MSG_FEED (messages created after the cut-over, from events) and MSG_FEED_BASE (before it, rebuilt from
 * `messages`). Every row counts messages by the creation time and by the status they have NOW, so the totals equal what a scan of `messages` gives.
 */

// `pg_timezone_names` is a view that reads the zone files: 30 ms a call, and the zone of a workspace almost never changes.
const TZ_TTL_MS = 60_000;
const tzCache = new Map<number, { tz: string; until: number }>();

/** The workspace's timezone as the rollup worker resolves it: its setting if Postgres knows the zone, else UTC. */
export async function orgTimezone(tx: Tx, orgId: number): Promise<string> {
  const hit = tzCache.get(orgId);
  if (hit && hit.until > Date.now()) return hit.tz;
  const r = await tx.execute(
    sql`SELECT COALESCE((SELECT z.name FROM workspace_settings ws JOIN pg_timezone_names z ON z.name = ws.timezone WHERE ws.org_id = ${orgId}), 'UTC') AS tz`,
  );
  const tz = String((r.rows[0] as { tz: string }).tz);
  tzCache.set(orgId, { tz, until: Date.now() + TZ_TTL_MS });
  return tz;
}

export interface FeedWindow {
  orgId: number;
  from: Date;
  to: Date;
  /** `orgTimezone()` of the workspace: the zone must be the one the buckets were written in. */
  tz: string;
}

/** The boundaries of the pieces, as a CTE named `w` with one row: f, t (the window), h0, h1 (whole hours), d0, d1 (whole local days). */
function windowCte(w: FeedWindow): SQL {
  const from = w.from.toISOString();
  const to = w.to.toISOString();
  return sql`
    w AS (
      SELECT *, (h0 < h1) AS has_hours, (h0 < h1 AND d0 < d1) AS has_days FROM (
        SELECT *,
          CASE WHEN (date_trunc('day', h0 AT TIME ZONE z) AT TIME ZONE z) = h0 THEN h0
               ELSE (date_trunc('day', h0 AT TIME ZONE z) + interval '1 day') AT TIME ZONE z END AS d0,
          (date_trunc('day', h1 AT TIME ZONE z) AT TIME ZONE z) AS d1
        FROM (
          SELECT f, t, z,
            CASE WHEN (date_trunc('hour', f AT TIME ZONE z) AT TIME ZONE z) = f THEN f
                 ELSE (date_trunc('hour', f AT TIME ZONE z) + interval '1 hour') AT TIME ZONE z END AS h0,
            (date_trunc('hour', t AT TIME ZONE z) AT TIME ZONE z) AS h1
          FROM (SELECT ${from}::timestamptz AS f, ${to}::timestamptz AS t, ${w.tz}::text AS z) p) h) d)`;
}

/** The rollup hour rows of the whole-hour part that the day tier does not cover (`r` is the table alias). */
const HOURS_NOT_IN_DAYS = sql`((w.has_days AND ((r.bucket >= w.h0 AND r.bucket < w.d0) OR (r.bucket >= w.d1 AND r.bucket < w.h1)))
              OR (NOT w.has_days AND r.bucket >= w.h0 AND r.bucket < w.h1))`;

/**
 * `WITH`-able CTEs `w` and `points`: rows `(ts, d1 status, d2 channel, d3 feed class, n)` for every message of the window, as counts. `ts` is the
 * creation time for the edge pieces and the start of the bucket for rollup rows, so a caller can group by any coarser time. `n` may be negative
 * inside a piece (an event that leaves a status) but every group a caller reads sums to a real count.
 */
export function feedPointsSql(w: FeedWindow): SQL {
  const org = w.orgId;
  const metrics = sql`(${METRIC.MSG_FEED}, ${METRIC.MSG_FEED_BASE})`;
  const packed = (src: SQL, kind: SQL) =>
    sql`(coalesce(${src}, 0) * 16 + coalesce(${kind}, 0))::bigint`;
  const watermark = sql`(SELECT recorded_before FROM an_rollup_state WHERE name = 'main')`;
  // The messages of one edge range straight from `messages`, one range per branch: in a single OR the planner would also scan the whole
  // window for the "no whole hours" case (700,000 rows read for 400 kept, 350 ms on 1M messages).
  const edge = (when: string, lo: string, hi: string) => sql`
      SELECT m.created_at, an_msg_status_code(m.status)::bigint, coalesce(c.channel_id, 0),
             ${packed(sql`an_msg_source_kind(m.direction, m.meta, m.sender_agent_id, m.sender_kind)`, sql`an_msg_kind_class(m.kind)`)}, 1::bigint
        FROM w, messages m LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
       WHERE ${sql.raw(when)} AND m.org_id = ${org} AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id)
         AND m.created_at >= ${sql.raw(lo)} AND m.created_at < ${sql.raw(hi)}`;
  return sql`${windowCte(w)},
    points AS (
      SELECT (r.bucket::timestamp AT TIME ZONE w.z) AS ts, r.d1, r.d2, r.d3, r.n
        FROM w, an_rollup_day r
       WHERE w.has_days AND r.org_id = ${org} AND r.metric IN ${metrics}
         AND r.bucket >= (w.d0 AT TIME ZONE w.z)::date AND r.bucket < (w.d1 AT TIME ZONE w.z)::date
      UNION ALL
      SELECT r.bucket, r.d1, r.d2, r.d3, r.n
        FROM w, an_rollup_hour r
       WHERE w.has_hours AND r.org_id = ${org} AND r.metric IN ${metrics} AND ${HOURS_NOT_IN_DAYS}
      UNION ALL
      SELECT e.occurred_at, e.status::bigint, coalesce(e.channel_id, 0), ${packed(sql`e.source_kind`, sql`e.k1`)}, e.qty::bigint
        FROM w, an_events e
       WHERE w.has_hours AND e.org_id = ${org} AND e.type = 7 AND e.occurred_at >= an_msg_feed_cutover()
         AND e.recorded_at >= ${watermark} AND e.occurred_at >= w.h0 AND e.occurred_at < w.h1
      UNION ALL
      SELECT e.occurred_at, e.k2::bigint, coalesce(e.channel_id, 0), ${packed(sql`e.source_kind`, sql`e.k1`)}, -e.qty::bigint
        FROM w, an_events e
       WHERE w.has_hours AND e.org_id = ${org} AND e.type = 7 AND e.k2 IS NOT NULL AND e.occurred_at >= an_msg_feed_cutover()
         AND e.recorded_at >= ${watermark} AND e.occurred_at >= w.h0 AND e.occurred_at < w.h1
      UNION ALL
      ${edge('w.has_hours', 'w.f', 'w.h0')}
      UNION ALL
      ${edge('w.has_hours', 'w.h1', 'w.t')}
      UNION ALL
      ${edge('NOT w.has_hours', 'w.f', 'w.t')})`;
}

/** What the History's filters mean on the rollup's dimensions. A filter the rollup cannot answer is the caller's reason to read `messages`. */
export interface FeedFilter {
  /** Channel ids the viewer may not see (a personal mailbox that is not theirs). */
  hiddenChannelIds?: readonly number[];
  channelId?: number;
  dir?: 'in' | 'out' | 'fail';
  status?: MessageStatusName;
  /** `SOURCE_KIND` codes. */
  sources?: readonly number[];
  /** Feed classes (`packFeedClass`) the type filter allows. */
  feedClasses?: readonly number[];
}

const ints = (xs: readonly number[]): SQL => {
  for (const x of xs) {
    if (!Number.isSafeInteger(x)) throw new RangeError('feed filter: not an integer');
  }
  return sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );
};

/** The filter as a condition on the alias `p` of `points`. */
export function feedFilterSql(f: FeedFilter): SQL {
  const c: SQL[] = [];
  if (f.hiddenChannelIds && f.hiddenChannelIds.length > 0) {
    c.push(sql`p.d2 NOT IN (${ints(f.hiddenChannelIds)})`);
  }
  if (f.channelId !== undefined) c.push(sql`p.d2 = ${f.channelId}`);
  const received = MESSAGE_STATUS_CODE.received;
  if (f.dir === 'out') c.push(sql`p.d1 <> ${received}`);
  if (f.dir === 'in') c.push(sql`p.d1 = ${received}`);
  if (f.dir === 'fail') c.push(sql`p.d1 = ${MESSAGE_STATUS_CODE.failed}`);
  if (f.status) c.push(sql`p.d1 = ${MESSAGE_STATUS_CODE[f.status]} AND p.d1 <> ${received}`);
  if (f.sources)
    c.push(f.sources.length > 0 ? sql`(p.d3 / 16) IN (${ints(f.sources)})` : sql`FALSE`);
  if (f.feedClasses) {
    c.push(f.feedClasses.length > 0 ? sql`p.d3 IN (${ints(f.feedClasses)})` : sql`FALSE`);
  }
  return c.length > 0 ? sql.join(c, sql` AND `) : sql`TRUE`;
}

export interface FeedCounts {
  /** Messages by status code (see `MESSAGE_STATUS_CODE`). */
  byStatus: Map<number, number>;
}

/** The first-reply count and the total reply time of the whole hours of a window, for the average first-response time (decision D9). */
export function feedRepliesSql(
  w: FeedWindow,
  channel: { hidden?: readonly number[]; channelId?: number },
): SQL {
  const org = w.orgId;
  const cond: SQL[] = [];
  if (channel.hidden && channel.hidden.length > 0)
    cond.push(sql`p.d1 NOT IN (${ints(channel.hidden)})`);
  if (channel.channelId !== undefined) cond.push(sql`p.d1 = ${channel.channelId}`);
  const where = cond.length > 0 ? sql.join(cond, sql` AND `) : sql`TRUE`;
  const metrics = sql`(${METRIC.CONV_REPLY_BY_CHANNEL}, ${METRIC.CONV_REPLY_BASE})`;
  return sql`
    WITH ${windowCte(w)},
    p AS (
      SELECT r.d1, r.n, r.s1 FROM w, an_rollup_day r
       WHERE w.has_days AND r.org_id = ${org} AND r.metric IN ${metrics}
         AND r.bucket >= (w.d0 AT TIME ZONE w.z)::date AND r.bucket < (w.d1 AT TIME ZONE w.z)::date
      UNION ALL
      SELECT r.d1, r.n, r.s1 FROM w, an_rollup_hour r
       WHERE w.has_hours AND r.org_id = ${org} AND r.metric IN ${metrics} AND ${HOURS_NOT_IN_DAYS}
      UNION ALL
      SELECT coalesce(e.channel_id, 0), 1::bigint, coalesce(e.duration_ms, 0)::bigint
        FROM w, an_events e
       WHERE w.has_hours AND e.org_id = ${org} AND e.type = 42
         AND e.recorded_at >= (SELECT recorded_before FROM an_rollup_state WHERE name = 'main')
         AND e.occurred_at >= w.h0 AND e.occurred_at < w.h1)
    SELECT coalesce(sum(n), 0)::bigint AS n, coalesce(sum(s1), 0)::bigint AS ms FROM p WHERE ${where}`;
}

@Injectable()
export class MessageFeedService {
  /** Messages of the window by status. */
  async counts(tx: Tx, w: FeedWindow, filter: FeedFilter = {}): Promise<FeedCounts> {
    const res = await tx.execute(sql`
      WITH ${feedPointsSql(w)}
      SELECT p.d1::int AS status, sum(p.n)::bigint AS n FROM points p WHERE ${feedFilterSql(filter)} GROUP BY p.d1`);
    const byStatus = new Map<number, number>();
    for (const r of res.rows as Array<{ status: number; n: string | number }>) {
      byStatus.set(Number(r.status), Number(r.n));
    }
    return { byStatus };
  }

  /** Messages of the window by the History's type, for the type mix. */
  async byType(tx: Tx, w: FeedWindow, filter: FeedFilter = {}): Promise<Map<string, number>> {
    const res = await tx.execute(sql`
      WITH ${feedPointsSql(w)}
      SELECT p.d3::int AS fc, sum(p.n)::bigint AS n FROM points p WHERE ${feedFilterSql(filter)} GROUP BY p.d3`);
    const out = new Map<string, number>();
    for (const r of res.rows as Array<{ fc: number; n: string | number }>) {
      const type = feedType(Number(r.fc));
      out.set(type, (out.get(type) ?? 0) + Number(r.n));
    }
    return out;
  }

  /**
   * The volume per bucket (every bucket of the series, empty ones included). `unit` buckets are in the workspace zone, so the caller must only
   * ask when the request's zone is the workspace's.
   */
  async volume(
    tx: Tx,
    w: FeedWindow,
    unit: 'hour' | 'day' | 'week',
    filter: FeedFilter = {},
  ): Promise<Array<{ at: string; sent: number; received: number; failed: number }>> {
    const u = sql.raw(`'${unit}'`);
    const z = w.tz;
    const entering = sql`${MESSAGE_STATUS_CODE.queued}, ${MESSAGE_STATUS_CODE.sent}, ${MESSAGE_STATUS_CODE.delivered}, ${MESSAGE_STATUS_CODE.read}`;
    const res = await tx.execute(sql`
      WITH ${feedPointsSql(w)},
      agg AS (
        SELECT date_trunc(${u}, p.ts AT TIME ZONE ${z}::text) AS b,
               sum(p.n) FILTER (WHERE p.d1 IN (${entering}))::int AS sent,
               sum(p.n) FILTER (WHERE p.d1 = ${MESSAGE_STATUS_CODE.received})::int AS received,
               sum(p.n) FILTER (WHERE p.d1 = ${MESSAGE_STATUS_CODE.failed})::int AS failed
          FROM points p WHERE ${feedFilterSql(filter)} GROUP BY 1)
      SELECT to_char((gs.b AT TIME ZONE ${z}::text) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
             COALESCE(a.sent, 0) AS sent, COALESCE(a.received, 0) AS received, COALESCE(a.failed, 0) AS failed
        FROM generate_series(
               date_trunc(${u}, ${w.from.toISOString()}::timestamptz AT TIME ZONE ${z}::text),
               date_trunc(${u}, (${w.to.toISOString()}::timestamptz - interval '1 microsecond') AT TIME ZONE ${z}::text),
               ${`1 ${unit}`}::interval) AS gs(b)
        LEFT JOIN agg a ON a.b = gs.b
       ORDER BY gs.b`);
    return (res.rows as Array<{ at: string; sent: number; received: number; failed: number }>).map(
      (r) => ({
        at: String(r.at),
        sent: Number(r.sent),
        received: Number(r.received),
        failed: Number(r.failed),
      }),
    );
  }

  /** Average seconds to the first reply over the replies made in the whole hours of the window, or null when there is none (decision D9). */
  async averageFirstReplySeconds(
    tx: Tx,
    w: FeedWindow,
    channel: { hidden?: readonly number[]; channelId?: number } = {},
  ): Promise<number | null> {
    const res = await tx.execute(feedRepliesSql(w, channel));
    const r = res.rows[0] as { n: string | number; ms: string | number };
    const n = Number(r.n);
    return n === 0 ? null : Math.round(Number(r.ms) / 1000 / n);
  }
}
