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
import { connectWechatChannelSchema, type ConnectWechatChannelInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { ChannelsService } from './channels.service';

/** WeChat Official Account channels: connect, the address and Token to paste into WeChat, re-check, pause, disconnect. */
@ApiTags('wechat')
@ActorKinds('user')
// WeChat setup and broadcasts are entirely the extra-channels feature; the inbound webhook (separate, public controller) stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'wechat/channels', version: '2' })
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @RequirePermission('wechat.channels.read')
  @ApiOperation({
    summary: "The workspace's connected WeChat channels, oldest first (never any secret)",
  })
  list() {
    return this.channels.list();
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('wechat.channels.manage')
  @ApiOperation({
    summary: 'Connect an Official Account from a pasted AppID, AppSecret and Token',
    description:
      '422 WECH_CREDENTIALS_REJECTED when WeChat does not give an access token for the AppID and AppSecret. The same AppID pasted again ' +
      'updates its row and keeps its webhook address.',
  })
  connect(@Body(zodPipe(connectWechatChannelSchema)) body: ConnectWechatChannelInput) {
    return this.channels.connect(body);
  }

  @Get(':id/server-config')
  @RequirePermission('wechat.channels.manage')
  @ApiOperation({
    summary: 'The address and Token to paste into the WeChat console',
    description:
      'The Token is the one the person chose; only people who can manage the channel see it.',
  })
  serverConfig(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.serverConfig(id);
  }

  @Post(':id/recheck')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('wechat.channels.manage')
  @ApiOperation({
    summary: 'Re-validate the saved credentials (asks WeChat for a new access token)',
  })
  recheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.recheck(id);
  }

  @Post(':id/toggle')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('wechat.channels.manage')
  @ApiOperation({ summary: 'Pause or resume a channel' })
  toggle(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.toggle(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('wechat.channels.manage')
  @ApiOperation({
    summary: 'Disconnect a channel: the channel and its broadcasts are removed; inbox threads stay',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.channels.remove(id);
  }
}
