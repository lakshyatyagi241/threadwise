import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@crm/contracts';
import { IS_PUBLIC_KEY } from '../../../common/decorators';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { AccountGateService } from '../security/account-gate.service';
import {
  OrgSuspensionService,
  isOperatorImpersonation,
  orgSuspendedError,
} from '../security/org-suspension.service';
import { ALLOW_WHILE_GATED_KEY, type AllowWhileGatedOptions } from './auth-gates';
import { suspendedPathAllowed } from './suspended-paths';

/** Identity pools whose requests belong to a workspace and stop when it is suspended. Operators and candidates are other pools. */
const ORG_GATED_ACTORS: ReadonlySet<string> = new Set(['user', 'partner_agent', 'api_key']);

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
    private readonly orgs: OrgSuspensionService,
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
    const opts = this.reflector.getAllAndOverride<AllowWhileGatedOptions | undefined>(
      ALLOW_WHILE_GATED_KEY,
      [context.getHandler(), context.getClass()],
    );

    // The person's own gates (below) and the workspace's suspension are independent reads. Start the first now so both Redis
    // reads go out together (ioredis sends them back to back on one connection: one round trip, not two). The workspace verdict
    // is still awaited and thrown first, exactly as before; if it throws, this read is simply abandoned (its rejection, if any,
    // is swallowed here so it cannot surface as an unhandled rejection).
    const readsUserGates =
      ctx.actorType === 'user' && Boolean(ctx.userId) && !isOperatorImpersonation(ctx);
    const statePromise = readsUserGates
      ? this.gates.stateFor(ctx.orgId, ctx.userId as number, { includeOrgSuspension: false })
      : undefined;
    statePromise?.catch(() => undefined);

    // A suspended workspace stops all of its members, not only staff users (ADR-0019). One cached lookup per organization.
    if (
      ORG_GATED_ACTORS.has(ctx.actorType) &&
      ctx.orgId > 0 &&
      !opts?.suspended &&
      !isOperatorImpersonation(ctx)
    ) {
      const req = context.switchToHttp().getRequest<Request>();
      if (
        !suspendedPathAllowed(req.originalUrl ?? req.url ?? '', req.method ?? 'GET') &&
        (await this.orgs.isSuspended(ctx.orgId))
      ) {
        throw orgSuspendedError();
      }
    }

    // Not a staff user, or an operator acting as the owner: the owner's own account gates (password change due, 2FA enrolment,
    // unverified email, a suspended account) are the owner's to resolve, and an operator must reach the workspace to help and
    // cannot resolve them (the routes are forbidden). `readsUserGates` is false for both.
    if (!statePromise) return true;

    // This guard only reads the person's own gates; the workspace was checked above, so it is not looked up a second time.
    const state = await statePromise;

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
