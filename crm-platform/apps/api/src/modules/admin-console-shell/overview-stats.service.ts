import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { OverviewStatsResponse } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';

type Counts = Omit<OverviewStatsResponse, 'recentActivity' | 'nextScheduledAt'>;

/**
 * Three figures of the outbound message stream (the delivered share of the last 30 days, sent in the last 7 days, sent this month) from
 * ONE pass over the workspace's recent messages. They were three statements that each read the same
 * rows with a different window; the pass starts at the oldest of the windows (the month can begin before 30 days ago).
 */
export function messageFiguresSql(orgId: number, at?: Date): SQL {
  // the database clock, as the separate statements used; a test passes a date to reach the end of a long month
  const n = at ? sql`${at.toISOString()}::timestamptz` : sql`now()`;
  return sql`SELECT
      CASE WHEN count(*) FILTER (WHERE created_at >= ${n} - interval '30 days') = 0 THEN NULL
        ELSE round(100.0 * count(*) FILTER (WHERE created_at >= ${n} - interval '30 days' AND status IN ('delivered', 'read'))
                   / count(*) FILTER (WHERE created_at >= ${n} - interval '30 days')) END AS delivered_pct,
      count(*) FILTER (WHERE created_at >= ${n} - interval '7 days') AS outbound_7d,
      count(*) FILTER (WHERE created_at >= date_trunc('month', ${n})) AS messages_this_month
    FROM messages
    WHERE org_id = ${orgId} AND direction = 'out' AND kind <> 'reaction'
      AND created_at >= least(${n} - interval '30 days', date_trunc('month', ${n}))`;
}

/**
 * The More hub's numbers (TW-ASHELL-020). Reference ran about forty uncached queries in the page; here it is one read per page
 * view, one transaction, each figure in its own savepoint so a lookup that fails leaves a `null` and never the page. Every
 * query is the caller's workspace under row-level security (the `org_id` filter is there as well, for the planner). The
 * tables belong to other domains and are only read: this is the "stats provider" the inventory asks for, kept in one place so
 * the shell does not reach into each domain from the page.
 */
@Injectable()
export class OverviewStatsService {
  constructor(private readonly db: DatabaseService) {}

  async get(): Promise<OverviewStatsResponse> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    const { orgId, userId } = { orgId: ctx.orgId, userId: ctx.userId };
    const o = sql`${orgId}`;
    const week = sql`created_at >= now() - interval '7 days'`;
    const month = sql`created_at >= date_trunc('month', now())`;

