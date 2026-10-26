import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createConversationNoteSchema,
  createMessageLogExportSchema,
  inboxCountsQuerySchema,
  listConversationEventsQuerySchema,
  listConversationGroupMembersQuerySchema,
  listConversationNotesQuerySchema,
  listConversationsQuerySchema,
  listInboxTemplatesQuerySchema,
  listMessageLogExportsQuerySchema,
  listMessagesQuerySchema,
  markConversationReadSchema,
  sendMessageSchema,
  setConversationPrioritySchema,
  setConversationStatusSchema,
  markSpamConversationSchema,
  snoozeConversationSchema,
  type CreateConversationNoteInput,
  type CreateMessageLogExportInput,
  type InboxCountsQuery,
  type ListConversationEventsQuery,
  type ListConversationGroupMembersQuery,
  type ListConversationNotesQuery,
  type ListConversationsQuery,
  type ListInboxTemplatesQuery,
  type ListMessageLogExportsQuery,
  type ListMessagesQuery,
  type MarkConversationReadInput,
  type SendMessageInput,
  type SetConversationPriorityInput,
  type SetConversationStatusInput,
  type MarkSpamConversationInput,
  type SnoozeConversationInput,
  openConversationSchema,
  type OpenConversationInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { chatMediaConfig } from '../../infra/providers/chat-conversations/media';
import { InboxConversationsService } from './inbox-conversations.service';
import { InboxMessageLogService } from './inbox-message-log.service';
import { InboxMediaService, type UploadedFile as UploadedFileShape } from './inbox-media.service';
import { InboxNotesService } from './inbox-notes.service';
import { InboxThreadService } from './inbox-thread.service';
import { InboxTimelineService } from './inbox-timeline.service';
import { InboxTriageService } from './inbox-triage.service';

const upload = FileInterceptor('file', {
  limits: { fileSize: Math.max(...Object.values(chatMediaConfig().maxBytes)), files: 1 },
});

