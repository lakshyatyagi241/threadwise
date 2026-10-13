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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSavedReplySchema,
  listSavedRepliesQuerySchema,
  updateSavedReplySchema,
  useSavedReplySchema,
  type CreateSavedReplyInput,
  type ListSavedRepliesQuery,
  type UpdateSavedReplyInput,
  type UseSavedReplyInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SavedRepliesService } from './saved-replies.service';

/**
 * Saved replies (TW-TIB1-024). Reading and inserting need the right to reply in the inbox (the composer's picker) or to manage saved
 * replies (the Settings screen); creating needs `inbox.savedreply.manage`; changing or deleting is the manage right for a shared reply
 * and the owner for a personal one, decided in the service where the row is known.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox/saved-replies', version: '2' })
export class SavedRepliesController {
  constructor(private readonly replies: SavedRepliesService) {}

  @Get()
  @RequirePermission('inbox.conversation.reply', 'inbox.savedreply.manage')
  @ApiOperation({
    summary: 'The shared replies and your own personal ones, most used first',
    description:
      'Search matches shortcut, title and body. `scope` is all, shared or mine; `channelKind` leaves out replies restricted to other channels. `total` and `limit` are the plan meter.',
  })
  list(@Query(zodPipe(listSavedRepliesQuerySchema)) query: ListSavedRepliesQuery) {
    return this.replies.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('inbox.savedreply.manage')
  @ApiOperation({
    summary: 'Create a saved reply (shared, or personal with scope "mine")',
    description:
      'The shortcut is normalised (`Thank You` is `thank_you`) and unique per owner: 409 SAVED_REPLY_SHORTCUT_TAKEN. Refused with 422 PLAN_LIMIT_REACHED at the plan limit.',
  })
  create(@Body(zodPipe(createSavedReplySchema)) body: CreateSavedReplyInput) {
    return this.replies.create(body);
  }

  @Get(':id')
  @RequirePermission('inbox.conversation.reply', 'inbox.savedreply.manage')
  @ApiOperation({ summary: 'One saved reply' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.replies.get(id);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('inbox.conversation.reply', 'inbox.savedreply.manage')
  @ApiOperation({
    summary: 'Edit a saved reply',
    description:
      "Any subset of fields with the `rowVersion` read; a stale one is 409 ROW_VERSION_CONFLICT. A shared reply needs `inbox.savedreply.manage` (403 SAVED_REPLY_NOT_EDITABLE), a personal one is its owner's. The scope cannot change.",
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateSavedReplySchema)) body: UpdateSavedReplyInput,
  ) {
    return this.replies.update(id, body);
  }

  @Delete(':id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.conversation.reply', 'inbox.savedreply.manage')
  @ApiOperation({ summary: 'Delete a saved reply (same rights as editing it)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.replies.remove(id);
  }

  @Post(':id/duplicate')
  @Idempotent()
  @RequirePermission('inbox.savedreply.manage')
  @ApiOperation({
    summary: 'Copy a reply (same scope; the title gets "(copy)" and the shortcut a free suffix)',
    description: 'Counts against the plan limit.',
  })
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.replies.duplicate(id);
  }

  @Post(':id/use')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.reply')
  @ApiOperation({
    summary: 'Fill the reply in for a conversation and count the use (sends nothing)',
    description:
      "Variables come from the conversation's contact, the caller and the workspace. A variable that cannot be filled stays as written and is listed in `issues` (reason `unknown` or `empty`). 404 for a conversation the caller cannot see, 422 SAVED_REPLY_CHANNEL_MISMATCH when the reply is restricted to other channels.",
  })
  use(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(useSavedReplySchema)) body: UseSavedReplyInput,
  ) {
    return this.replies.use(id, body);
  }
}
