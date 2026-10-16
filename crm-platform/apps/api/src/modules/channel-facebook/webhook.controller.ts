import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import type { Env } from '../../config/env.schema';
import { InboundService } from './inbound.service';
import { PagesService } from './pages.service';

/**
 * The public doors of the Facebook channel. No session: Meta (webhook) and the browser coming back from the login dialog
 * (callback) call them, and each proves itself (a signature, a sealed state).
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'facebook', version: '2' })
export class FacebookPublicController {
  constructor(
    private readonly inbound: InboundService,
    private readonly pages: PagesService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Meta's subscription handshake: the challenge is echoed as text only for the right token. */
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    if (this.inbound.verify(mode ?? '', token ?? '')) {
      res
        .status(HttpStatus.OK)
        .type('text/plain')
        .send(challenge ?? '');
      return;
    }
    res.status(HttpStatus.FORBIDDEN).type('text/plain').send('forbidden');
  }

  /** Signed events for feed, comments and Messenger. Always 200 once the signature holds: Meta retries anything else. */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.inbound.receive(
      req.rawBody ?? Buffer.alloc(0),
      signature ?? '',
      req.body,
    );
    res
      .status(result === 'forbidden' ? HttpStatus.FORBIDDEN : HttpStatus.OK)
      .type('text/plain')
      .send(result === 'forbidden' ? 'invalid signature' : 'ok');
  }

  /** The browser comes back from Facebook's login dialog and is sent on to the hub with the outcome. */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.pages.completeLogin({ code, state, error, errorDescription });
    // The Meta lead ads screen starts its own login (more permissions) and is where the person goes back to.
    const hub = new URL(
      out.returnTo === 'lead-sources' ? '/lead-sources' : '/facebook',
      this.config.get('WEB_APP_URL', { infer: true }),
    );
    if (out.returnTo === 'lead-sources') hub.searchParams.set('tab', 'ads');
    hub.searchParams.set('fb', out.ok ? 'connected' : 'error');
    hub.searchParams.set('message', out.message);
    res.redirect(303, hub.toString());
  }
}
