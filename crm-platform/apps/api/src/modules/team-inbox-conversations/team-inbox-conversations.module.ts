import { Module } from '@nestjs/common';
import { ChatChannelProvidersModule } from '../../infra/providers/chat-conversations';
import { ChatConversationsModule } from '../chat-conversations';
import { CrmModule } from '../crm';
import { MessageTemplatesModule } from '../message-templates';
import { NotificationsModule } from '../notifications';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ConversationEventsRepository } from './conversation-events.repository';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess } from './inbox-access.service';
import { InboxConversationsService } from './inbox-conversations.service';
import { InboxController } from './inbox.controller';
import { InboxMediaService } from './inbox-media.service';
import { InboxMessageLogService } from './inbox-message-log.service';
import { InboxNotesService } from './inbox-notes.service';
import { InboxRealtimePublisher } from './inbox-realtime.publisher';
import { InboxThreadService } from './inbox-thread.service';
import { InboxTimelineService } from './inbox-timeline.service';
import { MediaUploadsRepository } from './media-uploads.repository';
import { NotesRepository } from './notes.repository';
import { SavedRepliesController } from './saved-replies/saved-replies.controller';
import { SavedRepliesTransferController } from './saved-replies/saved-replies-transfer.controller';
import { SavedRepliesTransferService } from './saved-replies/saved-replies-transfer.service';
import { SharedSavedRepliesReader } from './saved-replies/shared-saved-replies.reader';
import { SavedRepliesRepository } from './saved-replies/saved-replies.repository';
import { SavedRepliesService } from './saved-replies/saved-replies.service';

/**
 * Team inbox, conversations (TIB1): the agent-facing API over the conversation core. It reads the list and the header itself (the
 * visibility rule is its own), and reaches the message pipeline only through `ConversationsFacade`.
 *
 * Kernel services (audit, outbox, RBAC), the database, realtime and the chat media store are global.
 */
@Module({
  imports: [
    ChatConversationsModule,
    ChatChannelProvidersModule,
    CrmModule,
    MessageTemplatesModule,
    NotificationsModule,
    PlansCoreModule,
  ],
  // The transfer controller first: `export` and `import` must not be read as a reply id.
  controllers: [InboxController, SavedRepliesTransferController, SavedRepliesController],
  providers: [
    ConversationsRepository,
    ConversationEventsRepository,
    NotesRepository,
    MediaUploadsRepository,
    InboxAccess,
    InboxRealtimePublisher,
    InboxConversationsService,
    InboxThreadService,
    InboxNotesService,
    InboxTimelineService,
    InboxMediaService,
    InboxMessageLogService,
    SavedRepliesRepository,
    SavedRepliesService,
    SavedRepliesTransferService,
    SharedSavedRepliesReader,
  ],
  exports: [
    ConversationsRepository,
    ConversationEventsRepository,
    InboxAccess,
    InboxRealtimePublisher,
    InboxConversationsService,
    SharedSavedRepliesReader,
  ],
})
export class TeamInboxConversationsModule {}
