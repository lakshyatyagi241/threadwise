import { Module } from '@nestjs/common';
import { SafeFetch } from '../../../../infra/providers/node-bridge-runtime/safe-fetch';
import { ChatConversationsModule } from '../../../chat-conversations';
import { CrmModule } from '../../../crm';
import { PlansCoreModule } from '../../../plans-subscriptions-trials';
import { V1ConversationsController } from './conversations.controller';
import { V1DevicesController } from './devices.controller';
import { MediaIntakeService } from './media-intake.service';
import { V1MediaController } from './media.controller';
import { MessageSendService } from './message-send.service';
import { V1MessagesController } from './messages.controller';
import { MessagingReadService } from './messaging-read.service';
import { MessagingRepository } from './messaging.repository';

/**
 * Customer REST API v1, messaging (WD-API-110 to 120): messages, media, conversations and devices. It sends through the inbox's own door
 * (`CONVERSATIONS_FACADE`) and the channel registry, and reads with its own repository. The root module imports it.
 */
@Module({
  imports: [ChatConversationsModule, CrmModule, PlansCoreModule],
  controllers: [
    V1MessagesController,
    V1MediaController,
    V1ConversationsController,
    V1DevicesController,
  ],
  providers: [
    MessagingRepository,
    MessagingReadService,
    MediaIntakeService,
    MessageSendService,
    SafeFetch,
  ],
})
export class V1MessagingModule {}
