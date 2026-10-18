import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { StorageBackfillService } from './storage-backfill.service';
import { StorageMeterModule } from './storage-meter.module';
import { StorageQuotaProcessor } from './storage-quota.processor';
import { StorageQuotaPublisher } from './storage-quota.publisher';
import { StorageQuotaScheduler } from './storage-quota.scheduler';
import { StorageReconcileService } from './storage-reconcile.service';

/**
 * What only the worker runs for the storage meter: the backfill and the nightly counter check (BullMQ `storage-quota`), the pick-up that
 * queues workspaces never backfilled, and the reservation reaper. Imported ONLY by WorkersModule. `ChatMediaStore` (size checks for the
 * backfill) comes from the global chat media module the chat worker registers.
 */
@Module({
  imports: [StorageMeterModule, PlansCoreModule],
  providers: [
    StorageReconcileService,
    StorageBackfillService,
    StorageQuotaPublisher,
    StorageQuotaScheduler,
    StorageQuotaProcessor,
  ],
})
export class StorageQuotaWorkerModule {}
