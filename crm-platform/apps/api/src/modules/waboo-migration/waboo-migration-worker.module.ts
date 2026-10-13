import { Module } from '@nestjs/common';
import { ProcessRunner } from './runner';
import { WabooMigrationJobs } from './waboo-migration.jobs';
import { RUNNER, WabooMigrationProcessor } from './waboo-migration.processor';
import { WabooMigrationStores } from './waboo-migration.stores';

/** The migration consumer. Imported ONLY by WorkersModule: the HTTP app queues, the worker spawns the pipeline. */
@Module({
  providers: [
    WabooMigrationJobs,
    WabooMigrationStores,
    { provide: RUNNER, useFactory: () => new ProcessRunner() },
    WabooMigrationProcessor,
  ],
})
export class WabooMigrationWorkerModule {}
