import { Module } from '@nestjs/common';
import { ConversationNotificationConsumer } from './conversation-notification.consumer';
import { ConversationReadState } from './conversation-read-state';
import { DeviceNotificationConsumer } from './device-notification.consumer';
import { NotificationFanout } from './notification-fanout';
import { NotificationPrefsResolver } from './notification-prefs.resolver';
import { NotificationRetentionService } from './notification-retention.service';
import { NotificationPublisher } from './notification.publisher';
import { NotificationsRepository } from './notifications.repository';
import { SalesDocNotificationConsumer } from './salesdoc-notification.consumer';
import { SendOutcomeNotificationConsumer } from './send-outcome-notification.consumer';
import { TaskNotificationConsumer } from './task-notification.consumer';
import { TeamChatNotificationConsumer } from './team-chat-notification.consumer';

/**
 * The outbox consumers that write notifications. Imported ONLY by WorkersModule (the worker process): a consumer
 * registers itself with the kernel's OutboxSubscriberRegistry, which the drain loop in that process fans events out to.
 */
@Module({
  providers: [
    NotificationsRepository,
    NotificationPublisher,
    NotificationPrefsResolver,
    ConversationReadState,
    TaskNotificationConsumer,
    SalesDocNotificationConsumer,
    ConversationNotificationConsumer,
    NotificationFanout,
    DeviceNotificationConsumer,
    SendOutcomeNotificationConsumer,
    TeamChatNotificationConsumer,
    NotificationRetentionService,
  ],
})
export class NotificationsWorkerModule {}
