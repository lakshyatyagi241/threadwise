import { Module } from '@nestjs/common';
import { WEB_PUSH_PROVIDER } from '../../infra/providers/web-push/web-push.port';
import { WebPushLibProvider } from '../../infra/providers/web-push/web-push-lib.provider';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ConversationReadState } from './conversation-read-state';
import { NotificationFanout } from './notification-fanout';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPrefsResolver } from './notification-prefs.resolver';
import { NotificationPublisher } from './notification.publisher';
import { NotificationsController } from './notifications.controller';
import { PushController } from './push.controller';
import { PushSubscriptionsRepository } from './push-subscriptions.repository';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { WebPushSender } from './web-push.sender';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/** The in-app notification feed: the header bell's API. The consumers that fill it live in NotificationsWorkerModule. */
@Module({
  imports: [PlansCoreModule],
  controllers: [NotificationsController, PushController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    NotificationPublisher,
    NotificationFanout,
    NotificationPrefsResolver,
    NotificationPreferencesService,
    ConversationReadState,
    PushSubscriptionsRepository,
    PushSubscriptionsService,
    WebPushSender,
    WebPushLibProvider,
    { provide: WEB_PUSH_PROVIDER, useExisting: WebPushLibProvider },
  ],
  exports: [NotificationsService, NotificationsRepository, NotificationPublisher],
})
export class NotificationsModule {}
