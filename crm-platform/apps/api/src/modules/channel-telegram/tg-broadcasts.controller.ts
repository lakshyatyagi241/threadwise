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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createTgBroadcastSchema, type CreateTgBroadcastInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { TgBroadcastsService } from './tg-broadcasts.service';

/** Telegram broadcasts: audience, compose, list, start, pause, retry, delete (TW-TG-010 to 014). */
@ApiTags('telegram')
@ActorKinds('user')
@Controller({ path: 'telegram', version: '2' })
export class TgBroadcastsController {
  constructor(private readonly broadcasts: TgBroadcastsService) {}

  @Get('bots/:id/chats')
  @RequirePermission('tg.broadcasts.read')
  @ApiOperation({ summary: 'The chats a bot carries: the audience it can message (newest 500)' })
  chats(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.chats(id);
  }

  @Get('broadcasts/compose')
  @RequirePermission('tg.broadcasts.read')
  @ApiOperation({ summary: 'Bots and Telegram templates for the compose page' })
  compose() {
    return this.broadcasts.compose();
  }

  @Get('broadcasts')
  @RequirePermission('tg.broadcasts.read')
  @ApiOperation({ summary: 'The 50 newest broadcasts, with totals across all of them' })
  list() {
    return this.broadcasts.list();
  }

  @Post('broadcasts')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('tg.broadcasts.manage')
  @ApiOperation({
    summary: 'Save a draft with a frozen recipient list',
    description:
      '422 TG_BROADCAST_EMPTY without a message or file; 422 TG_NO_RECIPIENTS when none of the chats belong to the bot.',
  })
  create(@Body(zodPipe(createTgBroadcastSchema)) body: CreateTgBroadcastInput) {
    return this.broadcasts.create(body);
  }

  @Post('broadcasts/:id/start')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tg.broadcasts.manage')
  @ApiOperation({
    summary: 'Start sending (a worker job sends it)',
    description:
      '422 TG_BOT_UNAVAILABLE for a missing or paused bot; 422 TG_NOTHING_TO_SEND with nobody pending.',
  })
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.start(id);
  }

  @Post('broadcasts/:id/pause')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tg.broadcasts.manage')
  @ApiOperation({ summary: 'Pause: back to draft, unsent chats stay pending' })
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.pause(id);
  }

  @Post('broadcasts/:id/retry')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tg.broadcasts.manage')
  @ApiOperation({
    summary: 'Put failed chats back to pending (blocked ones stay blocked)',
    description: '422 TG_NOTHING_TO_RETRY with none failed; 409 while sending.',
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.retry(id);
  }

  @Delete('broadcasts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('tg.broadcasts.manage')
  @ApiOperation({ summary: 'Delete a broadcast and its recipients, in any status' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.broadcasts.remove(id);
  }
}
