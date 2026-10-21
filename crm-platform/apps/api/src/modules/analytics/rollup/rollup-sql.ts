import { sql, type SQL } from 'drizzle-orm';
import { LATENCY_EDGES_MS } from '@crm/contracts';
import type { RollupRule } from './rollup-rules';

export type Grain = 'hour' | 'day';
/** `org` writes one row set per workspace in its own timezone; `platform` writes org_id 0 rows across workspaces in UTC. */
export type Scope = 'org' | 'platform';

/**
 * The workspace timezone, or UTC when it is missing or not a zone Postgres knows. The setting is free text up to 64 characters, and an
 * unknown name makes AT TIME ZONE fail the whole statement: one bad value must never stall the rollup for every other workspace.
 * (pg_timezone_names lists full names such as Asia/Kolkata; an abbreviation like IST is treated as unknown and falls back to UTC.)
 */
const ORG_TZ = sql`coalesce(tz.name, 'UTC')`;
const UTC_TZ = sql`'UTC'`;

const int = (n: number): SQL => {
  if (!Number.isInteger(n)) throw new Error(`not an integer: ${n}`);
  return sql.raw(String(n));
};

/** The bucket an event falls in: the workspace-local hour (as an instant) or the workspace-local date. */
export function bucketExpr(grain: Grain, scope: Scope): SQL {
  const tz = scope === 'org' ? ORG_TZ : UTC_TZ;
  return grain === 'hour'
    ? sql`(date_trunc('hour', e.occurred_at AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`
    : sql`(date_trunc('day', e.occurred_at AT TIME ZONE ${tz}))::date`;
}

function histCase(col: 'duration_ms'): SQL {
  const whens = LATENCY_EDGES_MS.map((edge, i) => `WHEN e.${col} < ${edge} THEN ${i}`).join(' ');
  return sql.raw(
    `(CASE WHEN e.${col} IS NULL THEN 0 ${whens} ELSE ${LATENCY_EDGES_MS.length} END)::bigint`,
  );
}

function dimExpr(rule: RollupRule, i: 0 | 1 | 2, leaving = false): SQL {
  if (rule.histOn && i === 2) return histCase(rule.histOn);
  // the leaving half of a paired rule groups by the state the event left instead of the state it entered
  const col = leaving && i === 0 ? rule.paired : rule.dims[i];
  if (col === 'feed_class')
    return sql`(coalesce(e.source_kind, 0) * 16 + coalesce(e.k1, 0))::bigint`;
  return col ? sql`coalesce(e.${sql.raw(col)}, 0)::bigint` : sql`0::bigint`;
}

const total = (col?: string): SQL =>
  col ? sql`coalesce(sum(e.${sql.raw(col)}), 0)::bigint` : sql`0::bigint`;

/**
 * The grouped aggregate of one rule over one window of events. Shared by the worker (INSERT ... SELECT) and the query tail so the two can
 * never disagree about what a bucket means.
 */
function rollupSelectOnce(
  rule: RollupRule,
  grain: Grain,
  scope: Scope,
  window: SQL,
  leaving: boolean,
): SQL {
  const org = scope === 'org' ? sql`e.org_id` : sql`0::bigint`;
  const types = sql.join(
    rule.types.map((t) => int(t)),
    sql`, `,
  );
  const where = rule.where ? sql` AND ${sql.raw(rule.where)}` : sql``;
  const extra = leaving ? sql`${where} AND e.${sql.raw(rule.paired!)} IS NOT NULL` : where;
  const join =
    scope === 'org'
      ? sql`LEFT JOIN workspace_settings ws ON ws.org_id = e.org_id
      LEFT JOIN pg_timezone_names tz ON tz.name = ws.timezone`
      : sql``;
  return sql`
    SELECT ${org} AS org_id, ${int(rule.metric)}::smallint AS metric, ${bucketExpr(grain, scope)} AS bucket,
           ${dimExpr(rule, 0, leaving)} AS d1, ${dimExpr(rule, 1)} AS d2, ${dimExpr(rule, 2)} AS d3,
           ${rule.n === 'qty' ? sql`${leaving ? sql`-` : sql``}coalesce(sum(e.qty), 0)` : sql`count(*)`}::bigint AS n,
           ${total(rule.s1)} AS s1, ${total(rule.s2)} AS s2
      FROM an_events e
      ${join}
     WHERE e.type IN (${types})${extra} AND ${window}
     GROUP BY 1, 2, 3, 4, 5, 6`;
}

export function rollupSelect(rule: RollupRule, grain: Grain, scope: Scope, window: SQL): SQL {
  if (!rule.paired) return rollupSelectOnce(rule, grain, scope, window, false);
  if (rule.n !== 'qty' || rule.dims[0] !== 'status' || rule.histOn) {
    throw new Error(
      `rollup rule ${rule.metric}: a paired rule needs n: 'qty' and the entered state in dims[0]`,
    );
  }
  return sql`
    SELECT org_id, metric, bucket, d1, d2, d3, sum(n)::bigint AS n, sum(s1)::bigint AS s1, sum(s2)::bigint AS s2
      FROM (${rollupSelectOnce(rule, grain, scope, window, false)}
            UNION ALL
            ${rollupSelectOnce(rule, grain, scope, window, true)}) u
     GROUP BY 1, 2, 3, 4, 5, 6`;
}

export function recordedWindow(from: Date, to: Date): SQL {
  return sql`e.recorded_at >= ${from.toISOString()}::timestamptz AND e.recorded_at < ${to.toISOString()}::timestamptz`;
}

/** Adds a slice to the rollup table. Replaying the same slice is prevented by the watermark, not by this statement. */
export function rollupUpsert(rule: RollupRule, grain: Grain, scope: Scope, window: SQL): SQL {
  const table = sql.raw(grain === 'hour' ? 'an_rollup_hour' : 'an_rollup_day');
  return sql`
    INSERT INTO ${table} (org_id, metric, bucket, d1, d2, d3, n, s1, s2)
    ${rollupSelect(rule, grain, scope, window)}
    ON CONFLICT (org_id, metric, bucket, d1, d2, d3) DO UPDATE
      SET n = ${table}.n + excluded.n, s1 = ${table}.s1 + excluded.s1, s2 = ${table}.s2 + excluded.s2`;
}
