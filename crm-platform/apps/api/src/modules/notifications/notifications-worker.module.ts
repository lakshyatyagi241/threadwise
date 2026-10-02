import { Module } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository';
import { SalesDocNotificationConsumer } from './salesdoc-notification.consumer';
import { TaskNotificationConsumer } from './task-notification.consumer';

/**
 * The outbox consumers that write notifications. Imported ONLY by WorkersModule (the worker process): a consumer
 * registers itself with the kernel's OutboxSubscriberRegistry, which the drain loop in that process fans events out to.
 */
@Module({
  providers: [NotificationsRepository, TaskNotificationConsumer, SalesDocNotificationConsumer],
})
export class NotificationsWorkerModule {}
