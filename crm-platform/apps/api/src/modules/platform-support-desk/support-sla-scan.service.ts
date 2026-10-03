import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SlaService } from './sla.service';

/**
 * The SLA breach scanner (TW-SUPP-030) on the worker's clock. Reference described "every five minutes" but never scheduled the
 * command, so its breach table stayed empty; here it runs. Idempotent (a unique row per ticket and breach type), so several
 * workers or an overlapping run cannot double-record.
 */
@Injectable()
export class SupportSlaScanService {
  private readonly logger = new Logger(SupportSlaScanService.name);
  private running = false;

  constructor(private readonly sla: SlaService) {}

  @Cron('*/5 * * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const inserted = await this.sla.scan();
      if (inserted > 0) this.logger.log({ inserted }, '[support:sla-scan] recorded breaches');
    } catch (err) {
      this.logger.error({ err }, 'support SLA scan failed');
    } finally {
      this.running = false;
    }
  }
}
