import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

/**
 * The scheduled-messages engine, API side (SCHED, TW-NODE-030 to 036): the lifecycle the screens call. The runs themselves
 * are in ScheduledQueueWarmerWorkerModule, imported only by the worker process. Registered in app.module.ts.
 */
@Module({
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class ScheduledQueueWarmerModule {}
