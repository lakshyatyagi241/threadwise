import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { FaqLogRepository } from './faq-log.repository';
import { liveDaysFor, recordSweep } from '../data-retention';
import { LOG_RETENTION_DAYS } from './faq.rules';

const BATCH = 1000;
const MAX_BATCHES = 50;

/** The daily sweep of the match log: rows older than LOG_RETENTION_DAYS go, a batch at a time, across every workspace (privileged). */
@Injectable()
export class FaqRetentionService {
  private readonly logger = new Logger(FaqRetentionService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly logs: FaqLogRepository,
  ) {}

  @Cron('17 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deleted = await this.sweep();
      if (deleted > 0) this.logger.log({ deleted }, 'faq match log retention sweep');
    } catch (err) {
      this.logger.error({ err }, 'faq match log retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  async sweep(): Promise<number> {
    // A window saved on the retention dashboard replaces the built-in number; read at every run.
    const days = await this.db.privileged((tx) =>
      liveDaysFor(tx, 'faq_match_log', LOG_RETENTION_DAYS),
    );
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.db.privileged((tx) => this.logs.purgeOlderThan(tx, days, BATCH));
      total += n;
      if (n < BATCH) break;
    }
    await recordSweep(this.db, this.logger, 'faq_match_log', { deletedRows: total });
    return total;
  }
}
