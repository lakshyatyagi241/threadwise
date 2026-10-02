import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { OperatorAuthService } from '../platform/operator-auth.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { ALLOW_WHILE_GATED_KEY, OPERATOR_ROLES_KEY } from './auth-gates';

/**
 * Guard for every `/v2/platform/*` controller (used with @UseGuards).
 *
 * Runs after the global JwtAuthGuard has proved the token is an operator's.
 * It then loads the operator (so suspension and role changes apply on the next
 * request, not at token expiry), applies the IP allowlist (TW-AUTH-038),
 * requires MFA enrolment where it applies (super admins always, every operator
 * when the security policy asks for it; except on the enrolment routes, marked
 * @AllowWhileGated), and checks the route's role list. A role refusal
 * on a danger action is itself an audited event, as in Reference.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly operators: OperatorAuthService,
    private readonly audit: AuthAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'platform_operator' || !ctx.actorId) throw AppError.unauthenticated();

    await this.operators.assertIpAllowed(
      ctx.ip,
      context.switchToHttp().getRequest<{ path?: string }>().path ?? '',
    );

    const operator = await this.operators.findById(ctx.actorId);
    if (!operator || operator.status !== 'active') throw AppError.unauthenticated();
    ctx.operatorRole = operator.role;

    const gated = this.reflector.getAllAndOverride<unknown>(ALLOW_WHILE_GATED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!gated && (await this.operators.mfaEnrolmentRequired(operator))) {
      throw new AppError(
        ERROR_CODES.AUTH_MFA_ENROLMENT_REQUIRED,
        'Two-factor authentication is required for your account. Enrol to continue.',
        HttpStatus.FORBIDDEN,
      );
    }

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(OPERATOR_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length && !roles.includes(operator.role)) {
      await this.audit.recordStandalone({
        event: 'platform.security.danger_action_denied',
        status: 'failure',
        actorType: 'platform_operator',
        actorId: operator.id,
        payload: {
          route: context.switchToHttp().getRequest<{ path?: string }>().path,
          role: operator.role,
        },
      });
      throw new AppError(
        ERROR_CODES.AUTH_OPERATOR_ROLE_REQUIRED,
        'This action requires the super admin role.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
