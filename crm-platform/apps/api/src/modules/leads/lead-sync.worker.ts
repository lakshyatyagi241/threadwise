import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import type { Job } from 'bullmq';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { LeadSyncRunsRepository } from './lead-sync-runs.repository';
import { LeadSyncService, type SyncJob } from './lead-sync.service';

/** A queued run whose job never arrived (Redis was down when it was asked for) is queued again after this long. */
const QUEUED_STALE_SECONDS = 60;
/** A running run that has not reported for this long was left by a dead worker. A backfill reports after every request to the source. */
const RUNNING_SILENT_SECONDS = 20 * 60;

/**
 * The worker side of "Sync now" and backfill. One job per run; the run's own row says what to pull. Concurrency is across sources: the
 * unique index on the run table admits one open run per source, so two jobs for one source cannot exist. Imported by the worker module only.
 */
@Processor(QUEUES.LEAD_SYNC, { concurrency: 2 })
export class LeadSyncProcessor extends WorkerHost {
  constructor(private readonly sync: LeadSyncService) {
    super();
  }

  async process(job: Job<SyncJob>): Promise<void> {
    await this.sync.execute(job.data.orgId, job.data.runId);
  }
}

/** Every 30 seconds: queue the runs whose job was lost and free the runs whose worker died. */
@Injectable()
export class LeadSyncSweepService {
  private readonly logger = new Logger(LeadSyncSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly runs: LeadSyncRunsRepository,
    private readonly sync: LeadSyncService,
  ) {}

  @Interval(30_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const lost = await this.db.privileged((tx) =>
        this.runs.staleQueued(tx, QUEUED_STALE_SECONDS, 50),
      );
      for (const job of lost) await this.sync.enqueue({ orgId: job.orgId, runId: job.id });
      const freed = await this.db.privileged((tx) =>
        this.runs.failAbandoned(tx, RUNNING_SILENT_SECONDS),
      );
      if (lost.length > 0 || freed > 0) {
        this.logger.warn({ requeued: lost.length, freed }, 'lead sync sweep');
      }
    } catch (err) {
      this.logger.error({ err }, 'lead sync sweep failed');
    } finally {
      this.running = false;
    }
  }
}
