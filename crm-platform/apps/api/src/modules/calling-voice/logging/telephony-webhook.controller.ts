import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators';
import { Throttle } from '../../platform-infrastructure';
import { TelephonyWebhookService } from './telephony-webhook.service';

/**
 * Where a telephony provider reports a finished call, one address per connection. Public (a provider has no session, and no plan gate:
 * a late report must still land); the signature is the authentication. The answer is always an empty 204 once the callback is proven,
 * because a provider retries on anything else. Throttled per address.
 */
@ApiExcludeController()
@Controller({ path: 'public/webhooks/telephony', version: '2' })
export class TelephonyWebhookController {
  constructor(private readonly webhook: TelephonyWebhookService) {}

  @Public()
  @Post(':connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ limit: 240, windowSeconds: 60, by: 'ip' })
  async receive(
    @Param('connectionId') connectionId: string,
    @Req() req: Request & { rawBody?: Buffer },
  ): Promise<void> {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }
    await this.webhook.receive(connectionId, req.rawBody, headers);
  }
}
