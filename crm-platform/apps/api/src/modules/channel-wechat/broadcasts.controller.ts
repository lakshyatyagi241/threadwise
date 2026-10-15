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
import { createWechatBroadcastSchema, type CreateWechatBroadcastInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { BroadcastsService } from './broadcasts.service';

/** WeChat broadcasts: audience, compose, list, send, retry, delete. */
@ApiTags('wechat')
@ActorKinds('user')
// WeChat setup and broadcasts are entirely the extra-channels feature; the inbound webhook (separate, public controller) stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'wechat', version: '2' })
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get('channels/:id/chats')
  @RequirePermission('wechat.broadcasts.read')
  @ApiOperation({
    summary:
      'The followers a channel carries: the audience of a picked-users broadcast (newest 1000)',
  })
  chats(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.chats(id);
  }

  @Get('broadcasts/compose')
  @RequirePermission('wechat.broadcasts.read')
  @ApiOperation({ summary: 'Channels and WeChat templates for the compose page' })
  compose() {
    return this.broadcasts.compose();
  }

  @Get('broadcasts')
  @RequirePermission('wechat.broadcasts.read')
  @ApiOperation({ summary: 'The 50 newest broadcasts' })
  list() {
    return this.broadcasts.list();
  }

  @Post('broadcasts')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('wechat.broadcasts.manage')
  @ApiOperation({
    summary: 'Save a draft with a frozen recipient list',
    description:
      '422 WECH_TOO_FEW_RECIPIENTS when a picked-users broadcast has fewer than two followers that belong to the channel.',
  })
  create(@Body(zodPipe(createWechatBroadcastSchema)) body: CreateWechatBroadcastInput) {
    return this.broadcasts.create(body);
  }

  @Post('broadcasts/:id/start')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('wechat.broadcasts.manage')
  @ApiOperation({
    summary: 'Send the mass message (a worker job makes the one WeChat call)',
    description:
      '422 WECH_CHANNEL_UNAVAILABLE for a missing or paused channel; 409 WECH_ALREADY_SENT once it is done. WeChat counts it against ' +
      "the account's monthly mass-send allowance (about 4 for a Service Account).",
  })
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.start(id);
  }

  @Post('broadcasts/:id/retry')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('wechat.broadcasts.manage')
  @ApiOperation({
    summary: 'Send again after a failure',
    description:
      '409 WECH_NOT_RETRYABLE unless the broadcast failed (or has been stuck sending for 15 minutes).',
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.retry(id);
  }

  @Delete('broadcasts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('wechat.broadcasts.manage')
  @ApiOperation({ summary: 'Delete a broadcast and its recipients, in any status' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.broadcasts.remove(id);
  }
}
