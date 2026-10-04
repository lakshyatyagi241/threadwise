import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MarketSubscriptionLifecycle } from './subscription-lifecycle.service';

/**
 * Once a minute: every paid app subscription whose entitlement has run out is lapsed and its installation paused (data and settings kept;
 * a payment switches it back on). A minute is the same promise the kill switch makes. Access itself never waits for this sweep: the add-ons
 * domain reads the purchase rows at the moment of every check, so a workspace whose period ended is already refused a new install and sees
 * the subscription as ended; the sweep only brings the installation (and the connection that answers deliveries) into line.
 *
 * Idempotent and safe in several workers: each subscription is locked and re-checked in its own transaction. Registered only in the worker
 * process (MarketplaceWorkerModule, imported by WorkersModule): the HTTP app must never run it. An overlapping pass is refused.
 */
@Injectable()
export class SubscriptionSweepService {
  private readonly logger = new Logger(SubscriptionSweepService.name);
  private running = false;

  constructor(private readonly lifecycle: MarketSubscriptionLifecycle) {}

  @Cron('0 * * * * *')
  async run(): Promise<{ lapsed: number; paused: number }> {
    if (this.running) return { lapsed: 0, paused: 0 };
    this.running = true;
    try {
      const out = await this.lifecycle.sweep();
      if (out.lapsed > 0) this.logger.log(out, '[MKT] subscription sweep');
      return out;
    } catch (err) {
      this.logger.error({ err }, '[MKT] subscription sweep failed');
      return { lapsed: 0, paused: 0 };
    } finally {
      this.running = false;
    }
  }
}
