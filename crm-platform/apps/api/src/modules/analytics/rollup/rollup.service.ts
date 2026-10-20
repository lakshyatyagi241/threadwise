import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../../infra/db/database.service';
import { ROLLUP_RULES } from './rollup-rules';
import {
  bucketExpr,
  recordedWindow,
  rollupSelect,
  rollupUpsert,
  type Grain,
  type Scope,
} from './rollup-sql';

/** Stable lock key shared by the rollup pass and the nightly reconcile so the two never overlap. */
export const ROLLUP_LOCK_KEY = 4_271_993_077;
/** Events newer than this are left for the next pass: it must exceed the longest transaction that can still commit an event. */
export const ROLLUP_LAG_MS = 60_000;
/** One slice never spans more than this much `recorded_at` time, so a catch-up stays inside the statement timeout. */
export const ROLLUP_SLICE_MS = 10 * 60_000;

/** The one thing the service needs from the database layer; `DatabaseService` satisfies it and tests hand in a plain adapter. */
export interface Privileged {
  privileged<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface RollupPass {
  /** Watermark before the pass and after it. */
  from: Date;
  to: Date;
  /** How many slices actually contained events. 0 = nothing new. */
  slices: number;
}

type Step =
  { kind: 'busy' } | { kind: 'ran'; done: boolean; worked: boolean; from: Date; to: Date };

/**
 * Folds `an_events` into the hour and day rollups (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 4.4).
 *
 * Every event with `recorded_at` below the watermark (`an_rollup_state`) is already counted. A pass adds the events in
 * `[watermark, now - lag)` and moves the watermark, in one transaction per slice, under an advisory lock. Late events (old `occurred_at`,
 * new `recorded_at`) simply add to an older bucket. Replaying is impossible because the watermark moves with the upsert.
 */
@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(@Inject(DatabaseService) private readonly db: Privileged) {}

  /**
   * Runs slices until the watermark reaches `upTo` (default: now minus the lag, read from the database clock).
   * Returns null when another worker holds the lock and nothing was done.
   */
  async runOnce(opts: { upTo?: Date } = {}): Promise<RollupPass | null> {
    let first: Date | null = null;
    let last: Date | null = null;
    let slices = 0;
    for (;;) {
      const step = await this.db.privileged((tx) => this.slice(tx, opts.upTo));
      if (step.kind === 'busy') {
        return slices === 0 ? null : { from: first!, to: last!, slices };
      }
      first ??= step.from;
      last = step.to;
      if (step.worked) slices += 1;
      if (step.done) break;
    }
    return { from: first!, to: last!, slices };
  }

