import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  shopifyEmbeddedSessionInputSchema,
  type ShopifyEmbeddedConfig,
  type ShopifyEmbeddedSessionInput,
  type ShopifyEmbeddedStatus,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Throttle } from '../platform-infrastructure';
import { EmbeddedShopifyService } from './embedded.service';

/** The Shopify embedded app's two doors (TW-ECOM-038). No session: the signed App Bridge token is the proof, and nothing is signed in. */
@ApiTags('shopify')
@Public()
@Controller({ path: 'shopify/embedded', version: '2' })
export class EmbeddedShopifyController {
  constructor(private readonly embedded: EmbeddedShopifyService) {}

  @Get('config')
  @Throttle('public-form')
  @ApiOperation({ summary: 'The app’s public client id, so the embedded page can load App Bridge' })
  config(): Promise<ShopifyEmbeddedConfig> {
    return this.embedded.config();
  }

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @Throttle({ limit: 60, windowSeconds: 60, by: 'ip' })
  @ApiOperation({
    summary:
      'Which connected store an App Bridge session token belongs to, and its connection status',
    description:
      'Read-only; nothing is signed in. 401 ECOM_SESSION_TOKEN_INVALID for a bad signature, an expired token, another app or another shop; 422 ECOM_NOT_CONFIGURED when the platform app is off. An unknown shop answers 200 with `connected = false`.',
  })
  session(
    @Body(zodPipe(shopifyEmbeddedSessionInputSchema)) body: ShopifyEmbeddedSessionInput,
  ): Promise<ShopifyEmbeddedStatus> {
    return this.embedded.session(body);
  }
}
