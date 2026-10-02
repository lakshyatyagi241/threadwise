import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { InboundService } from './inbound.service';
import type { Update } from './update-rules';

/**
 * `POST /v2/telegram/inbound/<token>`: where Telegram pushes. Public (Telegram has no session) and always 200, because
 * Telegram retries anything else. The secret header set on `setWebhook` proves the caller.
 */
@ApiExcludeController()
@Controller({ path: 'telegram/inbound', version: '2' })
export class WebhookController {
  constructor(private readonly inbound: InboundService) {}

  @Public()
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  ingest(
    @Param('token') token: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: Update,
  ) {
    return this.inbound.ingest(token, secret ?? '', update ?? {});
  }
}
