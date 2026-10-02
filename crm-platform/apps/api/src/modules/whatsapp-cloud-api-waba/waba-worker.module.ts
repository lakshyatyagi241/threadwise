import { Injectable, Logger, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WabaChannelSync } from './inbox/waba-channel-sync.service';
import { WabaIngestProcessor } from './waba-ingest.processor';
import { WabaModule } from './waba.module';

const RECONCILE_MS = 60_000;

/** Keeps each connected number's inbox channel in step with the number (TW-WABA-034). Worker only: one pass a minute is plenty. */
@Injectable()
export class WabaChannelReconciler {
  private readonly logger = new Logger(WabaChannelReconciler.name);

  constructor(private readonly sync: WabaChannelSync) {}

  @Interval(RECONCILE_MS)
  async tick(): Promise<void> {
    try {
      await this.sync.reconcile();
    } catch (err) {
      this.logger.error({ err: String(err) }, '[WABA] channel reconcile failed');
    }
  }
}

/** The WhatsApp webhook consumer. Imported ONLY by WorkersModule: the HTTP app answers Meta, the worker does the work. */
@Module({ imports: [WabaModule], providers: [WabaIngestProcessor, WabaChannelReconciler] })
export class WabaWorkerModule {}
