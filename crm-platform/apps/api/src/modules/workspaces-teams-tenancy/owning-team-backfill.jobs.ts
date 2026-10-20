import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';

/** Rows stamped per transaction: small enough to keep every transaction (and its row locks) short. */
export const OWNING_TEAM_BATCH = 500;
/** Batches one job runs before it hands the rest to a continuation, so one job never holds a worker for a whole large installation. */
const BATCHES_PER_JOB = 100;
const CONTINUE_DELAY_MS = 2_000;

/** The four tables that carry `owning_team_id`, with the column that names the person who owns the row (BL-382, decision D8). */
export const OWNING_TEAM_TABLES = [
  { table: 'contacts', owner: 'owner_id' },
  { table: 'companies', owner: 'owner_id' },
  { table: 'deals', owner: 'owner_user_id' },
  { table: 'tasks', owner: 'assignee_id' },
] as const;
export type OwningTeamTable = (typeof OWNING_TEAM_TABLES)[number]['table'];

export interface OwningTeamBackfillJob {
  table: OwningTeamTable;
  /** Resume after this (org_id, id); (0, 0) is the start of the table. */
  afterOrg: number;
  afterId: number;
}

export interface OwningTeamBackfillReport {
  scanned: number;
  stamped: number;
  /** Where to continue, or null when the table has been looked at to its end. */
  next: { afterOrg: number; afterId: number } | null;
}

interface BatchRow {
  scanned: number;
  stamped: number;
  last_org: string | number | null;
  last_id: string | number | null;
}

/**
 * Stamps `owning_team_id` on the records that existed before the column did (BL-382, decision D8): the owner's primary team, NULL when
 * the owner has none. New and re-assigned records are stamped by the database trigger `stamp_owning_team`; this only covers history.
 *
 * Why a worker job and not the migration: one UPDATE over a large table holds its row locks until the migration commits and would move
 * `updated_at` and `row_version` of every record. This stamps 500 rows per transaction, in (org_id, id) order, and the trigger keeps
 * `updated_at` and `row_version` unchanged for it (the session setting `app.owning_team_backfill`).
 *
 * Privileged and cross-workspace on purpose (the same shape as the other back-fills): a row only ever receives a team of its OWN
 * workspace (`owner_primary_team(org_id, owner)`). Idempotent: a row already stamped is skipped, and a row stamped at the same moment
 * by the trigger is left alone. A record whose owner has no primary team stays NULL.
 */
@Injectable()
export class OwningTeamBackfillService {
  constructor(private readonly db: DatabaseService) {}

  /** One batch of `table` after `(afterOrg, afterId)`. */
  async runBatch(
    table: OwningTeamTable,
    afterOrg: number,
    afterId: number,
    limit = OWNING_TEAM_BATCH,
  ): Promise<BatchRow> {
    const spec = OWNING_TEAM_TABLES.find((t) => t.table === table);
    if (!spec) throw new Error(`owning_team_id back-fill: unknown table ${table}`);
    // Identifiers come from the closed list above, never from a job payload.
    const t: SQL = sql.raw(`"${spec.table}"`);
    const owner: SQL = sql.raw(`"${spec.owner}"`);
    return this.db.privileged(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.owning_team_backfill', 'on', true)`);
      const res = await tx.execute(sql`
        WITH batch AS (
          SELECT x.org_id, x.id, x.${owner} AS owner_ref
          FROM ${t} x
          WHERE (x.org_id, x.id) > (${afterOrg}, ${afterId})
            AND x.${owner} IS NOT NULL AND x.owning_team_id IS NULL
          ORDER BY x.org_id, x.id
          LIMIT ${limit}
        ), stamped AS (
          UPDATE ${t} x SET owning_team_id = owner_primary_team(b.org_id, b.owner_ref)
          FROM batch b
          WHERE x.org_id = b.org_id AND x.id = b.id AND x.owning_team_id IS NULL
            AND owner_primary_team(b.org_id, b.owner_ref) IS NOT NULL
          RETURNING 1
        ), last_row AS (
          SELECT org_id, id FROM batch ORDER BY org_id DESC, id DESC LIMIT 1
        )
        SELECT (SELECT count(*) FROM batch)::int AS scanned,
               (SELECT count(*) FROM stamped)::int AS stamped,
               (SELECT org_id FROM last_row) AS last_org,
               (SELECT id FROM last_row) AS last_id
      `);
      return res.rows[0] as unknown as BatchRow;
    });
  }

  /** Batches until the end of the table or `maxBatches`; `next` says where to resume when it stopped early. */
  async run(
    table: OwningTeamTable,
    afterOrg = 0,
    afterId = 0,
    maxBatches = Number.POSITIVE_INFINITY,
    limit = OWNING_TEAM_BATCH,
  ): Promise<OwningTeamBackfillReport> {
    let org = afterOrg;
    let id = afterId;
    let scanned = 0;
    let stamped = 0;
    for (let i = 0; i < maxBatches; i++) {
      const batch = await this.runBatch(table, org, id, limit);
      scanned += Number(batch.scanned);
      stamped += Number(batch.stamped);
      if (batch.last_org === null || batch.last_id === null || Number(batch.scanned) < limit) {
        return { scanned, stamped, next: null };
      }
      org = Number(batch.last_org);
      id = Number(batch.last_id);
    }
    return { scanned, stamped, next: { afterOrg: org, afterId: id } };
  }
}

