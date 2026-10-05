/**
 * Public surface of the scheduled-messages domain (SCHED). Other modules import from here, never from the files behind it.
 * `SchedulerService` is the lifecycle the screens and the appointment reminders call.
 */
export { ScheduledQueueWarmerModule } from './scheduled-queue-warmer.module';
export { ScheduledQueueWarmerWorkerModule } from './scheduled-queue-warmer-worker.module';
export { SchedulerService } from './scheduler.service';
export { WarmerService } from './warmer/warmer.service';
export { ScheduleProducerService, type ProducedSchedule } from './schedule-producer.service';
