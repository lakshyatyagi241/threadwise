import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
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
    const { retentionDays } = await this.config.getFresh();
    return this.db.privileged((tx) => this.repo.deleteOlderThan(tx, retentionDays));
  }
}
