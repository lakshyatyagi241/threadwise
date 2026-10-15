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
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  connectLineChannelSchema,
  saveLineRotationSchema,
  type ConnectLineChannelInput,
  type SaveLineRotationInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { ChannelsService } from './channels.service';

/** LINE channels: connect by token and secret, re-hook, pause, token rotation, disconnect. */
@ApiTags('line')
@ActorKinds('user')
// LINE setup and broadcasts are entirely the extra-channels feature; the inbound webhook (separate, public controller) stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'line/channels', version: '2' })
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @RequirePermission('line.channels.read')
  @ApiOperation({
    summary: "The workspace's LINE channels, oldest first (never any token, secret or key)",
  })
  list() {
    return this.channels.list();
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('line.channels.manage')
  @ApiOperation({
    summary: 'Connect a LINE channel from a pasted channel access token and channel secret',
    description:
      '422 LINE_TOKEN_REJECTED when LINE does not accept the token. The same Official Account pasted again updates its row. ' +
      'When LINE refuses the webhook the channel is saved and `webhookError` says why.',
  })
  connect(@Body(zodPipe(connectLineChannelSchema)) body: ConnectLineChannelInput) {
    return this.channels.connect(body);
  }

  @Post(':id/retry-webhook')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('line.channels.manage')
  @ApiOperation({ summary: 'Register the webhook again ("Re-hook")' })
  retryWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.retryWebhook(id);
  }

  @Post(':id/toggle')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('line.channels.manage')
  @ApiOperation({ summary: 'Pause or enable a channel' })
  toggle(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.toggle(id);
  }

  @Put(':id/rotation')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('line.channels.manage')
  @ApiOperation({
    summary: 'Turn token rotation (v2.1) on, or off with blank fields',
    description:
      'Saves the Assertion Signing Key (encrypted) and its kid and mints the first token at once. 422 LINE_ROTATION_FAILED when the ' +
      'Channel ID is missing, the key does not sign or LINE refuses the assertion.',
  })
  saveRotation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(saveLineRotationSchema)) body: SaveLineRotationInput,
  ) {
    return this.channels.saveRotation(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('line.channels.manage')
  @ApiOperation({ summary: 'Remove a channel and its broadcasts; inbox threads stay' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.channels.remove(id);
  }
}
