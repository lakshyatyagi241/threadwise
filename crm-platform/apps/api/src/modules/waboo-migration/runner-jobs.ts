import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { WMIG_RUNNER_ONLINE_SECONDS, type WabooMigrationRunnerJob } from '@crm/contracts';
import { AuthAuditService, PlatformStore } from '../auth';
import type { PipelineEvent, RunMode } from './waboo-migration.rules';

/** Exactly what the pipeline is started with. The agent re-validates every field before it spawns anything. */
export interface RunnerJobArgs {
  sourceClient: string;
  sourceDb: string;
  mode: RunMode;
  /** testing switch: the agent starts the pipeline with --no-whatsapp (absent on jobs queued before the switch existed) */
  skipWhatsapp?: boolean;
}

export type JobStatus = 'queued' | 'claimed' | 'done' | 'abandoned';

export interface JobState {
  status: JobStatus;
  events: PipelineEvent[];
  exitCode: number | null;
  timedOut: boolean;
  stderrTail: string;
  /** How long the job has existed, by the DATABASE's clock (the worker's clock is never compared with a stored timestamp). */
  queuedForMs: number;
  /** How long since the agent was last heard from (since it claimed the job, or since it was created when nobody has), by the database's clock. */
  silentForMs: number;
}

/** What the worker's RemoteRunner needs from the hand-over table (a fake in the unit tests). Jobs are addressed by the run's uuid. */
export interface RunnerJobStore {
  enqueue(runUuid: string, args: RunnerJobArgs): Promise<void>;
  read(runUuid: string): Promise<JobState | null>;
  /** The worker gives up on the job: the agent sees `cancel` on its next report and stops the pipeline. */
  abandon(runUuid: string): Promise<void>;
}

const date = (v: unknown): Date | null => (v ? new Date(v as string | number | Date) : null);

/**
 * The hand-over between the panel's worker and the runner agent (tables waboo_migration_runner_jobs, waboo_migration_runners).
 * Platform tables on the operator door; no tenant, no secret. The worker enqueues, reads and abandons; the agent (through the runner
 * API) claims, reports and finishes. A job is only ever handed out while its run is 'running': a job left over from a run that
 * failed, was recovered or was cancelled is never started by an agent that turns up later.
 */
@Injectable()
export class RunnerJobs implements RunnerJobStore {
  constructor(
    private readonly store: PlatformStore,
    private readonly audit: AuthAuditService,
  ) {}

  async enqueue(runUuid: string, args: RunnerJobArgs): Promise<void> {
    await this.store.tx((tx) =>
      tx.execute(sql`
        INSERT INTO waboo_migration_runner_jobs (run_uuid, args)
        VALUES (${runUuid}::uuid, ${JSON.stringify(args)}::jsonb)
        ON CONFLICT (run_uuid) DO NOTHING
      `),
    );
  }

  async read(runUuid: string): Promise<JobState | null> {
    const res = await this.store.tx((tx) =>
      tx.execute(sql`
        SELECT status, events, exit_code, timed_out, stderr_tail,
               (extract(epoch FROM now() - created_at) * 1000)::float8 AS queued_for_ms,
               (extract(epoch FROM now() - coalesce(last_seen_at, claimed_at, created_at)) * 1000)::float8 AS silent_for_ms
        FROM waboo_migration_runner_jobs WHERE run_uuid = ${runUuid}::uuid
      `),
    );
    const r = res.rows[0] as
      | {
          status: JobStatus;
          events: PipelineEvent[] | null;
          exit_code: number | null;
          timed_out: boolean;
          stderr_tail: string;
          queued_for_ms: number | string;
          silent_for_ms: number | string;
        }
      | undefined;
    if (!r) return null;
    return {
      status: r.status,
      events: r.events ?? [],
      exitCode: r.exit_code,
      timedOut: r.timed_out,
      stderrTail: r.stderr_tail,
      queuedForMs: Number(r.queued_for_ms),
      silentForMs: Number(r.silent_for_ms),
    };
  }

  async abandon(runUuid: string): Promise<void> {
    await this.store.tx((tx) =>
      tx.execute(sql`
        UPDATE waboo_migration_runner_jobs
        SET status = 'abandoned', cancel_requested = true, finished_at = now()
        WHERE run_uuid = ${runUuid}::uuid AND status IN ('queued', 'claimed')
      `),
    );
  }

