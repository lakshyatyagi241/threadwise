import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { liveDaysFor, recordSweep } from '../data-retention';
import { LeadChatDigestService } from './lead-chat-digest.service';
import { LeadScoringConfigService } from './lead-scoring-config.service';
import { LeadScoringRepository } from './lead-scoring.repository';

/** The daily sweep of the scoring log: rows older than the operator's retention (default 90 days) go, across every workspace. */
@Injectable()
export class LeadScoringRetentionService {
  private readonly logger = new Logger(LeadScoringRetentionService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeadScoringRepository,
    private readonly config: LeadScoringConfigService,
    private readonly digests: LeadChatDigestService,
  ) {}

  @Cron('41 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deleted = await this.sweep();
      if (deleted > 0) this.logger.log({ deleted }, 'lead scoring log retention sweep');
    } catch (err) {
      this.logger.error({ err }, 'lead scoring log retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  async sweep(): Promise<number> {
    const configured = (await this.config.getFresh()).retentionDays;
    // A window saved on the retention dashboard replaces the one in the AI lead scoring settings.
    const retentionDays = await this.db.privileged((tx) =>
      liveDaysFor(tx, 'lead_scoring_runs', configured),
    );
    const runs = await this.db.privileged((tx) => this.repo.deleteOlderThan(tx, retentionDays));
    // The conversation readings and the stage suggestions follow the same retention (and open suggestions expire).
    const total = runs + (await this.digests.sweepOld(retentionDays));
    await recordSweep(this.db, this.logger, 'lead_scoring_runs', { deletedRows: total });
    return total;
  }
}
