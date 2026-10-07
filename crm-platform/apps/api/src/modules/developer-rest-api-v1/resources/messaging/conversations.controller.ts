import { Get, Param, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  v1ListConversationsQuerySchema,
  v1ListMessagesQuerySchema,
  type V1ListConversationsQuery,
  type V1ListMessagesQuery,
} from '@crm/contracts';
import { zodPipe } from '../../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../../plans-subscriptions-trials';
import { RequireApiScope } from '../../auth/api-scope';
import { V1Controller } from '../../http/v1-controller.decorator';
import { MessagingReadService } from './messaging-read.service';
import { UuidParam } from './uuid-param.pipe';

/** Conversations: the workspace's threads (WD-API-114) and the messages of one (115). Read-only; reading does not mark a thread read. */
@V1Controller('conversations')
@RequirePlanFeature('public_api')
export class V1ConversationsController {
  constructor(private readonly reads: MessagingReadService) {}

  @Get()
  @RequireApiScope('conversations:read')
  @ApiOperation({ summary: "The workspace's chat threads, most recently active first" })
  list(@Query(zodPipe(v1ListConversationsQuerySchema)) query: V1ListConversationsQuery) {
    return this.reads.listConversations(query);
  }

  @Get(':id/messages')
  @RequireApiScope('conversations:read')
  @ApiOperation({ summary: 'The messages of one conversation, newest first' })
  messages(
    @Param('id', new UuidParam('Conversation')) id: string,
    @Query(zodPipe(v1ListMessagesQuerySchema)) query: V1ListMessagesQuery,
  ) {
    return this.reads.conversationMessages(id, query);
  }
}
