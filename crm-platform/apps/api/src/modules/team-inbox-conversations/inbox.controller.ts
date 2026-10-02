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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createConversationNoteSchema,
  listConversationEventsQuerySchema,
  listConversationNotesQuerySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markConversationReadSchema,
  sendMessageSchema,
  setConversationStatusSchema,
  type CreateConversationNoteInput,
  type ListConversationEventsQuery,
  type ListConversationNotesQuery,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MarkConversationReadInput,
  type SendMessageInput,
  type SetConversationStatusInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { chatMediaConfig } from '../../infra/providers/chat-conversations/media';
import { InboxConversationsService } from './inbox-conversations.service';
import { InboxMediaService, type UploadedFile as UploadedFileShape } from './inbox-media.service';
import { InboxNotesService } from './inbox-notes.service';
import { InboxThreadService } from './inbox-thread.service';
import { InboxTimelineService } from './inbox-timeline.service';

const upload = FileInterceptor('file', {
  limits: { fileSize: Math.max(...Object.values(chatMediaConfig().maxBytes)), files: 1 },
});

/**
 * The agent's inbox (WD-TIB1): list, counts, one conversation, its thread, the composer's sends, notes, timeline, attachments.
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
  ) {}

  // --- the list ---------------------------------------------------------------------------------------------------------------

  @Get('conversations')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'The conversation list (cursor paginated)',
    description:
      'Tabs all / mine / unassigned / unread, status (default: open and pending), channel, search by name, number or last message. `meta.counts` carries the tab badges.',
  })
  async list(@Query(zodPipe(listConversationsQuerySchema)) query: ListConversationsQuery) {
    return this.conversations.list(query);
  }

  @Get('counts')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({ summary: 'Tab badges and the archived count (the safety poll)' })
  async counts() {
    return this.conversations.counts();
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

  // --- one conversation ----------------------------------------------------------------------------------------------------------

  @Get('conversations/:id')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'One conversation: header, contact summary, window state, assignee',
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.detail(id);
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
    summary: 'Resolve, close, reopen, or park a conversation as pending',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). A move the state machine does not allow is 422 CONVERSATION_STATUS_INVALID; the status the thread already has is a no-op.',
  })
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setConversationStatusSchema)) body: SetConversationStatusInput,
  ) {
    return this.conversations.setStatus(id, body);
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
