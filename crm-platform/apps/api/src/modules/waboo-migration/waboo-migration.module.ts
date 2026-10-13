import { Module } from '@nestjs/common';
import { WabooMigrationController } from './waboo-migration.controller';
import { WabooMigrationJobs } from './waboo-migration.jobs';
import { WabooMigrationService } from './waboo-migration.service';

/**
 * Waboo -> WaDesk migration panel (WMIG, not a WaDesk feature). The HTTP side queues and reads runs and batches; the pipeline
 * itself runs in WabooMigrationWorkerModule. The platform door (PlatformStore), audit and the queues come from global modules.
 * Registered in app.module.ts.
 */
@Module({
  controllers: [WabooMigrationController],
  providers: [WabooMigrationService, WabooMigrationJobs],
  exports: [WabooMigrationService],
})
export class WabooMigrationModule {}
