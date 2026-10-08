import { Injectable, Logger, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WabaClickSyncService } from './waba-click-sync.service';
import { PinnacleCreditLineProcessor } from './pinnacle-credit-line.processor';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WabaGroupRealtimeConsumer } from './waba-group-realtime.consumer';
import { WabaIngestProcessor } from './waba-ingest.processor';
import { WabaModule } from './waba.module';

const CLICK_SYNC_MS = 24 * 3_600_000;

/** Daily pull of Meta's template button clicks onto the campaigns (TW-WABA-053). Idempotent: a second worker doing it too only repeats a write. */
@Injectable()
export class WabaClickSyncScheduler {
  private readonly logger = new Logger(WabaClickSyncScheduler.name);

  constructor(private readonly clicks: WabaClickSyncService) {}

  @Interval(CLICK_SYNC_MS)
  async tick(): Promise<void> {
    try {
      const n = await this.clicks.run();
      this.logger.log({ campaigns: n }, '[WABA] template clicks synced');
    } catch (err) {
      this.logger.error({ err: String(err) }, '[WABA] template click sync failed');
    }
  }
}

/** The WhatsApp webhook consumer. Imported ONLY by WorkersModule: the HTTP app answers Meta, the worker does the work. */
@Module({
  imports: [WabaModule, PlansCoreModule],
  providers: [
    WabaIngestProcessor,
    WabaClickSyncScheduler,
    PinnacleCreditLineProcessor,
    WabaGroupRealtimeConsumer,
  ],
})
export class WabaWorkerModule {}
