import { Module } from '@nestjs/common';
import { WabooMigrationRunnerController } from './runner-agent.controller';
import { RunnerJobs } from './runner-jobs';
import { WabooMigrationController } from './waboo-migration.controller';
import { WabooMigrationJobs } from './waboo-migration.jobs';
import { WabooMigrationService } from './waboo-migration.service';

/**
 * Waboo -> WaDesk migration panel (WMIG, not a WaDesk feature). The HTTP side queues and reads runs and batches; the pipeline
 * itself runs in WabooMigrationWorkerModule, in the worker or on a runner agent over the Geta VPN (the agent's door is
 * runner-agent.controller.ts). The platform door (PlatformStore), audit and the queues come from global modules.
 * Registered in app.module.ts.
 */
@Module({
  controllers: [WabooMigrationController, WabooMigrationRunnerController],
  providers: [WabooMigrationService, WabooMigrationJobs, RunnerJobs],
  exports: [WabooMigrationService],
})
export class WabooMigrationModule {}
