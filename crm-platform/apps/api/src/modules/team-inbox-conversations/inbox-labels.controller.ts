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
  applyConversationLabelSchema,
  createInboxLabelSchema,
  updateInboxLabelSchema,
  type ApplyConversationLabelInput,
  type CreateInboxLabelInput,
  type UpdateInboxLabelInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { InboxLabelsService } from './inbox-labels.service';

/**
 * Conversation labels (TW-TIB1-036, 037): the workspace library (`/inbox/labels`, read by anyone who can open the inbox, changed with
 * `inbox.tag.manage`) and a thread's labels (`/inbox/conversations/:id/labels`, `inbox.conversation.tag`).
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox', version: '2' })
export class InboxLabelsController {
  constructor(private readonly labels: InboxLabelsService) {}

  @Get('labels')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({ summary: 'The workspace labels with how many conversations carry each' })
  async list() {
    return this.labels.list();
  }

  @Post('labels')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inbox.tag.manage')
  @ApiOperation({
    summary: 'Create a label',
    description:
      'The name is unique ignoring case (409 CON_TAG_NAME_TAKEN) and counts against the plan’s tag limit. It is also a tag on contacts.',
  })
  async create(@Body(zodPipe(createInboxLabelSchema)) body: CreateInboxLabelInput) {
    return this.labels.create(body);
  }

  @Patch('labels/:id')
  @RequirePermission('inbox.tag.manage')
  @ApiOperation({
    summary: 'Rename, recolour or describe a label',
    description: 'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise).',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateInboxLabelSchema)) body: UpdateInboxLabelInput,
  ) {
    return this.labels.update(id, body);
  }

  @Delete('labels/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.tag.manage')
  @ApiOperation({ summary: 'Delete a label (it leaves every conversation and contact)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.labels.remove(id);
  }

  @Post('conversations/:id/labels')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.tag')
  @ApiOperation({
    summary: 'Put a label on a conversation',
    description:
      'Name it by `tagId` or by `name`. A name that does not exist yet creates the label and needs `inbox.tag.manage` too (403 INBOX_LABEL_CREATE_FORBIDDEN). Putting on a label already there is a no-op.',
  })
  async apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(applyConversationLabelSchema)) body: ApplyConversationLabelInput,
  ) {
    return this.labels.apply(id, body);
  }

  @Delete('conversations/:id/labels/:tagId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.tag')
  @ApiOperation({ summary: 'Take a label off a conversation (a label not on it is a no-op)' })
  async withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    return this.labels.withdraw(id, tagId);
  }
}