/**
 * The agent's inbox (TW-TIB1): list, counts, one conversation, its thread, the composer's sends, notes, timeline, attachments.
 * Assignment (`assign`, `assignees`) is the routing domain's and lives in `team-inbox-routing-sla`.
 *
 * Every route names its conversation by uuid. Which conversations a caller may see is their read scope for
 * `inbox.conversation.read` (all, team, own); one outside it answers 404, exactly like one that does not exist. Acting on a
 * conversation (reply, resolve, note) also needs that permission's own scope to cover it.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox', version: '2' })
export class InboxController {
  constructor(
    private readonly conversations: InboxConversationsService,
    private readonly thread: InboxThreadService,
    private readonly notes: InboxNotesService,
    private readonly timeline: InboxTimelineService,
    private readonly media: InboxMediaService,
    private readonly messageLogs: InboxMessageLogService,
    private readonly triage: InboxTriageService,
  ) {}

  // --- the list ---------------------------------------------------------------------------------------------------------------

  @Get('conversations')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'The conversation list (cursor paginated)',
    description:
      'Tabs all / mine / unassigned / unread, status (default: open), channel, search by name, number or last message. `meta.counts` carries the tab badges.',
  })
  async list(@Query(zodPipe(listConversationsQuerySchema)) query: ListConversationsQuery) {
    return this.conversations.list(query);
  }

  @Get('counts')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'Tab badges and the archived count (the safety poll)',
    description:
      'The list’s filters (status, channel, search, tags, assignment, agents, dates, archived; not the tab, sort or page). With none, the open threads. Each badge equals what its tab lists under the same filters.',
  })
  async counts(@Query(zodPipe(inboxCountsQuerySchema)) query: InboxCountsQuery) {
    return this.conversations.counts(query);
  }

  @Post('media')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inbox.conversation.reply')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  @ApiOperation({
    summary: 'Upload an attachment before sending it',
    description:
      'Multipart field `file`. Checked by content (type, size, magic bytes); answers the id a `kind: media` message names. Held 24 hours for the uploader.',
  })
  async uploadMedia(@UploadedFile() file: UploadedFileShape | undefined) {
    return this.media.upload(file);
  }

  @Post('messages/:id/retry')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('inbox.conversation.reply')
  @ApiOperation({ summary: 'Put a failed outbound message back in the queue (202)' })
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.thread.retry(id);
  }

  @Get('messages/:id/log')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'The delivery log of one message: its status now and every event, oldest first',
    description:
      'Events of the last 90 days come from the live log, older ones from the archive (kept one year). Same visibility as the thread.',
  })
  async messageLog(@Param('id', ParseUUIDPipe) id: string) {
    return this.messageLogs.messageLog(id);
  }

  // --- export of the message log -------------------------------------------------------------------------------------------------

  @Post('message-logs/exports')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('inbox.logs.export')
  @ApiOperation({
    summary:
      'Export the delivery log of a date range (up to a year back); built in the background and announced by email (202)',
  })
  async requestLogExport(
    @Body(zodPipe(createMessageLogExportSchema)) body: CreateMessageLogExportInput,
  ) {
    return this.messageLogs.requestExport(body);
  }

  @Get('message-logs/exports')
  @RequirePermission('inbox.logs.export')
  @ApiOperation({ summary: 'The latest exports of the message log, newest first' })
  async listLogExports(
    @Query(zodPipe(listMessageLogExportsQuerySchema)) query: ListMessageLogExportsQuery,
  ) {
    return this.messageLogs.listExports(query.kind);
  }

  @Get('message-logs/exports/:id/download')
  @RequirePermission('inbox.logs.export')
  @ApiOperation({ summary: 'The finished export as CSV (kept 7 days)' })
  async downloadLogExport(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName } = await this.messageLogs.downloadExport(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }

  // --- one conversation ----------------------------------------------------------------------------------------------------------

  @Post('conversations/open')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.reply')
  @ApiOperation({
    summary: 'Open (or create) the conversation for a contact on a channel',
    description:
      'Answers `{ id }`. Creates the thread when the contact has none on that phone channel; 422 when the channel cannot start one or the contact has no number. The first message outside the 24 hour window must be a template.',
  })
  async open(@Body(zodPipe(openConversationSchema)) body: OpenConversationInput) {
    return this.thread.open(body.contactId, body.channelId);
  }

  @Get('conversations/:id')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'One conversation: header, contact summary, window state, assignee',
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.detail(id);
  }

  @Get('conversations/:id/group-members')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'The members of a personal-number group thread, for @mentions',
    description:
      'Read from the group directory (no call to WhatsApp). Empty for a thread that is not a group on a linked personal number.',
  })
  async groupMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listConversationGroupMembersQuerySchema))
    query: ListConversationGroupMembersQuery,
  ) {
    return this.conversations.groupMembers(id, query);
  }

  @Get('conversations/:id/messages')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'The thread, gap-free by `seq`',
    description:
      'No cursor: the newest `limit`. `before` (a seq) loads older ones; `afterSeq` returns newer ones, oldest first, for gap filling after a reconnect.',
  })
  async messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.thread.listMessages(id, query);
  }

  @Get('conversations/:id/templates')
  @RequirePermission('inbox.conversation.reply')
  @ApiOperation({
    summary: 'The templates this conversation’s WhatsApp number can send',
    description:
      'Approved templates of the number the conversation runs on. One the inbox cannot fill in yet is listed with a `reason`. Send one with `POST .../messages` and `kind: template`.',
  })
  async templates(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listInboxTemplatesQuerySchema)) query: ListInboxTemplatesQuery,
  ) {
    return this.thread.listTemplates(id, query);
  }

  @Post('conversations/:id/messages')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('inbox.conversation.reply')
  @ApiOperation({
    summary: 'Send a message (202: stored as queued, sent by the worker)',
    description:
      'Send an Idempotency-Key and a `clientMessageId`: the same id twice returns the first message and sends once. Refused with SERVICE_WINDOW_CLOSED, PLAN_LIMIT_REACHED, CHANNEL_DISCONNECTED before anything is stored.',
  })
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    return this.thread.send(id, body);
  }

  @Post('conversations/:id/read')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'Clear the unread counter up to a message (`upToSeq`)',
    description: 'A message that arrived meanwhile stays unread; the counter never goes up.',
  })
  async read(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(markConversationReadSchema)) body: MarkConversationReadInput,
  ) {
    return this.conversations.markRead(id, body);
  }

  @Post('conversations/:id/status')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.resolve')
  @ApiOperation({
    summary: 'Resolve, close, or reopen a conversation',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). A move the state machine does not allow is 422 CONVERSATION_STATUS_INVALID; the status the thread already has is a no-op.',
  })
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setConversationStatusSchema)) body: SetConversationStatusInput,
  ) {
    return this.conversations.setStatus(id, body);
  }

  @Post('conversations/:id/priority')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.priority')
  @ApiOperation({
    summary: 'Set the priority (low, normal, high, urgent)',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). The priority the thread already has is a no-op.',
  })
  async priority(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setConversationPrioritySchema)) body: SetConversationPriorityInput,
  ) {
    return this.triage.setPriority(id, body);
  }

  @Post('conversations/:id/snooze')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.snooze')
  @ApiOperation({
    summary: 'Park a conversation until a time (it reopens by itself)',
    description:
      '`until` is 1 minute to 365 days ahead. Any status can be snoozed (a resolved, closed or spam thread too). The thread comes back as open at the time; to wake it now, move it to open with the status route.',
  })
  async snooze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(snoozeConversationSchema)) body: SnoozeConversationInput,
  ) {
    return this.triage.snooze(id, body);
  }

  @Post('conversations/:id/spam')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.resolve')
  @ApiOperation({
    summary:
      'Mark a conversation as spam (from any status); taking it off spam is the status route (spam to open)',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). The thread leaves the live lists and its wake time is dropped. Marking a spam thread again is a no-op.',
  })
  async spam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(markSpamConversationSchema)) body: MarkSpamConversationInput,
  ) {
    return this.triage.markSpam(id, body);
  }

  // --- notes and the timeline ---------------------------------------------------------------------------------------------------

  @Get('conversations/:id/notes')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({ summary: 'Internal notes, newest first' })
  async listNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listConversationNotesQuerySchema)) query: ListConversationNotesQuery,
  ) {
    return this.notes.list(id, query);
  }

  @Post('conversations/:id/notes')
  @Idempotent()
  @RequirePermission('inbox.conversation.note')
  @ApiOperation({
    summary: 'Add an internal note (never sent to the customer)',
    description: '`mentions` are user uuids of active members of this workspace.',
  })
  async addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createConversationNoteSchema)) body: CreateConversationNoteInput,
  ) {
    return this.notes.create(id, body);
  }

  @Delete('conversations/:id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.conversation.note')
  @ApiOperation({ summary: 'Delete a note (its author, or someone who manages assignments)' })
  async deleteNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<void> {
    await this.notes.remove(id, noteId);
  }

  @Get('conversations/:id/events')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({ summary: 'The activity timeline, newest first (cursor paginated)' })
  async events(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listConversationEventsQuerySchema)) query: ListConversationEventsQuery,
  ) {
    return this.timeline.list(id, query);
  }
}
