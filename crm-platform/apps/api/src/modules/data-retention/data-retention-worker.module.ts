import { Module } from '@nestjs/common';
import { DataRetentionModule } from './data-retention.module';
import { PartitionArchiver } from './partition-archiver.service';
import { RetentionWorker } from './retention.worker';

/**
 * The nightly retention job (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 6). Imported ONLY by WorkersModule
 * (the worker process): it exports and drops partitions, which an API pod must never do. Off until RETENTION_ENABLED=true.
 */
@Module({
  imports: [DataRetentionModule],
  providers: [PartitionArchiver, RetentionWorker],
  exports: [PartitionArchiver],
})
export class DataRetentionWorkerModule {}
