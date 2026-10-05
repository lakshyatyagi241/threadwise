import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  TCHAT_ATTACHMENT_MAX_BYTES,
  addTchatChannelMemberSchema,
  createTchatChannelSchema,
  createTchatInvitationSchema,
  editTchatMessageSchema,
  listTchatMessagesQuerySchema,
  markTchatReadSchema,
  openTchatDirectSchema,
  postTchatMessageSchema,
  reactTchatMessageSchema,
  searchTchatMessagesQuerySchema,
  type AddTchatChannelMemberInput,
  type CreateTchatChannelInput,
  type CreateTchatInvitationInput,
  type EditTchatMessageInput,
  type ListTchatMessagesQuery,
  type MarkTchatReadInput,
  type OpenTchatDirectInput,
  type PostTchatMessageInput,
  type ReactTchatMessageInput,
  type SearchTchatMessagesQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ChannelsService } from './channels.service';
import { InvitationsService } from './invitations.service';
import { MessagesService, type UploadedAttachment } from './messages.service';
import { PresenceService } from './presence.service';
import { RequirePlanFeature } from '../plans-subscriptions-trials';

const upload = FileInterceptor('attachment', {
  limits: { fileSize: TCHAT_ATTACHMENT_MAX_BYTES, files: 1 },
});

/**
 * Internal team chat (TW-TCHAT-001..027). Reading, posting, reacting and asking for an invitation need no permission key (any
 * staff user is a member, as in Reference); the three admin keys guard channel management, invitation decisions and moderation.
 * Every route names its channel or message by uuid, and the service checks the caller's access to that channel.
 *
 * Literal paths (`dm`, `members`, `presence`, `invitations`) are declared before the `:id` routes that share their first segment.
 */
