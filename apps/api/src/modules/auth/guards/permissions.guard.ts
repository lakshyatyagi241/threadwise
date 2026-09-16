import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION_KEY } from '../../../common/decorators';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { RbacService } from '../../../kernel/rbac/rbac.service';

/**
 * Global capability guard.
 *
 * Runs after JwtAuthGuard. A route without @RequirePermission passes through —
 * authentication alone is enough for things like "read my own profile".
 *
 * Besides allow/deny it stashes the resolved grant set on the request context,
 * so the service layer can read the record scope (all/team/own) without a
 * second lookup.
 *
 * Only staff users carry RBAC grants. Partner agents and candidates are scoped
 * structurally instead — a partner only ever queries through
 * partner_agent_leads filtered by their own agent id, so there is no grant to
 * check and no way to widen it.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) {
      throw AppError.forbidden(required);
    }

    const grants = await this.rbac.grantsForUser(ctx.orgId, ctx.userId);
    ctx.grants = grants;

    const { allowed } = this.rbac.can(grants, required);
    if (!allowed) throw AppError.forbidden(required);

    return true;
  }
}
