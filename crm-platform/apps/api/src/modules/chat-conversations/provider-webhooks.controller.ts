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
import { ProviderWebhooksService } from './provider-webhooks.service';

/**
 * The provider-level WhatsApp webhook: one URL per provider for every number of the platform's Meta app or BSP account. `@Public()`
 * because the provider's signature is the authentication; see ProviderWebhooksService.
 */
@ApiTags('channel-webhooks')
@Public()
@Controller({ path: 'webhooks/whatsapp/:providerKey', version: '2' })
export class ProviderWebhooksController {
  constructor(private readonly webhooks: ProviderWebhooksService) {}

  @Get()
  @Header('content-type', 'text/plain; charset=utf-8')
  @Header('x-content-type-options', 'nosniff')
  @ApiOperation({ summary: 'Provider subscription challenge (hub.mode, hub.verify_token, hub.challenge)' })
  async challenge(
    @Param('providerKey') providerKey: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<string> {
    return this.webhooks.verifyChallenge(providerKey, query, req.ip);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a signed delivery for any number of this provider',
    description:
      'Verified with the provider\'s secret over the raw body (401 otherwise, 404 for an unknown provider). Each change is routed to the channel that owns its phone number; a number nobody here owns is skipped, counted and answered 200.',
  })
  async receive(@Param('providerKey') providerKey: string, @Req() req: Request & { rawBody?: Buffer }) {
    return this.webhooks.receive(providerKey, req.rawBody, req.headers, req.ip);
  }
}