@ApiTags('team-chat')
@ActorKinds('user')
// Team chat is entirely the plan feature: every route (reads included) needs it.
@RequirePlanFeature('team_chat')
@Controller({ path: 'team-chat', version: '2' })
export class TeamChatController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
    private readonly invitations: InvitationsService,
    private readonly presence: PresenceService,
  ) {}

  // --- channels --------------------------------------------------------------------------------------------------------

  @Get('channels')
  @ApiOperation({
    summary: 'The channels the caller can see, with unread counts and what the caller may do',
    description:
      'Public channels first, then private and direct channels the caller belongs to. Creates #general on first use.',
  })
  async listChannels() {
    return this.channels.list();
  }

  @Post('channels')
  @Idempotent()
  @RequirePermission('tchat.channel.manage')
  @ApiOperation({ summary: 'Create a public or private channel' })
  async createChannel(@Body(zodPipe(createTchatChannelSchema)) body: CreateTchatChannelInput) {
    return this.channels.create(body);
  }

  @Post('dm')
  @ApiOperation({ summary: 'Open (or create) the direct message with one teammate' })
  async openDirect(@Body(zodPipe(openTchatDirectSchema)) body: OpenTchatDirectInput) {
    return this.channels.openDirect(body);
  }

  @Get('members')
  @ApiOperation({ summary: 'Everyone in the workspace: the members rail and the mention picker' })
  async roster() {
    return this.channels.roster();
  }

  @Post('presence')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'I am online (valid for 45 seconds)' })
  async ping() {
    return this.presence.ping();
  }

  @Delete('channels/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('tchat.channel.manage')
  @ApiOperation({ summary: 'Delete a channel and its messages (#general is protected)' })
  async deleteChannel(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.channels.remove(id);
  }

  @Get('channels/:id/members')
  @ApiOperation({ summary: 'Who is in a channel (the roster for a public one)' })
  async channelMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.members(id);
  }

  @Post('channels/:id/members')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Add a teammate to a private channel (a channel manager or the channel admin)',
  })
  async addChannelMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(addTchatChannelMemberSchema)) body: AddTchatChannelMemberInput,
  ): Promise<void> {
    await this.channels.addMember(id, body);
  }

  @Delete('channels/:id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a teammate from a private channel, or leave it yourself' })
  async removeChannelMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.channels.removeMember(id, userId);
  }

  // --- a channel's messages --------------------------------------------------------------------------------------------

  @Get('channels/:id/messages')
  @ApiOperation({
    summary: 'History (newest page, ascending) or, with `after`, only newer messages',
    description:
      '`limit` is clamped to 10..50. `before` is the cursor from `page.nextCursor` and loads older messages. `after` is a message id and returns the messages after it, oldest first; `page.hasMore` then means "ask again now".',
  })
  async listMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listTchatMessagesQuerySchema)) query: ListTchatMessagesQuery,
  ) {
    return this.messages.list(id, query);
  }

  @Post('channels/:id/messages')
  @Idempotent()
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(upload)
  @ApiOperation({
    summary: 'Post a message (text, a reply, one attachment up to 20 MB)',
    description: 'Send an Idempotency-Key so a retry after a lost response cannot post twice.',
  })
  async postMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(postTchatMessageSchema)) body: PostTchatMessageInput,
    @UploadedFile() file: UploadedAttachment | undefined,
  ) {
    return this.messages.post(id, body, file);
  }

  @Get('channels/:id/pinned')
  @ApiOperation({ summary: "A channel's pinned messages, newest pin first" })
  async pinned(@Param('id', ParseUUIDPipe) id: string) {
    return this.messages.pinned(id);
  }

  @Get('channels/:id/search')
  @ApiOperation({ summary: 'Search a channel by text (newest first, at most 50)' })
  async search(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(searchTchatMessagesQuerySchema)) query: SearchTchatMessagesQuery,
  ) {
    return this.messages.search(id, query.q);
  }

  @Post('channels/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a channel read up to a message (default: the newest); never moves back',
  })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(markTchatReadSchema)) body: MarkTchatReadInput,
  ) {
    return this.messages.markRead(id, body);
  }

  @Post('channels/:id/typing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'I am typing in this channel (valid for 8 seconds)' })
  async typing(@Param('id', ParseUUIDPipe) id: string) {
    return this.presence.typing(id);
  }

  @Get('channels/:id/activity')
  @ApiOperation({ summary: 'Who is typing in this channel and who is online' })
  async activity(@Param('id', ParseUUIDPipe) id: string) {
    return this.presence.activity(id);
  }

  // --- one message -----------------------------------------------------------------------------------------------------

  @Patch('messages/:id')
  @ApiOperation({ summary: 'Edit my message within 15 minutes of sending it' })
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(editTchatMessageSchema)) body: EditTchatMessageInput,
  ) {
    return this.messages.edit(id, body);
  }

  @Delete('messages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete my message (or anyone's, with tchat.message.moderate)" })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.messages.remove(id);
  }

  @Post('messages/:id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pin or unpin a message (toggle): its author, or tchat.message.moderate',
  })
  async pin(@Param('id', ParseUUIDPipe) id: string) {
    return this.messages.togglePin(id);
  }

  @Post('messages/:id/reactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'React with an emoji, or take the same reaction back (toggle)' })
  async react(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reactTchatMessageSchema)) body: ReactTchatMessageInput,
  ) {
    return this.messages.react(id, body);
  }

  @Get('messages/:id/attachment')
  @ApiExcludeEndpoint()
  async attachment(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.messages.attachment(id);
    res
      .status(200)
      .setHeader('content-type', file.mime)
      .setHeader('content-length', String(file.bytes.length))
      // Images show inline; everything else downloads. The type was decided from the bytes at upload, and nosniff plus a
      // sandboxed CSP keep a browser from running anything it finds in the file.
      .setHeader(
        'content-disposition',
        `${file.isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      .setHeader('x-content-type-options', 'nosniff')
      .setHeader('content-security-policy', "default-src 'none'; sandbox")
      .setHeader('cache-control', 'private, max-age=3600')
      .send(file.bytes);
  }

  // --- invitations -----------------------------------------------------------------------------------------------------

  @Get('invitations')
  @ApiOperation({
    summary:
      "Invitation requests: everyone's for a decider, the caller's own for anyone else (newest 50)",
  })
  async listInvitations() {
    return this.invitations.list();
  }

  @Post('invitations')
  @Idempotent()
  @ApiOperation({
    summary: 'Ask for a teammate to be added (decided on the spot when the caller can decide)',
  })
  async createInvitation(
    @Body(zodPipe(createTchatInvitationSchema)) body: CreateTchatInvitationInput,
  ) {
    return this.invitations.create(body);
  }

  @Post('invitations/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tchat.invite.approve')
  @ApiOperation({ summary: 'Approve a pending invitation request' })
  async approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.approve(id);
  }

  @Post('invitations/:id/decline')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tchat.invite.approve')
  @ApiOperation({ summary: 'Decline a pending invitation request' })
  async decline(@Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.decline(id);
  }
}
