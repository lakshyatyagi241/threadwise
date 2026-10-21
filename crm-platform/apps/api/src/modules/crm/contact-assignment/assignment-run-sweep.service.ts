import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ASSIGNMENT_RUN_RETENTION_DAYS } from '@crm/contracts';
import { liveDaysFor, recordSweep } from '../../data-retention';
import { DatabaseService } from '../../../infra/db/database.service';
import { ContactAssignmentRepository } from './contact-assignment.repository';

const MAX_BATCHES = 40;

/**
 * Keeps the assignment run log to its retention (90 days). Runs privileged to reach every workspace in one statement (the age of a row is
 * not tenant data); each batch skips rows another worker holds. Imported by the worker module only.
 */
@Injectable()
export class AssignmentRunSweepService {
  private readonly logger = new Logger(AssignmentRunSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactAssignmentRepository,
  ) {}

  @Cron('23 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pruned = await this.sweep();
      if (pruned > 0) this.logger.log({ pruned }, 'assignment run log retention sweep');
    } catch (err) {
      this.logger.error({ err }, 'assignment run log retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Deletes runs past the retention a batch at a time; returns how many. */
  async sweep(): Promise<number> {
    const days = await this.db.privileged((tx) =>
      liveDaysFor(tx, 'assignment_runs', ASSIGNMENT_RUN_RETENTION_DAYS),
    );
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.db.privileged((tx) => this.repo.pruneRuns(tx, days));
      total += n;
      if (n < 5000) break;
    }
    await recordSweep(this.db, this.logger, 'assignment_runs', { deletedRows: total });
    return total;
  }
}
