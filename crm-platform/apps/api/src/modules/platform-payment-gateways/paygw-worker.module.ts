import { Injectable, Logger, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PlatformPaymentGatewaysModule } from './paygw.module';
import { NotificationPublisher, NotificationsRepository } from '../notifications';
import { AddonRedundancyService } from './addon-redundancy.service';
import { SubscriptionNotificationsConsumer } from './subscription-notifications.consumer';
import { SubscriptionReconcilerService } from './subscription-reconciler.service';

const TICK_MS = 10 * 60_000;

/**
 * Runs the subscription reconciler on a clock (TW-PAYGW-030). Reference polled while a subscribed user browsed; a worker sweep needs
 * no traffic. Overlapping passes are refused; the per-subscription claim in the service keeps several workers from polling twice.
 */
@Injectable()
export class SubscriptionReconcileScheduler {
  private readonly logger = new Logger(SubscriptionReconcileScheduler.name);
  private running = false;

  constructor(private readonly reconciler: SubscriptionReconcilerService) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tally = await this.reconciler.sweep();
      if (Object.keys(tally).length > 0) this.logger.log({ tally }, '[PAYGW] subscription sweep');
    } catch (err) {
      this.logger.error({ err }, '[PAYGW] subscription sweep failed');
    } finally {
      this.running = false;
    }
  }
}

/** Stops add-on renewals the plan now covers, on the same clock (see AddonRedundancyService). */
@Injectable()
export class AddonRedundancyScheduler {
  private readonly logger = new Logger(AddonRedundancyScheduler.name);
  private running = false;

  constructor(private readonly redundancy: AddonRedundancyService) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.redundancy.sweep();
      if (n > 0) this.logger.log({ stopped: n }, '[PAYGW] redundant add-on renewals stopped');
    } catch (err) {
      this.logger.error({ err }, '[PAYGW] redundant add-on sweep failed');
    } finally {
      this.running = false;
    }
  }
}

/** Imported ONLY by WorkersModule: the HTTP app never runs the sweep. */
@Module({
  imports: [PlatformPaymentGatewaysModule],
  providers: [
    SubscriptionReconcileScheduler,
    AddonRedundancyScheduler,
    NotificationsRepository,
    NotificationPublisher,
    SubscriptionNotificationsConsumer,
  ],
})
export class PaygwWorkerModule {}
