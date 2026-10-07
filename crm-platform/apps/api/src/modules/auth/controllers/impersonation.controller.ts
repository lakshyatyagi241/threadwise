import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ERROR_CODES,
  redeemImpersonationRequestSchema,
  type ImpersonationStatus,
  type RedeemImpersonationRequest,
  type RedeemImpersonationResponse,
  type StopImpersonationResponse,
} from '@crm/contracts';
import { ActorKinds, Public } from '../../../common/decorators';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { AllowWhileGated } from '../guards/auth-gates';
import { ImpersonationService } from '../platform/impersonation.service';
import { RateLimitService } from '../security/rate-limit.service';
import { normalizeIp } from '../support/ip';

/** Redeem attempts per address per minute. A real handoff takes one; the code itself is 256 bits, this only caps noise. */
const REDEEM_PER_MINUTE = 20;

/**
 * The workspace side of operator impersonation (TW-WSP-032/033): exchange the one-time code for the act-as token, show the
 * banner, stop. Starting a session is the operator's call and lives under `/v2/platform/workspaces/:id/impersonate`.
 */
@ApiTags('auth')
@Controller({ path: 'auth/impersonation', version: '2' })
export class ImpersonationController {
  constructor(
    private readonly impersonation: ImpersonationService,
    private readonly limits: RateLimitService,
  ) {}

  @Public()
  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange the one-time handoff code for the act-as access token',
    description:
      'Called by the web app server, never by page JavaScript. The token has no refresh token and ends with the session.',
  })
  async redeem(
    @Body(zodPipe(redeemImpersonationRequestSchema)) body: RedeemImpersonationRequest,
  ): Promise<RedeemImpersonationResponse> {
    const ip = normalizeIp(RequestContextStore.peek()?.ip) ?? 'unknown';
    if (!(await this.limits.allow(`imp-redeem:${ip}`, REDEEM_PER_MINUTE, 60))) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many attempts. Try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.impersonation.redeem(body.code);
  }

  @Get()
  @ActorKinds('user')
  @AllowWhileGated({ suspended: true })
  @ApiOperation({ summary: 'Is this session an operator acting as the owner? (banner data)' })
  status(): Promise<ImpersonationStatus> {
    return this.impersonation.status();
  }

  @Post('stop')
  @ActorKinds('user')
  @HttpCode(HttpStatus.OK)
  @AllowWhileGated({ suspended: true })
  @ApiOperation({ summary: 'End the act-as session; answers where the operator goes next' })
  stop(): Promise<StopImpersonationResponse> {
    return this.impersonation.stop();
  }
}