    const counts: Record<
      Exclude<keyof Counts, 'deliveredPct' | 'outbound7d' | 'messagesThisMonth'>,
      SQL
    > = {
      activeRules: sql`SELECT (SELECT count(*) FROM keyword_replies WHERE org_id = ${o} AND status)
        + (SELECT count(*) FROM flows WHERE org_id = ${o} AND is_published AND is_active)
        + (SELECT count(*) FROM webhooks WHERE org_id = ${o} AND status)`,
      activeRulesNew: sql`SELECT (SELECT count(*) FROM keyword_replies WHERE org_id = ${o} AND status AND ${week})
        + (SELECT count(*) FROM flows WHERE org_id = ${o} AND is_published AND is_active AND ${week})
        + (SELECT count(*) FROM webhooks WHERE org_id = ${o} AND status AND ${week})`,
      scheduledQueued: sql`SELECT count(*) FROM scheduled_messages WHERE org_id = ${o} AND status IN ('scheduled', 'running')`,
      devicesActive: sql`SELECT count(*) FROM devices WHERE org_id = ${o} AND active`,
      devicesTotal: sql`SELECT count(*) FROM devices WHERE org_id = ${o}`,
      unreadNotifications: sql`SELECT count(*) FROM inbox_notifications WHERE org_id = ${o} AND user_id = ${userId} AND read_at IS NULL`,
      contacts: sql`SELECT count(*) FROM contacts WHERE org_id = ${o} AND NOT is_archived`,
      groups: sql`SELECT count(*) FROM contact_groups WHERE org_id = ${o}`,
      tags: sql`SELECT count(*) FROM tags WHERE org_id = ${o}`,
      attributes: sql`SELECT count(*) FROM fields WHERE org_id = ${o} AND NOT is_system AND is_active`,
      broadcastsQueued: sql`SELECT count(*) FROM broadcasts WHERE org_id = ${o} AND status IN ('pending', 'processing', 'scheduled')`,
      autoReplyRules: sql`SELECT count(*) FROM keyword_replies WHERE org_id = ${o} AND status`,
      autoReplyMatchPct: sql`SELECT CASE WHEN count(*) = 0 THEN NULL
          ELSE round(100.0 * count(*) FILTER (WHERE matched_keyword_reply_id IS NOT NULL) / count(*)) END
        FROM auto_reply_lookups WHERE org_id = ${o} AND created_at >= now() - interval '30 days'`,
      webhookEndpoints: sql`SELECT (SELECT count(*) FROM webhooks WHERE org_id = ${o})
        + (SELECT count(*) FROM outbound_webhooks WHERE org_id = ${o})`,
      supportTotal: sql`SELECT count(*) FROM support_tickets WHERE org_id = ${o}`,
      supportOpen: sql`SELECT count(*) FROM support_tickets WHERE org_id = ${o} AND status NOT IN ('resolved', 'closed')`,
      messageHistory: sql`SELECT count(*) FROM messages WHERE org_id = ${o}`,
      activity24h: sql`SELECT count(*) FROM audit_log WHERE org_id = ${o} AND at >= now() - interval '24 hours'`,
      seats: sql`SELECT count(*) FROM users WHERE org_id = ${o} AND status = 'active'`,
      widgetsBuilt: sql`SELECT count(*) FROM chatbot_widgets WHERE org_id = ${o}`,
      widgetsLive: sql`SELECT count(*) FROM chatbot_widgets WHERE org_id = ${o} AND status = 'active'`,
      bookingTypes: sql`SELECT count(*) FROM booking_types WHERE org_id = ${o}`,
      formsDrafted: sql`SELECT count(*) FROM wa_forms WHERE org_id = ${o}`,
      formsLive: sql`SELECT count(*) FROM wa_forms WHERE org_id = ${o} AND status = 'published'`,
      assistantsConfigured: sql`SELECT count(*) FROM ai_call_assistants WHERE org_id = ${o}`,
      assistantsLive: sql`SELECT count(*) FROM ai_call_assistants WHERE org_id = ${o} AND is_active`,
      agentsConfigured: sql`SELECT count(*) FROM ai_agents WHERE org_id = ${o}`,
      agentsLive: sql`SELECT count(*) FROM ai_agents WHERE org_id = ${o} AND is_active`,
      calls24h: sql`SELECT count(*) FROM wa_calls WHERE org_id = ${o} AND created_at >= now() - interval '24 hours'`,
      callMinutes24h: sql`SELECT COALESCE(round(sum(duration_sec) / 60.0), 0) FROM wa_calls WHERE org_id = ${o} AND created_at >= now() - interval '24 hours'`,
      chatLinks: sql`SELECT count(*) FROM wa_chat_links WHERE org_id = ${o}`,
      chatLinkClicks: sql`SELECT COALESCE(sum(click_count), 0) FROM wa_chat_links WHERE org_id = ${o}`,
      aiTokensThisMonth: sql`SELECT COALESCE(sum(total_tokens), 0) FROM ai_token_usage WHERE org_id = ${o} AND ${month}`,
      flowFailedRuns: sql`SELECT count(*) FROM flow_runs WHERE org_id = ${o} AND status = 'failed' AND created_at >= now() - interval '7 days'`,
      integrationsConnected: sql`SELECT (SELECT count(*) FROM hubspot_integrations WHERE org_id = ${o} AND status = 'active')
        + (SELECT count(*) FROM shopify_integrations WHERE org_id = ${o} AND status = 'active')
        + (SELECT count(*) FROM woocommerce_integrations WHERE org_id = ${o} AND status = 'active')`,
      affiliateReferrals: sql`SELECT count(*) FROM referrals WHERE referrer_user_id = ${userId}`,
    };

    return this.db.txAs({ orgId, userId }, async (tx) => {
      // One savepoint per figure: a table or column that is not there costs that figure, not the page.
      const one = async <T>(
        query: SQL,
        read: (row: Record<string, unknown>) => T,
      ): Promise<T | null> => {
        try {
          return await tx.transaction(async (sp) => {
            const res = await sp.execute(query);
            return read((res.rows[0] ?? {}) as Record<string, unknown>);
          });
        } catch {
          return null;
        }
      };
      const out: Record<string, number | null> = {};
      for (const [key, query] of Object.entries(counts)) {
        out[key] = await one(query, (r) => {
          const v = Object.values(r)[0];
          return v === null || v === undefined ? null : Number(v);
        });
      }
      // the three message figures from one pass (see messageFiguresSql); if it fails they are null, as each was before
      const msg = await one(messageFiguresSql(orgId), (r) => r);
      const figure = (v: unknown): number | null =>
        v === null || v === undefined ? null : Number(v);
      out.deliveredPct = figure(msg?.delivered_pct);
      out.outbound7d = figure(msg?.outbound_7d);
      out.messagesThisMonth = figure(msg?.messages_this_month);
      const next = await one(
        sql`SELECT min(next_run_at) AS at FROM scheduled_messages
             WHERE org_id = ${o} AND status IN ('scheduled', 'running') AND next_run_at > now()`,
        (r) => (r.at ? new Date(r.at as string).toISOString() : null),
      );
      let recentActivity: OverviewStatsResponse['recentActivity'] = [];
      try {
        recentActivity = await tx.transaction(async (sp) => {
          const res = await sp.execute(
            sql`SELECT module, action, at FROM audit_log WHERE org_id = ${o} ORDER BY at DESC, id DESC LIMIT 5`,
          );
          return (res.rows as unknown as Array<{ module: string; action: string; at: Date }>).map(
            (r) => ({ module: r.module, action: r.action, at: new Date(r.at).toISOString() }),
          );
        });
      } catch {
        recentActivity = [];
      }
      return {
        ...(out as unknown as Counts),
        nextScheduledAt: next,
        recentActivity,
      } satisfies OverviewStatsResponse;
    });
  }
}
