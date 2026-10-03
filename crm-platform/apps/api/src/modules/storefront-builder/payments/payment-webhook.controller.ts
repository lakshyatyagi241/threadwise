import { Controller, Headers, HttpCode, HttpStatus, Ip, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators';
import { PublicRateLimiter } from '../public/public-rate-limiter';
import { PaymentWebhookService } from './payment-webhook.service';

/**
 * `POST /v2/store-public/webhooks/razorpay`: Razorpay tells a shop a payment link was paid. No session; the HMAC signature of
 * the raw body with the shop's own webhook secret is the authentication. The body is parsed from the raw bytes (re-serialised
 * JSON would change what was signed), which is why `rawBody: true` is on in main.ts.
 */
@ApiTags('storefront-public')
@Controller({ path: 'store-public/webhooks', version: '2' })
export class PaymentWebhookController {
  constructor(
    private readonly webhook: PaymentWebhookService,
    private readonly limiter: PublicRateLimiter,
  ) {}

  @Public()
  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Razorpay payment-link webhook',
    description:
      'Header `X-Razorpay-Signature`. 400 `bad_signature` / `invalid_json`, 404 `storefront_unknown`. An order of another shop, a different amount or currency, or a cancelled order is answered 200 with `order: null` and `rejected`.',
  })
  async razorpay(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Ip() ip: string,
  ) {
    await this.limiter.hit('webhook', ip);
    return this.webhook.razorpay(req.rawBody, signature);
  }
}
