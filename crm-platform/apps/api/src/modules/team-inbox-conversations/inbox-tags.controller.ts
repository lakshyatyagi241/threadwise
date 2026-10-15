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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applyConversationTagSchema,
  createInboxTagSchema,
  updateInboxTagSchema,
  type ApplyConversationTagInput,
  type CreateInboxTagInput,
  type UpdateInboxTagInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { InboxTagsService } from './inbox-tags.service';

/**
 * Conversation tags (TW-TIB1-036, 037): the workspace library (`/inbox/tags`, read by anyone who can open the inbox, changed with
 * `inbox.tag.manage`) and a thread's tags (`/inbox/conversations/:id/tags`, `inbox.conversation.tag`). The product has one word for
 * this, "tag" (the reference calls them tags too); the original `/labels` paths stay registered as aliases so existing clients keep working.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox', version: '2' })
export class InboxTagsController {
  constructor(private readonly tags: InboxTagsService) {}

  @Get(['tags', 'labels'])
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({ summary: 'The workspace tags with how many conversations carry each' })
  async list() {
    return this.tags.list();
  }

  @Post(['tags', 'labels'])
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inbox.tag.manage')
  @ApiOperation({
    summary: 'Create a tag',
    description:
      'The name is unique ignoring case (409 CON_TAG_NAME_TAKEN) and counts against the plan’s tag limit. It is also a tag on contacts.',
  })
  async create(@Body(zodPipe(createInboxTagSchema)) body: CreateInboxTagInput) {
    return this.tags.create(body);
  }

  @Patch(['tags/:id', 'labels/:id'])
  @RequirePermission('inbox.tag.manage')
  @ApiOperation({
    summary: 'Rename, recolour or describe a tag',
    description: 'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise).',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateInboxTagSchema)) body: UpdateInboxTagInput,
  ) {
    return this.tags.update(id, body);
  }

  @Delete(['tags/:id', 'labels/:id'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.tag.manage')
  @ApiOperation({ summary: 'Delete a tag (it leaves every conversation and contact)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tags.remove(id);
  }

  @Post(['conversations/:id/tags', 'conversations/:id/labels'])
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.tag')
  @ApiOperation({
    summary: 'Put a tag on a conversation',
    description:
      'Name it by `tagId` or by `name`. A name that does not exist yet creates the tag and needs `inbox.tag.manage` too (403 INBOX_LABEL_CREATE_FORBIDDEN). Putting on a tag already there is a no-op.',
  })
  async apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(applyConversationTagSchema)) body: ApplyConversationTagInput,
  ) {
    return this.tags.apply(id, body);
  }

  @Delete(['conversations/:id/tags/:tagId', 'conversations/:id/labels/:tagId'])
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.tag')
  @ApiOperation({ summary: 'Take a tag off a conversation (a tag not on it is a no-op)' })
  async withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    return this.tags.withdraw(id, tagId);
  }
}
