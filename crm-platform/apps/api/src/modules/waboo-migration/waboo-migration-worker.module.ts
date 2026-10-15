import { Module } from '@nestjs/common';
import { RemoteRunner, remoteTiming } from './remote-runner';
import { ProcessRunner, runnerMode, type Runner } from './runner';
import { RunnerJobs } from './runner-jobs';
import { WabooMigrationJobs } from './waboo-migration.jobs';
import { RUNNER, WabooMigrationProcessor } from './waboo-migration.processor';
import { WabooMigrationStores } from './waboo-migration.stores';

/** The migration consumer. Imported ONLY by WorkersModule: the HTTP app queues, the worker runs (or hands over) the pipeline. */
@Module({
  providers: [
    WabooMigrationJobs,
    WabooMigrationStores,
    RunnerJobs,
    {
      provide: RUNNER,
      inject: [RunnerJobs],
      // WABOO_MIGRATE_RUNNER=remote: the pipeline runs on a runner agent over the Geta VPN; otherwise the worker spawns it itself.
      useFactory: (jobs: RunnerJobs): Runner =>
        runnerMode(process.env) === 'remote'
          ? new RemoteRunner(jobs, remoteTiming(process.env))
          : new ProcessRunner(),
    },
    WabooMigrationProcessor,
  ],
})
export class WabooMigrationWorkerModule {}
