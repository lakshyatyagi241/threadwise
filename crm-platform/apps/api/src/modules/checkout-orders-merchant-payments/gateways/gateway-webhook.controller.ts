import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators';
import { GatewayWebhookService } from './gateway-webhook.service';

const lower = (h: Request['headers']): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(h).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]),
  );

/**
 * `POST /v2/store-public/webhooks/gateway/:gatewayId`: the provider's notification for a shared workspace gateway. No session; the
 * gateway's own signature over the raw body (main.ts keeps the bytes: `rawBody: true`) is the authentication.
 */
@ApiTags('store-public')
@Controller({ path: 'store-public/webhooks/gateway', version: '2' })
export class GatewayWebhookController {
  constructor(private readonly webhook: GatewayWebhookService) {}

  @Public()
  @Post(':gatewayId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Provider payment notification for a workspace gateway',
    description:
      '404 `gateway_unknown`, 403 `webhook_secret_not_configured`, 400 `bad_signature`. A reference no domain owns, or an event that is not a payment, is answered 200 `ignored`.',
  })
  async handle(@Param('gatewayId') gatewayId: string, @Req() req: Request & { rawBody?: Buffer }) {
    return this.webhook.handle(gatewayId, req.rawBody, lower(req.headers));
  }
}
