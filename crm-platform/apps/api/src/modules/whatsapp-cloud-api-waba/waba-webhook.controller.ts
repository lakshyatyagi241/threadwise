import { Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { WabaWebhookService } from './waba-webhook.service';

/**
 * The one WhatsApp callback URL for every workspace (TW-WABA-029..031). Registered with Meta and Interakt; the payload names the
 * number, and the worker resolves the workspace from it. Public: the signature or the URL secret is the authentication.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'public/webhooks/whatsapp', version: '2' })
export class WabaWebhookController {
  constructor(private readonly webhook: WabaWebhookService) {}

  @Get()
  handshake(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    // Meta wants the challenge back as plain text, nothing else.
    res
      .status(HttpStatus.OK)
      .type('text/plain')
      .send(this.webhook.handshake(mode, token, challenge));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Query('k') k: string | undefined) {
    await this.webhook.receive({
      rawBody: req.rawBody,
      signatureHeader: req.header('x-hub-signature-256') ?? undefined,
      contentType: req.header('content-type') ?? undefined,
      queryKey: typeof k === 'string' ? k : undefined,
    });
    return { received: true };
  }
}
