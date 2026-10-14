import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

/** A half-open window of instants: [from, to). */
export interface Span {
  from: Date;
  to: Date;
}

/** What every query shares. Ids are internal; scopes are conditions on the alias each query documents. */
export interface DashFilter {
  orgId: number;
  pipelineId?: number;
  ownerId?: number;
  teamId?: number;
}

export interface MoneyCount {
  currency: string;
  n: number;
  total: bigint;
}

const iso = (d: Date) => d.toISOString();
const big = (v: unknown): bigint => (v == null ? 0n : BigInt(v as string));
const int = (v: unknown): number => Number(v ?? 0);

/** Members of a team, as a sub-select over `team_members`. */
const teamMembers = (orgId: number, teamId: number) =>
  sql`(SELECT tm.user_id FROM team_members tm WHERE tm.org_id = ${orgId} AND tm.team_id = ${teamId})`;

/** `col` is the owner/assignee column of the table in the query. The owner and the team filters, ANDed. */
function whoConds(col: SQL, f: DashFilter): SQL[] {
  const out: SQL[] = [];
  if (f.ownerId !== undefined) out.push(sql`${col} = ${f.ownerId}`);
  if (f.teamId !== undefined) out.push(sql`${col} IN ${teamMembers(f.orgId, f.teamId)}`);
  return out;
}

/** The record scope of a table whose owner column is `col` (deals, contacts): all / team / own. */
export function ownerScope(
  col: SQL,
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  if (scope === 'own') return sql`${col} = ${actorUserId}`;
  return sql`${col} IN (
    SELECT tm2.user_id FROM team_members tm1
    JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
    WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId}
  )`;
}

/** Scopes by section; `undefined` is `all`. Each is written against the alias its section's queries use. */
export interface DashScopes {
  /** against `d.owner_user_id` */
  deals?: SQL;
  /** against `c.owner_id` */
  contacts?: SQL;
  /** `taskScopeCondition`, against `t.` */
  tasks?: SQL;
  /** `invoiceScopeCondition`, against `i.` */
  invoices?: SQL;
  /** `paymentScopeCondition`, against `p.` and `i.` */
  payments?: SQL;
}

const where = (conds: Array<SQL | undefined>): SQL =>
  sql.join(
    conds.filter((c): c is SQL => c !== undefined),
    sql` AND `,
  );

/** Grouped, index-friendly reads behind the CRM dashboard. Everything is aggregated in SQL; nothing is paged in memory. */
@Injectable()
export class CrmDashboardRepository {
  // --- viewer ------------------------------------------------------------------------------------------------------------

  /** The viewer's own zone from their profile, else null (the caller falls back to the workspace's). */
  async profileZone(tx: Tx, orgId: number, userId: number | null): Promise<string | null> {
    if (!userId) return null;
    const res = await tx.execute(
      sql`SELECT timezone FROM user_profiles WHERE org_id = ${orgId} AND user_id = ${userId}`,
    );
    return ((res.rows[0] as Raw | undefined)?.timezone as string | null | undefined) ?? null;
  }

