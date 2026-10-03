import { Controller, Get, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import type { Env } from '../../config/env.schema';
import { ShopifyService } from './shopify.service';

/**
 * The public doors of the Shopify and WooCommerce integrations. No session: the browser comes back from Shopify with a signed
 * code (the OAuth callback), and each door proves itself (a signature, a sealed state).
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'shopify', version: '2' })
export class EcomPublicController {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The browser comes back from Shopify's approval page and is sent on to the Shopify screen with the outcome. */
  @Get('oauth/callback')
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    // The signature covers every parameter as sent: a repeated or nested one (an array, an object) cannot be verified, so it is
    // left out of the check as an empty value and the signature fails.
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) query[k] = typeof v === 'string' ? v : '';
    const out = await this.shopify.complete(query);
    const screen = new URL('/shopify', this.config.get('WEB_APP_URL', { infer: true }));
    screen.searchParams.set('shopify', out.ok ? 'connected' : 'error');
    screen.searchParams.set('message', out.message);
    res.redirect(303, screen.toString());
  }
}
