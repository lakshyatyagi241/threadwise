import { Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { InboundService } from './inbound.service';

/**
 * `POST /v2/line/inbound/<token>`: where LINE pushes. Public (LINE has no session); the `X-Line-Signature` header, checked on the raw
 * body against the channel secret, is the authentication. A wrong signature is 401 (Reference); everything else answers 200.
 */
@ApiExcludeController()
@Controller({ path: 'line/inbound', version: '2' })
export class WebhookController {
  constructor(private readonly inbound: InboundService) {}

  @Public()
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async ingest(
    @Param('token') token: string,
    @Headers('x-line-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.inbound.ingest(token, req.rawBody ?? Buffer.alloc(0), signature ?? '');
    if (out.kind === 'bad_signature') {
      res.status(HttpStatus.UNAUTHORIZED);
      return { ok: false, error: 'bad signature' };
    }
    return { ok: true, note: out.note };
  }
}
