import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { METRICS, type MetricDef, type MetricId } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { RULE_BY_METRIC } from '../rollup/rollup-rules';
import { rollupSelect, type Grain, type Scope } from '../rollup/rollup-sql';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('analytics_query');

export type SeriesDim = 'bucket' | 'd1' | 'd2' | 'd3';

export interface SeriesQuery {
  /** The workspace, or 0 for the platform-wide rows (privileged transactions only). */
  orgId: number;
  metric: MetricId;
  grain: Grain;
  /** Hour grain: an ISO instant. Day grain: 'YYYY-MM-DD' (the workspace-local date). `to` is exclusive. */
  from: string;
  to: string;
  filter?: { d1?: number; d2?: number; d3?: number };
  /** Default ['bucket']. */
  groupBy?: ReadonlyArray<SeriesDim>;
}

export interface SeriesRow {
  bucket?: string;
  d1?: number;
  d2?: number;
  d3?: number;
  n: number;
  s1: number;
  s2: number;
}

const METRIC_BY_ID: ReadonlyMap<MetricId, MetricDef> = new Map(METRICS.map((m) => [m.id, m]));
const DAY_MS = 86_400_000;
const GROUP_COLUMNS: ReadonlySet<string> = new Set(['bucket', 'd1', 'd2', 'd3']);

function parseInstant(value: string, grain: Grain): number {
  const ms = Date.parse(grain === 'day' ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(ms)) throw new RangeError(`analytics window: cannot read "${value}"`);
  return ms;
}

function assertWindow(q: SeriesQuery, windowDaysMax: number): void {
  const days = (parseInstant(q.to, q.grain) - parseInstant(q.from, q.grain)) / DAY_MS;
  if (!(days > 0) || days > windowDaysMax) {
    throw new RangeError(
      `analytics window must be longer than 0 and at most ${windowDaysMax} days, got ${days}`,
    );
  }
}

const cast = (grain: Grain): SQL => (grain === 'hour' ? sql`timestamptz` : sql`date`);

/**
 * Reads a metric over a range (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 4.5): the rollup rows below the
 * watermark plus an aggregate of the events recorded since, in one statement, so a pass committing in between can neither double count nor
 * drop an event. It runs in the caller's transaction, so a workspace only ever sees its own rows.
 */
