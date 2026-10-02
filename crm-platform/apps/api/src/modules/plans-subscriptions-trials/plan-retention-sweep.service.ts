import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PlanRetentionService } from './plan-retention.service';

/**
 * The daily retention sweep (WD-PLAN-023): WaDesk piggy-backed on the Node bridge heartbeat under a 24-hour cache lock, so without a bridge
 * it never ran. Here it is the worker's own schedule. The per-workspace re-check under a row lock is what keeps several workers from
 * wiping the same workspace twice.
 */
@Injectable()
export class PlanRetentionSweepService {
  private readonly logger = new Logger(PlanRetentionSweepService.name);
  private running = false;

  constructor(private readonly retention: PlanRetentionService) {}

  @Cron('17 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const done = await this.retention.sweep();
      const wiped = done.filter((d) => d.wiped).length;
      if (wiped > 0) this.logger.warn({ wiped }, '[WIPE-EXPIRED] retention sweep finished');
    } catch (err) {
      this.logger.error({ err }, 'data-retention sweep failed');
    } finally {
      this.running = false;
    }
  }
}
