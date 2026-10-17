import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  type TeamAnalyticsQuery,
  type TeamAnalyticsRange,
  type TeamAnalyticsResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';

type Raw = Record<string, unknown>;

const oneDecimal = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;

/**
 * The Team Performance report (TW-TIB2-034): workspace totals and one row per agent for today, this week (from Monday) or this month,
 * read in the workspace's time zone, optionally narrowed to one channel.
 *
 * What the figures mean, kept from Reference where it is observable:
 *  - replies are human replies only. Reference also counted the automatic replies written under the conversation owner's name, which
 *    inflated that person's count; here a reply sent by routing, a keyword or an AI agent has its own sender kind and is not counted;
 *  - an agent row exists for a person who sent at least one reply in the window (someone who only resolved or was assigned does not
 *    appear), as in Reference;
 *  - the average first-reply time is over conversations resolved in the window, in calendar minutes, credited to the person the
 *    conversation is assigned to; the total is the same average over every resolved conversation;
 *  - load is the live number of open conversations assigned to the person (Reference kept a counter that drifted).
 */
@Injectable()
export class TeamAnalyticsService {
  constructor(private readonly db: DatabaseService) {}

  async report(query: TeamAnalyticsQuery): Promise<TeamAnalyticsResponse> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const range: TeamAnalyticsRange = query.range;

    return this.db.tx(async (tx) => {
      let channel: number | null = null;
      if (query.channelId) {
        const found = await tx.execute(
          sql`SELECT id FROM channels WHERE org_id = ${orgId} AND uuid = ${query.channelId}::uuid`,
        );
        const row = found.rows[0] as Raw | undefined;
        if (!row) throw AppError.notFound('Channel', query.channelId);
        channel = Number(row.id);
      }
      const onChannel: SQL = channel === null ? sql`` : sql`AND c.channel_id = ${channel}`;

      // Day, week (Monday) and month starts in the workspace's zone; an unknown zone name reads as UTC.
      const unit = range === 'today' ? 'day' : range;
      const sinceRes = await tx.execute(sql`
        WITH z AS (
          SELECT COALESCE((SELECT name FROM pg_timezone_names WHERE name = o.settings ->> 'timezone'), 'UTC') AS name
          FROM organizations o WHERE o.id = ${orgId}
        )
        SELECT date_trunc(${unit}::text, now() AT TIME ZONE z.name) AT TIME ZONE z.name AS since FROM z`);
      const since = new Date((sinceRes.rows[0] as Raw).since as string);

      const replies = await tx.execute(sql`
        SELECT m.sender_user_id AS user_id, count(*)::int AS n
        FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        WHERE m.org_id = ${orgId} AND m.direction = 'out' AND m.sender_kind = 'agent' AND m.sender_user_id IS NOT NULL
          AND m.deleted_at IS NULL AND m.created_at >= ${since.toISOString()}::timestamptz ${onChannel}
        GROUP BY m.sender_user_id`);

      const inbound = await tx.execute(sql`
        SELECT count(*)::int AS n
        FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        WHERE m.org_id = ${orgId} AND m.direction = 'in' AND m.created_at >= ${since.toISOString()}::timestamptz ${onChannel}`);

      const resolved = await tx.execute(sql`
        SELECT c.resolved_by AS user_id, count(*)::int AS n
        FROM conversations c
        WHERE c.org_id = ${orgId} AND c.status = 'resolved' AND c.resolved_at >= ${since.toISOString()}::timestamptz ${onChannel}
        GROUP BY c.resolved_by`);

      const response = await tx.execute(sql`
        SELECT c.assignee_user_id AS user_id,
               avg(extract(epoch FROM (c.first_response_at - c.created_at)) / 60.0) AS avg_min
        FROM conversations c
        WHERE c.org_id = ${orgId} AND c.status = 'resolved' AND c.resolved_at >= ${since.toISOString()}::timestamptz
          AND c.first_response_at IS NOT NULL ${onChannel}
        GROUP BY GROUPING SETS ((c.assignee_user_id), ())`);

      const repliesBy = new Map<number, number>();
      for (const r of replies.rows as Raw[]) repliesBy.set(Number(r.user_id), Number(r.n));
      const resolvedBy = new Map<number, number>();
      let resolvedTotal = 0;
      for (const r of resolved.rows as Raw[]) {
        resolvedTotal += Number(r.n);
        if (r.user_id !== null) resolvedBy.set(Number(r.user_id), Number(r.n));
      }
      const avgBy = new Map<number, number | null>();
      let avgTotal: number | null = null;
      for (const r of response.rows as Raw[]) {
        if (r.user_id === null) avgTotal = oneDecimal(r.avg_min);
        else avgBy.set(Number(r.user_id), oneDecimal(r.avg_min));
      }

      const ids = [...repliesBy.keys()];
      const people =
        ids.length === 0
          ? []
          : ((
              await tx.execute(sql`
                SELECT u.id, u.uuid, u.full_name, COALESCE(s.status, 'offline') AS status, s.last_seen_at,
                       (SELECT count(*)::int FROM conversations c
                         WHERE c.org_id = u.org_id AND c.assignee_user_id = u.id AND c.archived = FALSE
                           AND c.status = 'open') AS load
                FROM users u LEFT JOIN agent_statuses s ON s.org_id = u.org_id AND s.user_id = u.id
                WHERE u.org_id = ${orgId} AND u.id IN (${sql.join(
                  ids.map((i) => sql`${i}`),
                  sql`, `,
                )})`)
            ).rows as Raw[]);

      const agents = people
        .map((p) => {
          const id = Number(p.id);
          return {
            userId: p.uuid as string,
            name: (p.full_name as string | null) ?? null,
            replies: repliesBy.get(id) ?? 0,
            resolved: resolvedBy.get(id) ?? 0,
            avgResponseMin: avgBy.get(id) ?? null,
            status: p.status as string,
            currentLoad: Number(p.load),
            lastSeenAt: p.last_seen_at ? new Date(p.last_seen_at as string).toISOString() : null,
          };
        })
        .sort((a, b) => b.replies - a.replies || (a.name ?? '').localeCompare(b.name ?? ''));

      return {
        range,
        since: since.toISOString(),
        totals: {
          replies: [...repliesBy.values()].reduce((a, b) => a + b, 0),
          resolved: resolvedTotal,
          inbounds: Number((inbound.rows[0] as Raw).n),
          avgFirstResponseMin: avgTotal,
        },
        agents,
      };
    });
  }
}
