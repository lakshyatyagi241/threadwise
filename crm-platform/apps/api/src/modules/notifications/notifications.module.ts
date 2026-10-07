import { Module } from '@nestjs/common';
import { ConversationReadState } from './conversation-read-state';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPrefsResolver } from './notification-prefs.resolver';
import { NotificationPublisher } from './notification.publisher';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/** The in-app notification feed: the header bell's API. The consumers that fill it live in NotificationsWorkerModule. */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    NotificationPublisher,
    NotificationPrefsResolver,
    NotificationPreferencesService,
    ConversationReadState,
  ],
  exports: [NotificationsService, NotificationsRepository, NotificationPublisher],
})
export class NotificationsModule {}
