import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ChannelsService } from './channels.service';
import { InvitationsService } from './invitations.service';
import { MessagesService } from './messages.service';
import { PresenceService } from './presence.service';
import { TeamChatAccess } from './team-chat-access.service';
import { TeamChatController } from './team-chat.controller';
import { TeamChatRepository } from './team-chat.repository';

/** Internal team chat (TCHAT). Kernel services (audit, outbox, RBAC), the database and Redis are global. */
@Module({
  // PlansCoreModule: the `team_chat_channels` cap.
  imports: [PlansCoreModule],
  controllers: [TeamChatController],
  providers: [
    TeamChatRepository,
    TeamChatAccess,
    ChannelsService,
    MessagesService,
    InvitationsService,
    PresenceService,
  ],
  exports: [ChannelsService, MessagesService],
})
export class TeamChatModule {}
