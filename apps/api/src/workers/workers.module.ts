import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OutboxDrainService } from './outbox-drain.service';
import { PartitionMaintenanceService } from './partition-maintenance.service';

/**
 * Background work.
 *
 * Imported ONLY by the worker bootstrap (worker.ts), never by the HTTP app. An
 * API pod that also drained the outbox would compete with request handling for
 * the event loop, and every API pod added would multiply the polling load on
 * the database.
 *
 * Still to land here: campaign sender (throttled), billing roll-up, SLA sweep,
 * counter flush, bulk import/export.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [OutboxDrainService, PartitionMaintenanceService],
  exports: [OutboxDrainService, PartitionMaintenanceService],
})
export class WorkersModule {}
