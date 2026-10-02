import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** What every report query shares: the workspace, the caller's record scope, and the pipeline / owner filters. */
export interface ReportBase {
  orgId: number;
  scope?: SQL;
  pipelineId?: number;
  ownerId?: number;
}

export interface CurrencyCount {
  currency: string;
  n: number;
  total: bigint;
}

type Raw = Record<string, unknown>;

const conds = (b: ReportBase, ...extra: SQL[]): SQL => {
  const list: SQL[] = [sql`d.org_id = ${b.orgId}`];
  if (b.scope) list.push(b.scope);
  if (b.pipelineId !== undefined) list.push(sql`d.pipeline_id = ${b.pipelineId}`);
  if (b.ownerId !== undefined) list.push(sql`d.owner_user_id = ${b.ownerId}`);
  list.push(...extra);
  return sql.join(list, sql` AND `);
};

const toCount = (r: Raw): CurrencyCount => ({
  currency: r.currency as string,
  n: Number(r.n),
  total: BigInt(r.total as string),
});

/** [from, to] in the workspace zone as timestamptz bounds, for one of the closing columns. */
export function closedBetween(
  column: 'won_at' | 'lost_at',
  tz: string,
  from?: string,
  to?: string,
): SQL[] {
  const col = sql.raw(`d.${column}`);
  const out: SQL[] = [];
  if (from) out.push(sql`${col} >= (${from}::date)::timestamp AT TIME ZONE ${tz}`);
  if (to) out.push(sql`${col} < ((${to}::date + 1))::timestamp AT TIME ZONE ${tz}`);
  return out;
}

/** Grouped queries behind the board's KPI strip and the reports page. Every sum is per currency, never mixed. */
@Injectable()
export class DealReportsRepository {
  /** Open deals per stage and currency. */
  async openByStage(tx: Tx, b: ReportBase): Promise<Array<CurrencyCount & { stageId: number }>> {
    const res = await tx.execute(sql`
      SELECT d.stage_id, d.currency, count(*)::int AS n, sum(d.value_minor)::text AS total
      FROM deals d WHERE ${conds(b, sql`d.status = 'open'`)}
      GROUP BY d.stage_id, d.currency
    `);
    return (res.rows as Raw[]).map((r) => ({ ...toCount(r), stageId: Number(r.stage_id) }));
  }

  /** Won or lost deals closed in the window, per currency; won also carries the days-to-close sum. */
  async closed(
    tx: Tx,
    b: ReportBase,
    kind: 'won' | 'lost',
    window: SQL[],
  ): Promise<Array<CurrencyCount & { daysSum: number }>> {
    const res = await tx.execute(sql`
      SELECT d.currency, count(*)::int AS n, sum(d.value_minor)::text AS total,
             coalesce(sum(extract(epoch FROM (d.${sql.raw(kind === 'won' ? 'won_at' : 'lost_at')} - d.created_at)) / 86400), 0)::float8 AS days_sum
      FROM deals d WHERE ${conds(b, sql`d.status = ${kind}`, ...window)}
      GROUP BY d.currency
    `);
    return (res.rows as Raw[]).map((r) => ({ ...toCount(r), daysSum: Number(r.days_sum) }));
  }

  /** Closed deals per calendar month (in the workspace zone) and currency, over a window of months. */
  async byMonth(
    tx: Tx,
    b: ReportBase,
    tz: string,
    firstDay: string,
    endExclusive: string,
  ): Promise<Array<{ kind: 'won' | 'lost'; month: string } & CurrencyCount>> {
    const res = await tx.execute(sql`
      SELECT d.status AS kind, d.currency,
             to_char(coalesce(d.won_at, d.lost_at) AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
             count(*)::int AS n, sum(d.value_minor)::text AS total
      FROM deals d
      WHERE ${conds(
        b,
        sql`d.status IN ('won', 'lost')`,
        sql`coalesce(d.won_at, d.lost_at) >= (${firstDay}::date)::timestamp AT TIME ZONE ${tz}`,
        sql`coalesce(d.won_at, d.lost_at) < (${endExclusive}::date)::timestamp AT TIME ZONE ${tz}`,
      )}
      GROUP BY d.status, d.currency, month
    `);
    return (res.rows as Raw[]).map((r) => ({
      ...toCount(r),
      kind: r.kind as 'won' | 'lost',
      month: r.month as string,
    }));
  }

  /** Won deals per owner and currency, owners that still exist only. */
  async leaders(
    tx: Tx,
    b: ReportBase,
    window: SQL[],
  ): Promise<Array<{ ownerUuid: string; ownerName: string } & CurrencyCount>> {
    const res = await tx.execute(sql`
      SELECT u.uuid AS owner_uuid, u.full_name AS owner_name, d.currency, count(*)::int AS n, sum(d.value_minor)::text AS total
      FROM deals d JOIN users u ON u.org_id = d.org_id AND u.id = d.owner_user_id
      WHERE ${conds(b, sql`d.status = 'won'`, ...window)}
      GROUP BY u.uuid, u.full_name, d.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      ...toCount(r),
      ownerUuid: r.owner_uuid as string,
      ownerName: r.owner_name as string,
    }));
  }

  async lostReasons(
    tx: Tx,
    b: ReportBase,
    window: SQL[],
  ): Promise<Array<{ reason: string | null; n: number }>> {
    const res = await tx.execute(sql`
      SELECT d.lost_reason AS reason, count(*)::int AS n
      FROM deals d WHERE ${conds(b, sql`d.status = 'lost'`, ...window)}
      GROUP BY d.lost_reason ORDER BY n DESC, reason NULLS LAST LIMIT 20
    `);
    return (res.rows as Raw[]).map((r) => ({
      reason: (r.reason as string | null) ?? null,
      n: Number(r.n),
    }));
  }
}
