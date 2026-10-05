import { Controller, Header, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { LeadHooksService } from './lead-hooks.service';

/**
 * The public door of the lead pipeline's webhook sources. No session: the token in the path is the credential, and a source may add a
 * shared secret header. See `LeadHooksService` for what it does and refuses.
 */
@ApiTags('lead-hooks-public')
@Public()
@Controller({ path: 'public/lead-hooks', version: '2' })
export class LeadHooksController {
  constructor(private readonly hooks: LeadHooksService) {}

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Send a lead to a lead source',
    description:
      'JSON object or form body. The token in the path is the only credential; if the source has a shared secret, send it in `X-Webhook-Secret`. ' +
      'Answers `{ ok: true, received: true }` whatever happened to the lead: it never says whether a contact existed. ' +
      'The same lead twice (same id, or the same body when the source has no id path) is acknowledged and not repeated. ' +
      '404 for an unknown, paused or malformed token, 401 for a wrong secret, 413 over the body cap, 415 for another content type, 429 over the rate limit.',
  })
  receive(@Param('token') token: string, @Req() req: Request) {
    return this.hooks.receive(token, req);
  }
}
