import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createMessageHistoryExportSchema,
  listMessageHistoryQuerySchema,
  messageHistoryIdSchema,
  messageHistorySummaryQuerySchema,
  type CreateMessageHistoryExportInput,
  type ListMessageHistoryQuery,
  type MessageHistorySummaryQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { MessageHistoryService } from './message-history.service';

/**
 * Message History (Reference `/message-history`). Needs `msg.history.read` (the Manager preset and above, like Reference's
 * `workspace.role:manager`); which rows come back is the caller's read scope for `inbox.conversation.read`, see `MessageHistoryService`.
 * The file export is the delivery log's own (`inbox.logs.export`) and its list and download are `GET /inbox/message-logs/exports?kind=messages`.
 */
@ApiTags('message-history')
@ActorKinds('user')
@Controller({ path: 'message-history', version: '2' })
export class MessageHistoryController {
  constructor(private readonly history: MessageHistoryService) {}

  @Get()
  @RequirePermission('msg.history.read')
  @ApiOperation({
    summary: 'The message feed (cursor paginated, newest first)',
    description:
      'Every message sent or received, and the recipient rows of broadcasts, campaigns and scheduled messages. Filters: range or from/to, dir, type, source, status, channelId, templateId, campaignId, broadcastId, scheduledId, q.',
  })
  async list(@Query(zodPipe(listMessageHistoryQuerySchema)) query: ListMessageHistoryQuery) {
    return this.history.list(query);
  }

  @Get('summary')
  @RequirePermission('msg.history.read')
  @ApiOperation({
    summary: 'The KPI cards and the tab counts of the window',
    description:
      'Real counts over the window and the scoping filters (channel, template, campaign, broadcast, scheduled); dir, type, source, status and q do not change them.',
  })
  async summary(
    @Query(zodPipe(messageHistorySummaryQuerySchema)) query: MessageHistorySummaryQuery,
  ) {
    return this.history.summary(query);
  }

  @Get('insights')
  @RequirePermission('msg.history.read')
  @ApiOperation({
    summary: 'The volume chart, the type mix and the most active conversations',
    description: 'Follow every filter of the feed, as Reference did.',
  })
  async insights(
    @Query(zodPipe(messageHistorySummaryQuerySchema)) query: MessageHistorySummaryQuery,
  ) {
    return this.history.insights(query);
  }

  @Post('exports')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('inbox.logs.export')
  @ApiOperation({
    summary:
      'Export the feed with the current filters as CSV; built in the background and announced by email (202)',
  })
  async requestExport(
    @Body(zodPipe(createMessageHistoryExportSchema)) body: CreateMessageHistoryExportInput,
  ) {
    return this.history.requestExport(body);
  }

  @Get(':id')
  @RequirePermission('msg.history.read')
  @ApiOperation({
    summary:
      'One message or recipient row: the text, who and what, the failure and every step it went through',
    description: 'The id is `m:<uuid>`, `b:<uuid>`, `c:<uuid>` or `s:<uuid>` as the feed gives it.',
  })
  async detail(@Param('id', zodPipe(messageHistoryIdSchema)) id: string) {
    return this.history.detail(id);
  }
}