@Injectable()
export class AnalyticsQueryService {
  private readonly logger = new Logger(AnalyticsQueryService.name);
  private readonly inFlight = new Map<string, Promise<SeriesRow[]>>();

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Pick<Redis, 'get' | 'set'>,
  ) {}

  /**
   * The workspace asked for must be the one the transaction belongs to, unless the transaction is privileged (a worker, the operator
   * console). Row-level security already hides other workspaces from a live query, but a cache hit never reaches the database, so the
   * check runs on every call, hit or miss: a caller that forwards a client-chosen workspace id can never read someone else's numbers.
   */
  private async assertScope(tx: Tx, orgId: number): Promise<void> {
    const r = await tx.execute(sql`SELECT current_org_id() AS org, app_is_privileged() AS priv`);
    const row = r.rows[0] as { org: number | string | null; priv: boolean };
    if (row.priv) return;
    if (orgId === 0) throw new Error('analytics platform rows need a privileged transaction');
    if (row.org === null || Number(row.org) !== orgId) {
      throw new Error(
        'analytics: the workspace asked for is not the one this transaction belongs to',
      );
    }
  }

  async series(
    tx: Tx,
    q: SeriesQuery,
    opts: { scopeChecked?: boolean } = {},
  ): Promise<SeriesRow[]> {
    const def = METRIC_BY_ID.get(q.metric);
    const rule = RULE_BY_METRIC.get(q.metric);
    if (!def || !rule) throw new RangeError(`unknown analytics metric ${String(q.metric)}`);
    if (!Number.isInteger(q.orgId) || q.orgId < 0) throw new RangeError('analytics orgId');
    // TypeScript's unions are gone at runtime and these values reach `sql.raw`, so check them here, before any SQL is built.
    if (q.grain !== 'hour' && q.grain !== 'day') throw new RangeError('analytics grain');
    const groupBy = q.groupBy ?? ['bucket'];
    if (
      groupBy.length === 0 ||
      new Set(groupBy).size !== groupBy.length ||
      !groupBy.every((g) => GROUP_COLUMNS.has(g))
    ) {
      throw new RangeError('analytics group by must be distinct columns of bucket, d1, d2, d3');
    }
    assertWindow(q, def.windowDaysMax);
    if (!opts.scopeChecked) await this.assertScope(tx, q.orgId);

    const scope: Scope = q.orgId === 0 ? 'platform' : 'org';

    const table = sql.raw(q.grain === 'hour' ? 'an_rollup_hour' : 'an_rollup_day');
    const watermark = sql`(SELECT recorded_before FROM an_rollup_state WHERE name = 'main')`;
    const tailWindow =
      scope === 'platform'
        ? sql`e.recorded_at >= ${watermark}`
        : sql`e.org_id = ${q.orgId} AND e.recorded_at >= ${watermark}`;
    const range = sql`bucket >= ${q.from}::${cast(q.grain)} AND bucket < ${q.to}::${cast(q.grain)}`;
    const filter = sql.join(
      (['d1', 'd2', 'd3'] as const).flatMap((d) => {
        const v = q.filter?.[d];
        if (v === undefined) return [];
        if (!Number.isSafeInteger(v)) throw new RangeError(`analytics filter ${d}`);
        return [sql` AND ${sql.raw(d)} = ${v}`];
      }),
      sql``,
    );

    const bucketText =
      q.grain === 'hour'
        ? sql`to_char(bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
        : sql`bucket::text`;
    const selectCols = sql.join(
      groupBy.map((g) =>
        g === 'bucket' ? sql`${bucketText} AS bucket` : sql`${sql.raw(g)} AS ${sql.raw(g)}`,
      ),
      sql`, `,
    );
    const positions = sql.raw(groupBy.map((_, i) => String(i + 1)).join(', '));

    const result = await tx.execute(sql`
      SELECT ${selectCols}, sum(n)::bigint AS n, sum(s1)::bigint AS s1, sum(s2)::bigint AS s2
        FROM (
          SELECT bucket, d1, d2, d3, n, s1, s2 FROM ${table}
           WHERE org_id = ${q.orgId} AND metric = ${q.metric} AND ${range}${filter}
          UNION ALL
          SELECT bucket, d1, d2, d3, n, s1, s2
            FROM (${rollupSelect(rule, q.grain, scope, tailWindow)}) t
           WHERE ${range}${filter}
        ) u
       GROUP BY ${positions}
       ORDER BY ${positions}`);

    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      const out: SeriesRow = { n: Number(r.n), s1: Number(r.s1), s2: Number(r.s2) };
      if (groupBy.includes('bucket')) out.bucket = String(r.bucket);
      for (const d of ['d1', 'd2', 'd3'] as const) if (groupBy.includes(d)) out[d] = Number(r[d]);
      return out;
    });
  }

  /**
   * `series` behind a Redis cache keyed by workspace and query, with one shared execution for concurrent identical calls. A cache failure
   * is logged and ignored: the answer is simply computed. `ttlSeconds <= 0` skips the cache entirely.
   */
  async seriesCached(tx: Tx, q: SeriesQuery, opts: { ttlSeconds: number }): Promise<SeriesRow[]> {
    if (opts.ttlSeconds <= 0) return this.series(tx, q);
    // Before the cache is touched: a cached answer must never go to a transaction that may not read this workspace.
    await this.assertScope(tx, q.orgId);
    const key = `an:v1:${q.orgId}:${q.metric}:${q.grain}:${createHash('sha256').update(JSON.stringify(q)).digest('hex')}`;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const run = (async () => {
      const hit = await this.cacheGet(key);
      if (hit) return hit;
      const rows = await this.series(tx, q, { scopeChecked: true });
      await this.cacheSet(key, rows, opts.ttlSeconds);
      return rows;
    })();
    this.inFlight.set(key, run);
    try {
      return await run;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async cacheGet(key: string): Promise<SeriesRow[] | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      if (raw) cache.hit();
      else cache.miss();
      return raw ? (JSON.parse(raw) as SeriesRow[]) : null;
    } catch (err) {
      cache.error();
      cache.miss();
      this.logger.warn({ err }, 'analytics cache read failed');
      return null;
    }
  }

  private async cacheSet(key: string, rows: SeriesRow[], ttlSeconds: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(rows), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn({ err }, 'analytics cache write failed');
    }
  }
}
