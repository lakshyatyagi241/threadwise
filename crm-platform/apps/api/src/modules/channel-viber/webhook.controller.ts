import { Controller, Headers, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { InboundService } from './inbound.service';

/**
 * `POST /v2/viber/inbound/<token>`: where Viber pushes. Public (Viber has no session); the `X-Viber-Content-Signature` header, checked on
 * the raw body with the account's auth token, proves the caller. Always 200 once it holds, because Viber retries anything else.
 */
@ApiExcludeController()
@Controller({ path: 'viber/inbound', version: '2' })
export class WebhookController {
  constructor(private readonly inbound: InboundService) {}

  @Public()
  @Post(':token')
  async ingest(
    @Param('token') token: string,
    @Headers('x-viber-content-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.inbound.ingest(token, req.rawBody ?? Buffer.alloc(0), signature ?? '');
    if (out === 'forbidden') {
      res.status(HttpStatus.FORBIDDEN).json({ status: 1, status_message: 'bad signature' });
      return;
    }
    res.status(HttpStatus.OK).json(out);
  }
}
