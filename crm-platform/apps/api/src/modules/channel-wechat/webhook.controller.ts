import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { InboundService, type Reply, type WechatQuery } from './inbound.service';

/** Only strings are read from the query: a repeated or nested parameter is treated as absent. */
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function queryOf(q: Record<string, unknown>): WechatQuery {
  return {
    signature: text(q.signature),
    msg_signature: text(q.msg_signature),
    timestamp: text(q.timestamp),
    nonce: text(q.nonce),
    echostr: text(q.echostr),
  };
}

function send(res: Response, r: Reply): void {
  res.status(r.status).type('text/plain').set('x-content-type-options', 'nosniff').send(r.body);
}

/**
 * `/v2/wechat/inbound/<token>`: where WeChat calls. Public (WeChat has no session); every request proves itself with the signature
 * built from the channel's Token. GET is the URL check the console runs when the address is saved, POST carries the XML messages.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'wechat/inbound', version: '2' })
export class WebhookController {
  constructor(private readonly inbound: InboundService) {}

  @Get(':token')
  async verify(
    @Param('token') token: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    send(res, await this.inbound.verify(token, queryOf(query)));
  }

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('token') token: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
  ): Promise<void> {
    const raw = req.rawBody?.toString('utf8') ?? (typeof req.body === 'string' ? req.body : '');
    send(res, await this.inbound.receive(token, queryOf(query), raw));
  }
}
