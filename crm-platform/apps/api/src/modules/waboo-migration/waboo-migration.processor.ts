import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { timeoutMs, type Runner } from './runner';
import { executeRun, recover, runBatch, type ExecOutcome } from './waboo-migration.engine';
import { WabooMigrationJobs, type MigrateJob } from './waboo-migration.jobs';
import { WabooMigrationStores } from './waboo-migration.stores';
import { delayFor } from './waboo-migration.rules';

export const RUNNER = Symbol('WABOO_MIGRATION_RUNNER');

/** How long a job waits when another run holds the environment (only one migration runs at a time). */
export const BUSY_RETRY_MS = 30_000;

/**
 * Executes migration jobs ONE AT A TIME (concurrency 1: the staging server cannot run two migrations at once; the database
 * also refuses a second running run). A 'migrate' job is one run; a 'batch' job walks its children one after another.
 * Registered only in the worker process (WabooMigrationWorkerModule).
 */
@Processor(QUEUES.WAB_MIGRATE, { concurrency: 1 })
export class WabooMigrationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(WabooMigrationProcessor.name);

  constructor(
    private readonly stores: WabooMigrationStores,
    private readonly jobs: WabooMigrationJobs,
    @Inject(RUNNER) private readonly runner: Runner,
  ) {
    super();
  }

  /**
   * Recovery on worker start: fail runs stuck 'running' (a worker that died) and re-enqueue every scheduled run or batch whose job
   * is missing (the worker or Redis was down when its time came). Idempotent: an existing job is never duplicated.
   */
  async onModuleInit(): Promise<void> {
    try {
      const r = await recover(
        { store: this.stores.sweep, jobs: this.jobs, timeoutMs: timeoutMs(process.env) },
        delayFor,
      );
      if (r.failed > 0 || r.requeued > 0)
        this.logger.warn(r, 'migration recovery: stale runs failed, lost jobs re-enqueued');
    } catch (err) {
      this.logger.error({ err }, 'migration recovery sweep failed');
    }
  }

  private execute = (runUuid: string): Promise<ExecOutcome> =>
    executeRun(
      { store: this.stores.exec, runner: this.runner, timeoutMin: timeoutMs(process.env) / 60_000 },
      runUuid,
    );

  async process(job: Job<MigrateJob>, token?: string): Promise<void> {
    const uuid = job.data.batchUuid ?? job.data.runUuid;
    if (!uuid) return;
    await RequestContextStore.run(
      {
        requestId: `wab-migrate-${uuid}`,
        orgId: 0,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        if (job.data.batchUuid) {
          const r = await runBatch({ store: this.stores.batch, execute: this.execute }, uuid);
          if (r === 'busy') await this.delay(job, token);
          this.logger.log({ batchUuid: uuid, result: r }, 'waboo migration batch step');
          return;
        }
        const out = await this.execute(uuid);
        if (out === 'busy') await this.delay(job, token);
        this.logger.log({ runUuid: uuid, outcome: out }, 'waboo migration run handled');
        // The run row already says why; never retry a migration.
        if (out === 'failed') throw new UnrecoverableError('failed');
      },
    );
  }

  /** Another run holds the environment: wait and try again, without using up an attempt. Batch progress is kept in the rows. */
  private async delay(job: Job<MigrateJob>, token?: string): Promise<never> {
    await job.moveToDelayed(Date.now() + BUSY_RETRY_MS, token);
    throw new DelayedError();
  }
}
