import { Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { ComplianceService } from './compliance.service';
import { WebhookService } from './webhook.service';

type Raw = Request & { rawBody?: Buffer };

/** The public doors of the stores' webhooks. No session: each delivery proves itself with its signature. */
@ApiExcludeController()
@Public()
@Controller({ version: '2' })
export class EcomWebhookController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly compliance: ComplianceService,
  ) {}

  @Post('shopify/webhook/:secret')
  @HttpCode(HttpStatus.OK)
  async shopify(
    @Param('secret') secret: string,
    @Headers('x-shopify-hmac-sha256') signature: string | undefined,
    @Headers('x-shopify-topic') topic: string | undefined,
    @Headers('x-shopify-webhook-id') deliveryId: string | undefined,
    @Req() req: Raw,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.webhooks.receive('shopify', secret, req.rawBody ?? Buffer.alloc(0), {
      signature: signature ?? '',
      topic: topic ?? '',
      deliveryId: deliveryId ?? '',
    });
    res.status(out.status).type('text/plain').send(out.body);
  }

  /** Shopify's mandatory privacy webhooks (no store secret; the app-level signature is the proof). */
  @Post('shopify/compliance')
  @HttpCode(HttpStatus.OK)
  async shopifyCompliance(
    @Headers('x-shopify-hmac-sha256') signature: string | undefined,
    @Headers('x-shopify-topic') topic: string | undefined,
    @Headers('x-shopify-shop-domain') shop: string | undefined,
    @Req() req: Raw,
    @Res() res: Response,
  ): Promise<void> {
    const status = await this.compliance.receive(
      req.rawBody ?? Buffer.alloc(0),
      signature ?? '',
      topic ?? '',
      shop ?? '',
    );
    res
      .status(status)
      .type('text/plain')
      .send(status === 401 ? 'bad hmac' : 'ok');
  }

  @Post('woocommerce/webhook/:secret')
  @HttpCode(HttpStatus.OK)
  async woocommerce(
    @Param('secret') secret: string,
    @Headers('x-wc-webhook-signature') signature: string | undefined,
    @Headers('x-wc-webhook-topic') topic: string | undefined,
    @Headers('x-wc-webhook-delivery-id') deliveryId: string | undefined,
    @Req() req: Raw,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.webhooks.receive('woocommerce', secret, req.rawBody ?? Buffer.alloc(0), {
      signature: signature ?? '',
      topic: topic ?? '',
      deliveryId: deliveryId ?? '',
    });
    res.status(out.status).type('text/plain').send(out.body);
  }
}