/**
 * Queues the back-fill when the worker starts: one job per table. The job ids are fixed and a finished job is kept, so it runs once per
 * Redis (several workers starting together queue one, a later start finds the finished jobs and queues nothing). A flushed Redis queues
 * it again, which finds nothing left to stamp.
 */
@Injectable()
export class OwningTeamBackfillScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(OwningTeamBackfillScheduler.name);

  constructor(
    @InjectQueue(QUEUES.OWNING_TEAM_BACKFILL) private readonly queue: Queue<OwningTeamBackfillJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const { table } of OWNING_TEAM_TABLES) {
        await this.enqueue({ table, afterOrg: 0, afterId: 0 });
      }
    } catch (err) {
      // A queue that is down must not stop the worker from starting; the next start tries again.
      this.logger.error({ err: String(err) }, '[BL-382] owning team back-fill not queued');
    }
  }

  async enqueue(job: OwningTeamBackfillJob, delayMs = 0): Promise<void> {
    const start = job.afterOrg === 0 && job.afterId === 0;
    const jobId = start
      ? `owning-team-backfill-${job.table}`
      : `owning-team-backfill-${job.table}-after-${job.afterOrg}-${job.afterId}`;
    // A job that failed is kept for days under its id, which would make BullMQ ignore every later start: clear it first.
    if ((await this.queue.getJobState(jobId)) === 'failed') {
      await (await this.queue.getJob(jobId))?.remove();
    }
    await this.queue.add('backfill', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      // The first job of a table is kept when it finishes, so a restart does not scan the table again; continuations are not.
      removeOnComplete: !start,
      removeOnFail: { age: 7 * 24 * 3600 },
      delay: delayMs,
      jobId,
    });
  }
}

/** Runs the back-fill; a long one continues in a new job so a restart or a crash loses at most a batch. */
@Processor(QUEUES.OWNING_TEAM_BACKFILL, { concurrency: 1 })
export class OwningTeamBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(OwningTeamBackfillProcessor.name);

  constructor(
    private readonly backfill: OwningTeamBackfillService,
    private readonly scheduler: OwningTeamBackfillScheduler,
  ) {
    super();
  }

  async process(job: Job<OwningTeamBackfillJob>): Promise<OwningTeamBackfillReport> {
    const { table, afterOrg, afterId } = job.data;
    const report = await this.backfill.run(table, afterOrg ?? 0, afterId ?? 0, BATCHES_PER_JOB);
    if (report.stamped > 0 || report.next !== null) {
      this.logger.log({ table, ...report }, '[BL-382] owning team back-fill');
    }
    if (report.next !== null) {
      await this.scheduler.enqueue({ table, ...report.next }, CONTINUE_DELAY_MS);
    }
    return report;
  }
}
