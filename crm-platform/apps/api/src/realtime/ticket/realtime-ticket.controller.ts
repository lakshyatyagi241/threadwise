import { Controller, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ERROR_CODES, type RealtimeTicketResponse } from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { RateLimitService, TokenService } from '../../modules/auth';
import { RealtimeTicketService } from './realtime-ticket.service';

/** A tab asks once per connect, so a healthy client stays far below this; a loop of reconnects does not. */
const MINTS_PER_MINUTE = 30;

@ApiTags('realtime')
@ActorKinds('user')
@Controller({ path: 'realtime', version: '2' })
export class RealtimeTicketController {
  constructor(
    private readonly tickets: RealtimeTicketService,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  // A ticket must never be cached or replayed: it works once.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'A one-time ticket for the socket handshake',
    description:
      "Called by the web app's same-origin proxy with the session token. The ticket works once, for 60 seconds; a reconnect asks for a new one. Not an @Idempotent route on purpose: replaying a stored response would hand out a ticket that is already used.",
  })
  async mint(@Req() req: Request): Promise<RealtimeTicketResponse> {
    // The guard has already verified this token; reading it again gives the claims the ticket stands for (session id, epoch).
    const { rv: _rv, ...claims } = await this.tokens.verifyAccess(
      req.header('authorization')!.slice('Bearer '.length).trim(),
    );

    const hit = await this.rateLimit.hit(`rt:mint:${claims.org}:${claims.sub}`, 60);
    if (hit.count > MINTS_PER_MINUTE) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many realtime connections. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.tickets.mint(claims);
  }
}
