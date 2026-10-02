import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators';
import { InvoiceGatewayWebhookService } from './invoice-gateway-webhook.service';

/**
 * Inbound payment events for invoices. `@Public()` because the SIGNATURE is the authentication: there is no second layer behind
 * it, so the service verifies it over the raw body before reading anything else. See InvoiceGatewayWebhookService.
 */
@ApiTags('public-invoices')
@Public()
@Controller({ path: 'public/webhooks/invoice-payments', version: '2' })
export class InvoiceGatewayWebhookController {
  constructor(private readonly webhook: InvoiceGatewayWebhookService) {}

  @Post(':endpointId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a signed payment event (generic HMAC webhook)',
    description:
      'Header X-Invoice-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>"> with the connection secret; events older than 5 minutes are refused. 401 for any signature problem (unknown endpoint, disabled, no secret, wrong or stale signature are indistinguishable). Idempotent on the event id. Amount and currency must match the payment attempt.',
  })
  async receive(
    @Param('endpointId') endpointId: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    return this.webhook.handle(endpointId, req.rawBody, req.headers, req.ip);
  }
}