  private async slice(tx: Tx, upTo?: Date): Promise<Step> {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${ROLLUP_LOCK_KEY}) AS ok`);
    if (!(lock.rows[0] as { ok: boolean }).ok) return { kind: 'busy' };

    const state = await tx.execute(
      sql`SELECT recorded_before FROM an_rollup_state WHERE name = 'main' FOR UPDATE`,
    );
    const from = new Date((state.rows[0] as { recorded_before: Date | string }).recorded_before);
    const limit = upTo ?? (await this.databaseNow(tx, ROLLUP_LAG_MS));
    if (from >= limit) return { kind: 'ran', done: true, worked: false, from, to: from };

    // Jump over quiet stretches: a catch-up after downtime must not walk empty ten-minute slices.
    const next = await tx.execute(
      sql`SELECT min(recorded_at) AS t FROM an_events
           WHERE recorded_at >= ${from.toISOString()}::timestamptz AND recorded_at < ${limit.toISOString()}::timestamptz`,
    );
    const firstAt = (next.rows[0] as { t: Date | string | null }).t;
    if (firstAt === null) {
      await this.moveWatermark(tx, limit);
      return { kind: 'ran', done: true, worked: false, from, to: limit };
    }

    const to = new Date(Math.min(limit.getTime(), new Date(firstAt).getTime() + ROLLUP_SLICE_MS));
    const window = recordedWindow(from, to);
    for (const rule of ROLLUP_RULES) {
      const scopes: Scope[] = rule.platform ? ['org', 'platform'] : ['org'];
      for (const grain of ['hour', 'day'] as Grain[]) {
        for (const scope of scopes) await tx.execute(rollupUpsert(rule, grain, scope, window));
      }
    }
    await this.moveWatermark(tx, to);
    return { kind: 'ran', done: to >= limit, worked: true, from, to };
  }

  private async moveWatermark(tx: Tx, to: Date): Promise<void> {
    await tx.execute(
      sql`UPDATE an_rollup_state SET recorded_before = ${to.toISOString()}::timestamptz, updated_at = now() WHERE name = 'main'`,
    );
  }

  /** The database clock minus the lag: the same clock that stamps `recorded_at`, so app and database clocks never disagree. */
  private async databaseNow(tx: Tx, lagMs: number): Promise<Date> {
    const r = await tx.execute(
      sql`SELECT (clock_timestamp() - interval '1 millisecond' * ${lagMs}) AS t`,
    );
    return new Date((r.rows[0] as { t: Date | string }).t);
  }

  /**
   * Recomputes one workspace-local day of the day rollups from the events the watermark already covers, and replaces any row that
   * differs (drifted, missing or stray). Takes the pass lock, so it never races a pass. It looks at events recorded from two days before
   * the day, which covers late events in practice; a business event that arrives more than two days late is not re-verified.
   * Returns how many rows it had to fix.
   */
  async reconcile(day: string): Promise<{ fixedRows: number }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`reconcile: bad day ${day}`);
    return this.db.privileged(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ROLLUP_LOCK_KEY})`);
      const state = await tx.execute(
        sql`SELECT recorded_before FROM an_rollup_state WHERE name = 'main'`,
      );
      const watermark = new Date(
        (state.rows[0] as { recorded_before: Date | string }).recorded_before,
      );
      let fixedRows = 0;
      for (const rule of ROLLUP_RULES) {
        const scopes: Scope[] = rule.platform ? ['org', 'platform'] : ['org'];
        for (const scope of scopes) {
          const window = sql`e.recorded_at >= ${day}::date - interval '2 days'
            AND e.recorded_at < ${watermark.toISOString()}::timestamptz
            AND e.occurred_at >= ${day}::date - interval '1 day'
            AND e.occurred_at < ${day}::date + interval '2 days'
            AND ${bucketExpr('day', scope)} = ${day}::date`;
          await tx.execute(sql`DROP TABLE IF EXISTS an_recompute`);
          await tx.execute(
            sql`CREATE TEMP TABLE an_recompute ON COMMIT DROP AS ${rollupSelect(rule, 'day', scope, window)}`,
          );
          const platform = scope === 'platform';
          const diff = await tx.execute(sql`
            SELECT count(*)::int AS c
              FROM (SELECT org_id, d1, d2, d3, n, s1, s2 FROM an_rollup_day
                     WHERE metric = ${rule.metric} AND bucket = ${day}::date AND (org_id = 0) = ${platform}) s
              FULL JOIN an_recompute f ON s.org_id = f.org_id AND s.d1 = f.d1 AND s.d2 = f.d2 AND s.d3 = f.d3
             WHERE s.org_id IS NULL OR f.org_id IS NULL OR s.n <> f.n OR s.s1 <> f.s1 OR s.s2 <> f.s2`);
          const changed = Number((diff.rows[0] as { c: number }).c);
          if (changed === 0) continue;
          fixedRows += changed;
          await tx.execute(sql`
            DELETE FROM an_rollup_day
             WHERE metric = ${rule.metric} AND bucket = ${day}::date AND (org_id = 0) = ${platform}`);
          await tx.execute(sql`
            INSERT INTO an_rollup_day (org_id, metric, bucket, d1, d2, d3, n, s1, s2)
            SELECT org_id, metric, bucket, d1, d2, d3, n, s1, s2 FROM an_recompute`);
        }
      }
      return { fixedRows };
    });
  }

  /**
   * Rebuilds the base message rollups of the last `days` days for every workspace (`an_msg_feed_rebuild_base`). Only the part before the
   * cut-over is rebuilt, so it picks up the later status changes of messages that pre-date the event writer, and is a no-op once the
   * cut-over is more than `days` old. One workspace per transaction; a failing workspace is logged and skipped. Returns how many failed.
   */
  async rebuildMessageBase(days: number): Promise<number> {
    if (!Number.isInteger(days) || days < 1)
      throw new Error(`rebuildMessageBase: bad days ${days}`);
    const orgs = await this.db.privileged(
      async (tx) => (await tx.execute(sql`SELECT id FROM organizations ORDER BY id`)).rows,
    );
    let failed = 0;
    for (const row of orgs as Array<{ id: string | number }>) {
      try {
        await this.db.privileged((tx) =>
          tx.execute(sql`SELECT an_msg_feed_rebuild_base(
            ${Number(row.id)}, now() - interval '1 day' * ${days}, now())`),
        );
      } catch (err) {
        failed++;
        this.logger.error({ err, orgId: row.id }, 'message base rebuild failed');
      }
    }
    return failed;
  }

  /** Deletes hour rows older than `retentionDays` in batches of 10,000 (day rows are kept forever). Returns how many it deleted. */
  async trimHourRows(retentionDays: number): Promise<number> {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error(`trimHourRows: bad retention ${retentionDays}`);
    }
    let total = 0;
    for (;;) {
      const deleted = await this.db.privileged(async (tx) => {
        const r = await tx.execute(sql`
          DELETE FROM an_rollup_hour
           WHERE ctid IN (SELECT ctid FROM an_rollup_hour
                           WHERE bucket < now() - make_interval(days => ${retentionDays}) LIMIT 10000)`);
        return r.rowCount ?? 0;
      });
      total += deleted;
      if (deleted < 10_000) return total;
    }
  }

  /** Watermark age in seconds, for the health check and the stalled-worker warning. */
  async watermarkAgeSeconds(): Promise<number> {
    return this.db.privileged(async (tx) => {
      const r = await tx.execute(
        sql`SELECT extract(epoch FROM clock_timestamp() - recorded_before)::float AS age
              FROM an_rollup_state WHERE name = 'main'`,
      );
      return Number((r.rows[0] as { age: number }).age);
    });
  }
}
