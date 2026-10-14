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
import { connectViberChannelSchema, type ConnectViberChannelInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { ChannelsService } from './channels.service';

/** Viber channels: connect by token, re-hook, pause, disconnect (TW-VIB-001, 002, 007). */
@ApiTags('viber')
@ActorKinds('user')
// Viber setup and broadcasts are entirely the extra-channels feature; the inbound webhook (separate, public controller) stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'viber/channels', version: '2' })
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @RequirePermission('viber.channels.read')
  @ApiOperation({
    summary: "The workspace's connected Viber channels, oldest first (never any token)",
  })
  list() {
    return this.channels.list();
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('viber.channels.manage')
  @ApiOperation({
    summary: 'Connect a Viber Public Account from its pasted auth token',
    description:
      '422 VIB_TOKEN_REJECTED when Viber does not accept the token. The same Viber account pasted again updates its row. ' +
      'When Viber refuses the webhook the channel is saved and `webhookError` says why.',
  })
  connect(@Body(zodPipe(connectViberChannelSchema)) body: ConnectViberChannelInput) {
    return this.channels.connect(body);
  }

  @Post(':id/retry-webhook')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('viber.channels.manage')
  @ApiOperation({ summary: 'Register the webhook again ("Re-hook")' })
  retryWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.retryWebhook(id);
  }

  @Post(':id/toggle')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('viber.channels.manage')
  @ApiOperation({ summary: 'Pause or resume a channel' })
  toggle(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.toggle(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('viber.channels.manage')
  @ApiOperation({
    summary:
      'Disconnect a channel: its Viber webhook is removed and the channel deleted; inbox threads stay',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.channels.remove(id);
  }
}