  async teamId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM teams WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? int(r.id) : undefined;
  }

  // --- deals -------------------------------------------------------------------------------------------------------------

  private dealConds(f: DashFilter, scope: SQL | undefined, ...extra: SQL[]): SQL {
    return where([
      sql`d.org_id = ${f.orgId}`,
      scope,
      f.pipelineId !== undefined ? sql`d.pipeline_id = ${f.pipelineId}` : undefined,
      ...whoConds(sql`d.owner_user_id`, f),
      ...extra,
    ]);
  }

  /** Open deals per stage and currency, and how many of them are past their expected close date. */
  async openByStage(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    today: string,
  ): Promise<Array<MoneyCount & { stageId: number; late: number }>> {
    const res = await tx.execute(sql`
      SELECT d.stage_id, d.currency, count(*)::int AS n, coalesce(sum(d.value_minor), 0)::text AS total,
             (count(*) FILTER (WHERE d.expected_close_date < ${today}::date))::int AS late
      FROM deals d WHERE ${this.dealConds(f, scope, sql`d.status = 'open'`)}
      GROUP BY d.stage_id, d.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      stageId: int(r.stage_id),
      currency: r.currency as string,
      n: int(r.n),
      total: big(r.total),
      late: int(r.late),
    }));
  }

  /**
   * Won and lost deals closed in the current or the previous window, per currency. `days` is the sum of days from creation to
   * the close (for the mean cycle).
   */
  async closed(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    cur: Span,
    prev: Span,
  ): Promise<Array<MoneyCount & { kind: 'won' | 'lost'; win: 'cur' | 'prev'; days: number }>> {
    const closedAt = sql`CASE d.status WHEN 'won' THEN d.won_at ELSE d.lost_at END`;
    const res = await tx.execute(sql`
      SELECT d.status AS kind,
             CASE WHEN ${closedAt} >= ${iso(cur.from)}::timestamptz THEN 'cur' ELSE 'prev' END AS win,
             d.currency, count(*)::int AS n, coalesce(sum(d.value_minor), 0)::text AS total,
             coalesce(sum(extract(epoch FROM (${closedAt} - d.created_at)) / 86400), 0)::float8 AS days
      FROM deals d
      WHERE ${this.dealConds(
        f,
        scope,
        sql`(
          (d.status = 'won' AND d.won_at >= ${iso(prev.from)}::timestamptz AND d.won_at < ${iso(cur.to)}::timestamptz)
          OR (d.status = 'lost' AND d.lost_at >= ${iso(prev.from)}::timestamptz AND d.lost_at < ${iso(cur.to)}::timestamptz)
        )`,
      )}
      GROUP BY d.status, win, d.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      kind: r.kind as 'won' | 'lost',
      win: r.win as 'cur' | 'prev',
      currency: r.currency as string,
      n: int(r.n),
      total: big(r.total),
      days: Number(r.days ?? 0),
    }));
  }

  /** Closed deals per bucket (the first local day of it), status and currency. */
  async trend(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    cur: Span,
    tz: string,
    bucket: 'day' | 'week' | 'month',
  ): Promise<Array<MoneyCount & { kind: 'won' | 'lost'; start: string }>> {
    const closedAt = sql`CASE d.status WHEN 'won' THEN d.won_at ELSE d.lost_at END`;
    const res = await tx.execute(sql`
      SELECT d.status AS kind, d.currency,
             to_char(date_trunc(${bucket}, ${closedAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS start,
             count(*)::int AS n, coalesce(sum(d.value_minor), 0)::text AS total
      FROM deals d
      WHERE ${this.dealConds(
        f,
        scope,
        sql`(
          (d.status = 'won' AND d.won_at >= ${iso(cur.from)}::timestamptz AND d.won_at < ${iso(cur.to)}::timestamptz)
          OR (d.status = 'lost' AND d.lost_at >= ${iso(cur.from)}::timestamptz AND d.lost_at < ${iso(cur.to)}::timestamptz)
        )`,
      )}
      GROUP BY d.status, d.currency, start
    `);
    return (res.rows as Raw[]).map((r) => ({
      kind: r.kind as 'won' | 'lost',
      currency: r.currency as string,
      start: r.start as string,
      n: int(r.n),
      total: big(r.total),
    }));
  }

  /**
   * The funnel of one pipeline over the deals CREATED in the window: how many reached each stage (or a later, non-lost one), with
   * their value. A stage is reached when the deal's timeline has a move into it or the deal sits in it now; a stage the deal skipped
   * counts as reached when it went further. The lost stage is not a step of the funnel.
   */
  async funnel(
    tx: Tx,
    f: DashFilter & { pipelineId: number },
    scope: SQL | undefined,
    cur: Span,
  ): Promise<{ cohort: number; rows: Array<MoneyCount & { stageId: number }> }> {
    const cond = this.dealConds(
      f,
      scope,
      sql`d.created_at >= ${iso(cur.from)}::timestamptz`,
      sql`d.created_at < ${iso(cur.to)}::timestamptz`,
    );
    const res = await tx.execute(sql`
      WITH cohort AS (
        SELECT d.id, d.currency, d.value_minor, d.stage_id FROM deals d WHERE ${cond}
      ), visited AS (
        SELECT c.id, c.currency, c.value_minor,
               greatest(
                 coalesce(max(ps.sort_order) FILTER (WHERE NOT ps.is_lost), -1),
                 coalesce((SELECT cs.sort_order FROM pipeline_stages cs
                            WHERE cs.org_id = ${f.orgId} AND cs.id = c.stage_id AND NOT cs.is_lost), -1)
               ) AS max_sort
        FROM cohort c
        LEFT JOIN deal_activities a ON a.org_id = ${f.orgId} AND a.deal_id = c.id AND a.type = 'stage_change'
        LEFT JOIN pipeline_stages ps ON ps.org_id = ${f.orgId} AND ps.pipeline_id = ${f.pipelineId}
                                    AND ps.uuid::text = a.meta -> 'to' ->> 'id'
        GROUP BY c.id, c.currency, c.value_minor, c.stage_id
      )
      SELECT s.id AS stage_id, v.currency, count(v.id)::int AS n, coalesce(sum(v.value_minor), 0)::text AS total,
             (SELECT count(*) FROM cohort)::int AS cohort
      FROM pipeline_stages s
      LEFT JOIN visited v ON v.max_sort >= s.sort_order
      WHERE s.org_id = ${f.orgId} AND s.pipeline_id = ${f.pipelineId} AND NOT s.is_lost
      GROUP BY s.id, v.currency
    `);
    const rows = res.rows as Raw[];
    return {
      cohort: int(rows[0]?.cohort),
      rows: rows
        .filter((r) => r.currency !== null)
        .map((r) => ({
          stageId: int(r.stage_id),
          currency: r.currency as string,
          n: int(r.n),
          total: big(r.total),
        })),
    };
  }

  /** Per owner: closed in the window, and open now. `ownerUuid` null is the deals nobody owns. */
  async leaders(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    cur: Span,
  ): Promise<
    Array<{
      ownerUuid: string | null;
      ownerName: string | null;
      currency: string;
      wonN: number;
      wonTotal: bigint;
      lostN: number;
      openN: number;
    }>
  > {
    const won = sql`d.status = 'won' AND d.won_at >= ${iso(cur.from)}::timestamptz AND d.won_at < ${iso(cur.to)}::timestamptz`;
    const lost = sql`d.status = 'lost' AND d.lost_at >= ${iso(cur.from)}::timestamptz AND d.lost_at < ${iso(cur.to)}::timestamptz`;
    const res = await tx.execute(sql`
      SELECT u.uuid AS owner_uuid, u.full_name AS owner_name, d.currency,
             (count(*) FILTER (WHERE ${won}))::int AS won_n,
             coalesce(sum(d.value_minor) FILTER (WHERE ${won}), 0)::text AS won_total,
             (count(*) FILTER (WHERE ${lost}))::int AS lost_n,
             (count(*) FILTER (WHERE d.status = 'open'))::int AS open_n
      FROM deals d LEFT JOIN users u ON u.org_id = d.org_id AND u.id = d.owner_user_id
      WHERE ${this.dealConds(f, scope, sql`(d.status = 'open' OR (${won}) OR (${lost}))`)}
      GROUP BY u.uuid, u.full_name, d.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      ownerUuid: (r.owner_uuid as string | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null,
      currency: r.currency as string,
      wonN: int(r.won_n),
      wonTotal: big(r.won_total),
      lostN: int(r.lost_n),
      openN: int(r.open_n),
    }));
  }

  /**
   * Activities people logged in the window, by person: deal timeline rows other than stage moves, on deals inside the deal scope,
   * and (when the caller may read contacts) user-written contact activities on contacts inside the contact scope.
   */
  async activityCounts(
    tx: Tx,
    f: DashFilter,
    scopes: Pick<DashScopes, 'deals' | 'contacts'>,
    cur: Span,
    includeContacts: boolean,
  ): Promise<Map<string, number>> {
    const dealPart = sql`
      SELECT u.uuid AS user_uuid, count(*)::int AS n
      FROM deal_activities a
      JOIN deals d ON d.org_id = a.org_id AND d.id = a.deal_id
      JOIN users u ON u.org_id = a.org_id AND u.id = a.user_id
      WHERE ${this.dealConds(
        f,
        scopes.deals,
        sql`a.type <> 'stage_change'`,
        sql`a.created_at >= ${iso(cur.from)}::timestamptz`,
        sql`a.created_at < ${iso(cur.to)}::timestamptz`,
      )}
      GROUP BY u.uuid`;
    const contactPart = includeContacts
      ? sql`
      UNION ALL
      SELECT u.uuid AS user_uuid, count(*)::int AS n
      FROM contact_activities ca
      JOIN contacts c ON c.org_id = ca.org_id AND c.id = ca.contact_id
      JOIN users u ON u.org_id = ca.org_id AND u.id = ca.actor_id
      WHERE ${where([
        sql`ca.org_id = ${f.orgId}`,
        sql`ca.source = 'user'`,
        sql`ca.occurred_at >= ${iso(cur.from)}::timestamptz`,
        sql`ca.occurred_at < ${iso(cur.to)}::timestamptz`,
        scopes.contacts,
      ])}
      GROUP BY u.uuid`
      : sql``;
    const res = await tx.execute(sql`${dealPart} ${contactPart}`);
    const out = new Map<string, number>();
    for (const r of res.rows as Raw[])
      out.set(r.user_uuid as string, (out.get(r.user_uuid as string) ?? 0) + int(r.n));
    return out;
  }

  /** The newest timeline rows of deals and, when allowed, of contacts. */
  async recentActivity(
    tx: Tx,
    f: DashFilter,
    scopes: Pick<DashScopes, 'deals' | 'contacts'>,
    includeContacts: boolean,
    limit: number,
  ): Promise<
    Array<{
      kind: 'deal' | 'contact';
      type: string;
      at: Date;
      subject: string | null;
      subjectUuid: string;
      actorUuid: string | null;
      actorName: string | null;
      from: string | null;
      to: string | null;
    }>
  > {
    const contactPart = includeContacts
      ? sql`UNION ALL
        (SELECT 'contact'::text AS kind, ca.activity_type AS type, ca.occurred_at AS at, c.name AS subject, c.uuid AS subject_uuid,
                u.uuid AS actor_uuid, u.full_name AS actor_name, NULL::text AS from_name, NULL::text AS to_name
         FROM contact_activities ca
         JOIN contacts c ON c.org_id = ca.org_id AND c.id = ca.contact_id
         LEFT JOIN users u ON u.org_id = ca.org_id AND u.id = ca.actor_id
         WHERE ${where([
           sql`ca.org_id = ${f.orgId}`,
           scopes.contacts,
           ...whoConds(sql`c.owner_id`, f),
         ])}
         ORDER BY ca.occurred_at DESC LIMIT ${limit})`
      : sql``;
    const res = await tx.execute(sql`
      SELECT * FROM (
        (SELECT 'deal'::text AS kind, a.type AS type, a.created_at AS at, d.title AS subject, d.uuid AS subject_uuid,
                u.uuid AS actor_uuid, u.full_name AS actor_name,
                a.meta -> 'from' ->> 'name' AS from_name, a.meta -> 'to' ->> 'name' AS to_name
         FROM deal_activities a
         JOIN deals d ON d.org_id = a.org_id AND d.id = a.deal_id
         LEFT JOIN users u ON u.org_id = a.org_id AND u.id = a.user_id
         WHERE ${this.dealConds(f, scopes.deals)}
         ORDER BY a.created_at DESC LIMIT ${limit})
        ${contactPart}
      ) feed ORDER BY at DESC LIMIT ${limit}
    `);
    return (res.rows as Raw[]).map((r) => ({
      kind: r.kind as 'deal' | 'contact',
      type: r.type as string,
      at: new Date(r.at as string),
      subject: (r.subject as string | null) ?? null,
      subjectUuid: r.subject_uuid as string,
      actorUuid: (r.actor_uuid as string | null) ?? null,
      actorName: (r.actor_name as string | null) ?? null,
      from: (r.from_name as string | null) ?? null,
      to: (r.to_name as string | null) ?? null,
    }));
  }

  // --- contacts and lead sources -----------------------------------------------------------------------------------------

  private contactConds(f: DashFilter, scope: SQL | undefined, ...extra: SQL[]): SQL {
    return where([
      sql`c.org_id = ${f.orgId}`,
      sql`c.lifecycle_state = 'active'`,
      sql`NOT c.is_archived`,
      scope,
      ...whoConds(sql`c.owner_id`, f),
      ...extra,
    ]);
  }

  /** Contacts in scope right now (the owner / team filter applies), whatever the period. */
  async totalContacts(tx: Tx, f: DashFilter, scope: SQL | undefined): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM contacts c WHERE ${this.contactConds(f, scope)}`,
    );
    return int((res.rows[0] as Raw | undefined)?.n);
  }

  /** New contacts, and new contacts that carry a source, in the current and the previous window. */
  async newContacts(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    cur: Span,
    prev: Span,
  ): Promise<{ cur: number; prev: number; curLeads: number; prevLeads: number }> {
    const inCur = sql`c.created_at >= ${iso(cur.from)}::timestamptz AND c.created_at < ${iso(cur.to)}::timestamptz`;
    const inPrev = sql`c.created_at >= ${iso(prev.from)}::timestamptz AND c.created_at < ${iso(prev.to)}::timestamptz`;
    const res = await tx.execute(sql`
      SELECT (count(*) FILTER (WHERE ${inCur}))::int AS cur,
             (count(*) FILTER (WHERE ${inPrev}))::int AS prev,
             (count(*) FILTER (WHERE ${inCur} AND c.source IS NOT NULL))::int AS cur_leads,
             (count(*) FILTER (WHERE ${inPrev} AND c.source IS NOT NULL))::int AS prev_leads
      FROM contacts c
      WHERE ${this.contactConds(f, scope, sql`c.created_at >= ${iso(prev.from)}::timestamptz`, sql`c.created_at < ${iso(cur.to)}::timestamptz`)}
    `);
    const r = (res.rows[0] ?? {}) as Raw;
    return {
      cur: int(r.cur),
      prev: int(r.prev),
      curLeads: int(r.cur_leads),
      prevLeads: int(r.prev_leads),
    };
  }

  /**
   * Leads (contacts created in the window with a source) by source: how many have a deal, how many a won deal. Deals are counted
   * inside the caller's deal scope and the pipeline filter; the owner / team filter is on the contact.
   */
  async sources(
    tx: Tx,
    f: DashFilter,
    scopes: Pick<DashScopes, 'deals' | 'contacts'>,
    cur: Span,
    limit: number,
  ): Promise<Array<{ source: string; leads: number; withDeal: number; withWon: number }>> {
    // The deal filter inside the lateral join must not reapply the owner / team filter (that one is on the contact).
    const dealSide = where([
      sql`d.org_id = c.org_id`,
      sql`d.contact_id = c.id`,
      scopes.deals,
      f.pipelineId !== undefined ? sql`d.pipeline_id = ${f.pipelineId}` : undefined,
    ]);
    const res = await tx.execute(sql`
      SELECT c.source, count(*)::int AS leads,
             (count(*) FILTER (WHERE ds.n > 0))::int AS with_deal,
             (count(*) FILTER (WHERE ds.won_n > 0))::int AS with_won
      FROM contacts c
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n, (count(*) FILTER (WHERE d.status = 'won'))::int AS won_n FROM deals d WHERE ${dealSide}
      ) ds ON true
      WHERE ${this.contactConds(
        f,
        scopes.contacts,
        sql`c.source IS NOT NULL`,
        sql`c.created_at >= ${iso(cur.from)}::timestamptz`,
        sql`c.created_at < ${iso(cur.to)}::timestamptz`,
      )}
      GROUP BY c.source ORDER BY leads DESC, c.source LIMIT ${limit}
    `);
    return (res.rows as Raw[]).map((r) => ({
      source: r.source as string,
      leads: int(r.leads),
      withDeal: int(r.with_deal),
      withWon: int(r.with_won),
    }));
  }

  /** Won value of those leads' deals, per source and currency. */
  async sourceWonValue(
    tx: Tx,
    f: DashFilter,
    scopes: Pick<DashScopes, 'deals' | 'contacts'>,
    cur: Span,
    sources: string[],
  ): Promise<Array<{ source: string; currency: string; total: bigint }>> {
    if (sources.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT c.source, d.currency, coalesce(sum(d.value_minor), 0)::text AS total
      FROM contacts c JOIN deals d ON d.org_id = c.org_id AND d.contact_id = c.id
      WHERE ${this.contactConds(
        f,
        scopes.contacts,
        sql`c.source IN (${sql.join(
          sources.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        sql`c.created_at >= ${iso(cur.from)}::timestamptz`,
        sql`c.created_at < ${iso(cur.to)}::timestamptz`,
        sql`d.status = 'won'`,
        ...(scopes.deals ? [scopes.deals] : []),
        ...(f.pipelineId !== undefined ? [sql`d.pipeline_id = ${f.pipelineId}`] : []),
      )}
      GROUP BY c.source, d.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      source: r.source as string,
      currency: r.currency as string,
      total: big(r.total),
    }));
  }

  // --- tasks -------------------------------------------------------------------------------------------------------------

  private taskConds(f: DashFilter, scope: SQL | undefined, ...extra: SQL[]): SQL {
    return where([
      sql`t.org_id = ${f.orgId}`,
      sql`t.status = 'open'`,
      scope,
      ...whoConds(sql`t.assignee_id`, f),
      ...extra,
    ]);
  }

  /** Open tasks per assignee: all, overdue (due before now), and due later today (before `dayEnd`). */
  async tasksByAssignee(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    dayEnd: Date,
    limit: number,
  ): Promise<
    Array<{
      assigneeUuid: string | null;
      assigneeName: string | null;
      open: number;
      overdue: number;
      dueToday: number;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT u.uuid AS assignee_uuid, u.full_name AS assignee_name, count(*)::int AS open_n,
             (count(*) FILTER (WHERE t.due_at < now()))::int AS overdue_n,
             (count(*) FILTER (WHERE t.due_at >= now() AND t.due_at < ${iso(dayEnd)}::timestamptz))::int AS due_today_n
      FROM tasks t LEFT JOIN users u ON u.org_id = t.org_id AND u.id = t.assignee_id
      WHERE ${this.taskConds(f, scope)}
      GROUP BY u.uuid, u.full_name
      ORDER BY overdue_n DESC, open_n DESC, u.full_name NULLS LAST
      LIMIT ${limit}
    `);
    return (res.rows as Raw[]).map((r) => ({
      assigneeUuid: (r.assignee_uuid as string | null) ?? null,
      assigneeName: (r.assignee_name as string | null) ?? null,
      open: int(r.open_n),
      overdue: int(r.overdue_n),
      dueToday: int(r.due_today_n),
    }));
  }

  /** The totals over every assignee (the grouped list above is capped). */
  async taskTotals(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    dayEnd: Date,
  ): Promise<{ open: number; overdue: number; dueToday: number }> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS open_n,
             (count(*) FILTER (WHERE t.due_at < now()))::int AS overdue_n,
             (count(*) FILTER (WHERE t.due_at >= now() AND t.due_at < ${iso(dayEnd)}::timestamptz))::int AS due_today_n
      FROM tasks t WHERE ${this.taskConds(f, scope)}
    `);
    const r = (res.rows[0] ?? {}) as Raw;
    return { open: int(r.open_n), overdue: int(r.overdue_n), dueToday: int(r.due_today_n) };
  }

  async upcomingTasks(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    limit: number,
  ): Promise<
    Array<{
      uuid: string;
      title: string;
      dueAt: Date;
      overdue: boolean;
      assigneeUuid: string | null;
      assigneeName: string | null;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT t.uuid, t.title, t.due_at, (t.due_at < now()) AS overdue, u.uuid AS assignee_uuid, u.full_name AS assignee_name
      FROM tasks t LEFT JOIN users u ON u.org_id = t.org_id AND u.id = t.assignee_id
      WHERE ${this.taskConds(f, scope, sql`t.due_at IS NOT NULL`)}
      ORDER BY t.due_at, t.id LIMIT ${limit}
    `);
    return (res.rows as Raw[]).map((r) => ({
      uuid: r.uuid as string,
      title: r.title as string,
      dueAt: new Date(r.due_at as string),
      overdue: Boolean(r.overdue),
      assigneeUuid: (r.assignee_uuid as string | null) ?? null,
      assigneeName: (r.assignee_name as string | null) ?? null,
    }));
  }

  // --- invoices and payments ---------------------------------------------------------------------------------------------

  /** Conditions on the invoice side that follow the dashboard's filters: owner / team on the invoice owner, pipeline on its deal. */
  invoiceFilter(f: DashFilter): SQL[] {
    return [
      ...whoConds(sql`i.owner_id`, f),
      ...(f.pipelineId !== undefined
        ? [
            sql`i.deal_id IN (SELECT dp.id FROM deals dp WHERE dp.org_id = ${f.orgId} AND dp.pipeline_id = ${f.pipelineId})`,
          ]
        : []),
    ];
  }

  /** The invoice scope with the dashboard's filters ANDed, for callers that take one condition (the aging report). */
  invoiceWhere(f: DashFilter, scope: SQL | undefined): SQL | undefined {
    const extra = this.invoiceFilter(f);
    return scope || extra.length > 0 ? where([scope, ...extra]) : undefined;
  }

  /** Issued, not fully paid invoices: the open balance and the part past due, per currency. */
  async openBalances(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    today: string,
  ): Promise<Array<{ currency: string; outstanding: bigint; overdue: bigint; invoices: number }>> {
    const res = await tx.execute(sql`
      SELECT i.currency,
             coalesce(sum(greatest(i.total_minor - i.paid_minor - i.credited_minor, 0)), 0)::text AS outstanding,
             coalesce(sum(greatest(i.total_minor - i.paid_minor - i.credited_minor, 0)) FILTER (WHERE i.due_date < ${today}::date), 0)::text AS overdue,
             count(*)::int AS invoices
      FROM invoices i
      WHERE ${where([
        sql`i.org_id = ${f.orgId}`,
        sql`i.status = 'issued'`,
        sql`i.payment_status <> 'paid'`,
        scope,
        ...this.invoiceFilter(f),
      ])}
      GROUP BY i.currency ORDER BY i.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      currency: r.currency as string,
      outstanding: big(r.outstanding),
      overdue: big(r.overdue),
      invoices: int(r.invoices),
    }));
  }

  /** Money collected (payments, refunds not netted) in the current and the previous window, per currency. */
  async collected(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    cur: Span,
    prev: Span,
  ): Promise<Array<{ currency: string; win: 'cur' | 'prev'; total: bigint }>> {
    const res = await tx.execute(sql`
      SELECT p.currency,
             CASE WHEN p.paid_at >= ${iso(cur.from)}::timestamptz THEN 'cur' ELSE 'prev' END AS win,
             coalesce(sum(p.amount_minor), 0)::text AS total
      FROM payments p LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
      WHERE ${where([
        sql`p.org_id = ${f.orgId}`,
        sql`p.kind = 'payment'`,
        sql`p.paid_at >= ${iso(prev.from)}::timestamptz`,
        sql`p.paid_at < ${iso(cur.to)}::timestamptz`,
        scope,
        ...this.invoiceFilter(f),
      ])}
      GROUP BY p.currency, win
    `);
    return (res.rows as Raw[]).map((r) => ({
      currency: r.currency as string,
      win: r.win as 'cur' | 'prev',
      total: big(r.total),
    }));
  }

  /** Invoices that became paid in the window. */
  async paidInvoices(tx: Tx, f: DashFilter, scope: SQL | undefined, cur: Span): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM invoices i
      WHERE ${where([
        sql`i.org_id = ${f.orgId}`,
        sql`i.payment_status = 'paid'`,
        sql`i.paid_at >= ${iso(cur.from)}::timestamptz`,
        sql`i.paid_at < ${iso(cur.to)}::timestamptz`,
        scope,
        ...this.invoiceFilter(f),
      ])}
    `);
    return int((res.rows[0] as Raw | undefined)?.n);
  }

  async recentPayments(
    tx: Tx,
    f: DashFilter,
    scope: SQL | undefined,
    limit: number,
  ): Promise<
    Array<{
      uuid: string;
      amount: bigint;
      currency: string;
      paidAt: Date;
      contactUuid: string | null;
      contactName: string | null;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT p.uuid, p.amount_minor::text AS amount, p.currency, p.paid_at, c.uuid AS contact_uuid, c.name AS contact_name
      FROM payments p
      LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
      LEFT JOIN contacts c ON c.org_id = p.org_id AND c.id = p.contact_id
      WHERE ${where([
        sql`p.org_id = ${f.orgId}`,
        sql`p.kind = 'payment'`,
        scope,
        ...this.invoiceFilter(f),
      ])}
      ORDER BY p.paid_at DESC, p.id DESC LIMIT ${limit}
    `);
    return (res.rows as Raw[]).map((r) => ({
      uuid: r.uuid as string,
      amount: big(r.amount),
      currency: r.currency as string,
      paidAt: new Date(r.paid_at as string),
      contactUuid: (r.contact_uuid as string | null) ?? null,
      contactName: (r.contact_name as string | null) ?? null,
    }));
  }
}
