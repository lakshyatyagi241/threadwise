import { Module } from '@nestjs/common';
import { WEB_PUSH_PROVIDER } from '../../infra/providers/web-push/web-push.port';
import { WebPushLibProvider } from '../../infra/providers/web-push/web-push-lib.provider';
import { ConversationNotificationConsumer } from './conversation-notification.consumer';
import { ConversationReadState } from './conversation-read-state';
import { DeviceNotificationConsumer } from './device-notification.consumer';
import { NotificationFanout } from './notification-fanout';
import { NotificationPrefsResolver } from './notification-prefs.resolver';
import { NotificationRetentionService } from './notification-retention.service';
import { NotificationPublisher } from './notification.publisher';
import { NotificationsRepository } from './notifications.repository';
import { PushSubscriptionsPruneService } from './push-subscriptions-prune.service';
import { PushSubscriptionsRepository } from './push-subscriptions.repository';
import { WebPushDeliveryService } from './web-push-delivery.service';
import { WebPushProcessor } from './web-push.processor';
import { WebPushSender } from './web-push.sender';
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
    PushSubscriptionsRepository,
    PushSubscriptionsPruneService,
    WebPushSender,
    WebPushLibProvider,
    { provide: WEB_PUSH_PROVIDER, useExisting: WebPushLibProvider },
    WebPushDeliveryService,
    WebPushProcessor,
  ],
})
export class NotificationsWorkerModule {}