  /**
   * The agent asks for work. Records that it is alive, then hands out the oldest queued job whose run is running (one agent gets it,
   * never two). A null answer is the normal "nothing to do".
   */
  async claim(runner: string): Promise<WabooMigrationRunnerJob | null> {
    return this.store.tx(async (tx) => {
      await this.seen(tx, runner);
      const res = await tx.execute(sql`
        UPDATE waboo_migration_runner_jobs j
        SET status = 'claimed', runner = ${runner}, claimed_at = now(), last_seen_at = now()
        WHERE j.id = (
          SELECT j2.id FROM waboo_migration_runner_jobs j2
          JOIN waboo_migration_runs r ON r.uuid = j2.run_uuid AND r.status = 'running'
          WHERE j2.status = 'queued'
          ORDER BY j2.id LIMIT 1 FOR UPDATE OF j2 SKIP LOCKED
        )
        RETURNING j.run_uuid, j.args
      `);
      const row = res.rows[0] as { run_uuid: string; args: RunnerJobArgs } | undefined;
      if (!row) return null;
      await this.audit.record(tx, {
        event: 'platform.waboo_migration.runner_claimed',
        status: 'success',
        actorType: 'system',
        payload: { runId: row.run_uuid, runner, mode: row.args.mode },
      });
      return {
        runId: row.run_uuid,
        sourceClient: row.args.sourceClient,
        sourceDb: row.args.sourceDb,
        mode: row.args.mode,
        skipWhatsapp: row.args.skipWhatsapp === true,
      };
    });
  }

  /**
   * The agent reports validated events (a heartbeat when there are none). `cancel` is true when the agent must stop: the worker
   * abandoned the job, it belongs to another agent, or it is already finished.
   */
  async push(
    runUuid: string,
    runner: string,
    events: PipelineEvent[],
    stderrTail: string,
  ): Promise<{ cancel: boolean }> {
    return this.store.tx(async (tx) => {
      await this.seen(tx, runner);
      const res = await tx.execute(sql`
        UPDATE waboo_migration_runner_jobs
        SET events = events || ${JSON.stringify(events)}::jsonb,
            stderr_tail = CASE WHEN ${stderrTail} <> '' THEN ${stderrTail} ELSE stderr_tail END,
            last_seen_at = now()
        WHERE run_uuid = ${runUuid}::uuid AND runner = ${runner} AND status = 'claimed'
        RETURNING cancel_requested
      `);
      const r = res.rows[0] as { cancel_requested: boolean } | undefined;
      return { cancel: !r || r.cancel_requested };
    });
  }

  /** The pipeline ended. False when the job was no longer this agent's to finish (abandoned, finished, or another agent's). */
  async finish(
    runUuid: string,
    runner: string,
    r: { exitCode: number | null; timedOut: boolean; stderrTail: string },
  ): Promise<boolean> {
    return this.store.tx(async (tx) => {
      await this.seen(tx, runner);
      const res = await tx.execute(sql`
        UPDATE waboo_migration_runner_jobs
        SET status = 'done', exit_code = ${r.exitCode}, timed_out = ${r.timedOut},
            stderr_tail = ${r.stderrTail}, finished_at = now(), last_seen_at = now()
        WHERE run_uuid = ${runUuid}::uuid AND runner = ${runner} AND status = 'claimed'
        RETURNING run_uuid
      `);
      return res.rows.length > 0;
    });
  }

  /** The agent heard from most recently, for the panel's "runner online" notice. */
  async lastRunner(): Promise<{ name: string; lastSeenAt: Date; online: boolean } | null> {
    const res = await this.store.tx((tx) =>
      tx.execute(sql`
        SELECT name, last_seen_at,
               last_seen_at > now() - make_interval(secs => ${WMIG_RUNNER_ONLINE_SECONDS}) AS online
        FROM waboo_migration_runners ORDER BY last_seen_at DESC LIMIT 1
      `),
    );
    const r = res.rows[0] as { name: string; last_seen_at: unknown; online: boolean } | undefined;
    return r ? { name: r.name, lastSeenAt: date(r.last_seen_at) as Date, online: r.online } : null;
  }

  private async seen(tx: Tx, runner: string): Promise<void> {
    await tx.execute(sql`
      INSERT INTO waboo_migration_runners (name) VALUES (${runner})
      ON CONFLICT (name) DO UPDATE SET last_seen_at = now()
    `);
  }
}
