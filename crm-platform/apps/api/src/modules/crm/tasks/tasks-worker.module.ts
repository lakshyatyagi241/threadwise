import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { TaskDueSweepService } from './task-due-sweep.service';

/**
 * The due-reminder sweep. Imported ONLY by WorkersModule (the worker process): an API pod that also swept would multiply the
 * polling load on the database, so the sweep is not part of CrmModule.
 */
@Module({
  imports: [CrmModule],
  providers: [TaskDueSweepService],
})
export class TasksWorkerModule {}
