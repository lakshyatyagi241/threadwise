import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ResellerCreditService } from './reseller-credit.service';

/**
 * Auto-attach (TW-BSP-008): while the operator's toggle is on, a reseller workspace's connected number that was never tried gets
 * the credit line. Reference did it in a model `saved` hook, so a Graph call (up to 30 s) ran inside whatever request or job saved the
 * connection; here a worker sweep does it, so connecting a number never waits for Meta and a Meta outage cannot break it.
 *
 * Idempotent by construction: a number with any allocation row (attached, failed or revoked) is not "never tried", so a repeated
 * sweep, a second worker or a retry cannot call Meta twice for it. Retrying a failure is the operator's "Attach all".
 * Runs in the worker process only (WorkersModule imports the worker module, the HTTP app does not).
 */
@Injectable()
export class AutoAttachSweepService {
  private readonly logger = new Logger(AutoAttachSweepService.name);
  private running = false;

  constructor(private readonly credit: ResellerCreditService) {}

  @Interval(30_000)
  async sweep(): Promise<void> {
    // The interval keeps firing whether or not the last pass finished; a pass is up to a handful of 30 s Graph calls.
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.credit.autoAttachPending();
      if (result) this.logger.log(result, '[BSP-CREDIT] auto-attach sweep');
    } catch (err) {
      this.logger.error({ err }, '[BSP-CREDIT] auto-attach sweep failed');
    } finally {
      this.running = false;
    }
  }
}
