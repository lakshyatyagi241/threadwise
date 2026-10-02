import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { ChannelWebhooksService } from './channel-webhooks.service';

/**
 * Where a provider posts for one channel. `@Public()` because the SIGNATURE is the authentication: there is no second layer behind
 * it, so the service verifies it over the raw body first. See ChannelWebhooksService.
 */
@ApiTags('channel-webhooks')
@Public()
@Controller({ path: 'webhooks/channels/:channelUuid', version: '2' })
export class ChannelWebhooksController {
  constructor(private readonly webhooks: ChannelWebhooksService) {}

  @Get()
  @Header('content-type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary: 'Provider subscription challenge (hub.mode, hub.verify_token, hub.challenge)',
  })
  async challenge(
    @Param('channelUuid') channelUuid: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<string> {
    return this.webhooks.verifyChallenge(channelUuid, query, req.ip);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a signed delivery (messages and receipts)',
    description:
      'The signature header is checked over the raw body with this channel secret. 401 for any signature problem; 404 for a uuid that is not a channel. The delivery is queued, not processed, and answered at once.',
  })
  async receive(
    @Param('channelUuid') channelUuid: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    return this.webhooks.receive(channelUuid, req.rawBody, req.headers, req.ip);
  }
}
