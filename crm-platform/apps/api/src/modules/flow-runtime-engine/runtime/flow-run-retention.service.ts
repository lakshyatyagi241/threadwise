import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FLOW_RUN_LOG_RETENTION_DAYS } from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import { liveDaysFor, recordSweep } from '../../data-retention';
import { RunRepository } from './run.repository';

const BATCH = 1000;
const MAX_BATCHES = 50;
const DAY_MS = 86_400_000;

/**
 * The daily sweep of the run log (TW-FLR-083): runs that ended more than FLOW_RUN_LOG_RETENTION_DAYS ago are deleted, a batch at a
 * time, across every workspace (privileged). Their step rows go with them (cascade). A run that is still live has no end date and is
 * never touched. Graph versions no remaining run points at go in the same sweep.
 */
@Injectable()
export class FlowRunRetentionService {
  private readonly logger = new Logger(FlowRunRetentionService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
  ) {}

  @Cron('41 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const out = await this.sweep();
      if (out.runs + out.versions > 0) this.logger.log(out, '[FLR] run log retention sweep');
    } catch (err) {
      this.logger.error({ err }, '[FLR] run log retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. */
  async sweep(now: Date = new Date()): Promise<{ runs: number; versions: number }> {
    const days = await this.db.privileged((tx) =>
      liveDaysFor(tx, 'flow_run_logs', FLOW_RUN_LOG_RETENTION_DAYS),
    );
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const runs = await this.drain((tx) => this.runs.purgeEndedBefore(tx, cutoff, BATCH));
    const versions = await this.drain((tx) =>
      this.runs.purgeUnusedGraphVersions(tx, cutoff, BATCH),
    );
    await recordSweep(this.db, this.logger, 'flow_run_logs', { deletedRows: runs + versions }, now);
    return { runs, versions };
  }

  private async drain(
    once: (tx: Parameters<Parameters<DatabaseService['privileged']>[0]>[0]) => Promise<number>,
  ): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.db.privileged(once);
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}
