import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { RelayService } from './relay.service';

/**
 * The public delivery address of a push or webhook-relay connection. No session: the address names the connection and the sender proves
 * itself with the connection's secret (a header token or an HMAC of the raw body). Not part of the documented workspace API; the address
 * and the authentication a sender must use are on the installation's manage page.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'public/marketplace', version: '2' })
export class HookController {
  constructor(private readonly relay: RelayService) {}

  @Post('hooks/:publicKey')
  @HttpCode(HttpStatus.OK)
  receive(@Param('publicKey') publicKey: string, @Req() req: Request & { rawBody?: Buffer }) {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers))
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    return this.relay.receive(publicKey, req.ip, headers, req.rawBody);
  }
}
