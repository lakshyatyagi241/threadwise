import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { ConsentExportRepository } from './consent-export.repository';

/** An export `running` this long has lost its worker. */
const STUCK_EXPORT_MS = 60 * 60_000;

/**
 * The daily keeper of the consent proof exports (worker only): deletes the file of an export older than its week (the row stays,
 * `expired`) and fails an export whose worker died, so the "one at a time" rule never blocks a workspace for good.
 */
@Injectable()
export class ConsentExportSweepService {
  private readonly logger = new Logger(ConsentExportSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConsentExportRepository,
  ) {}

  @Cron('41 2 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const out = await this.sweep();
      if (out.expired + out.failed > 0) this.logger.log(out, '[CONSENT] export sweep');
    } catch (err) {
      this.logger.error({ err }, '[CONSENT] export sweep failed');
    } finally {
      this.running = false;
    }
  }

  async sweep(now: Date = new Date()): Promise<{ expired: number; failed: number }> {
    const expired = await this.db.privileged((tx) => this.repo.expire(tx, now));
    const failed = await this.db.privileged((tx) => this.repo.failStuck(tx, now, STUCK_EXPORT_MS));
    return { expired, failed };
  }
}
