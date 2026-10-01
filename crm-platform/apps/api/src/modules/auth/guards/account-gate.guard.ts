import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@crm/contracts';
import { IS_PUBLIC_KEY } from '../../../common/decorators';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { AccountGateService } from '../security/account-gate.service';
import { ALLOW_WHILE_GATED_KEY, type AllowWhileGatedOptions } from './auth-gates';

/**
 * Runs after JwtAuthGuard. Staff users only (partner agents, operators and
 * bots have their own rules). Replaces Reference's `EnsureUserActive` and
 * `Force2FA` middleware with problem+json codes the web app maps to the lock
 * screens.
 *
 * Reference's Force2FA redirected to a page its own allowlist did not exempt, an
 * infinite loop; here the enrolment routes carry @AllowWhileGated() explicitly.
 */
@Injectable()
export class AccountGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly gates: AccountGateService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) return true;

    const state = await this.gates.stateFor(ctx.orgId, ctx.userId);
    const opts = this.reflector.getAllAndOverride<AllowWhileGatedOptions | undefined>(
      ALLOW_WHILE_GATED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (state.suspended && !opts?.suspended) {
      throw new AppError(
        ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
        'Your account is suspended.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (opts) return true;

    if (state.passwordChangeRequired) {
      throw new AppError(
        ERROR_CODES.AUTH_PASSWORD_CHANGE_REQUIRED,
        'You must set a new password before continuing.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (state.mfaEnrolmentRequired) {
      throw new AppError(
        ERROR_CODES.AUTH_MFA_ENROLMENT_REQUIRED,
        'Your organization requires two-factor authentication. Enrol to continue.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (state.emailBlocking) {
      throw new AppError(
        ERROR_CODES.AUTH_EMAIL_UNVERIFIED,
        'Verify your email address to continue.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
