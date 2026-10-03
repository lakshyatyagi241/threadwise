import { Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { WabaWebhookService } from '../whatsapp-cloud-api-waba';

/**
 * The calling callback URL (TW-CALL-001, 002): `/v2/public/webhooks/wa-calling`. Meta allows one callback per app, and the WhatsApp
 * callback of the WABA domain already carries the `calls` field, so this is the same door under the name Reference's admins registered:
 * the same verify token, the same signature check, the same queue. Reference ran two handlers and forwarded one into the other so that
 * permission updates were not dropped; there is one here, so they cannot be.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'public/webhooks/wa-calling', version: '2' })
export class CallingWebhookController {
  constructor(private readonly webhook: WabaWebhookService) {}

  @Get()
  handshake(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
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
      queryKey: typeof k === 'string' ? k : undefined,
    });
    return { ok: true };
  }
}
