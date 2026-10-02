import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { PlatformRbacService } from './platform-rbac.service';

export const PLATFORM_PERMISSION_KEY = 'rbac:platform-permission';

/**
 * Platform permission(s) required to reach a route; any one of them is enough. Use with `@UseGuards(OperatorGuard,
 * PlatformPermissionGuard)` on `/v2/platform/*` controllers. The operator's role tier (`@OperatorRoles`) is a separate,
 * coarser gate that stays in place for the danger actions.
 */
export const PlatformPermission = (...keys: string[]) => SetMetadata(PLATFORM_PERMISSION_KEY, keys);

/**
 * Runs after OperatorGuard (which proves the operator is active and sets the request context). A refusal is a plain 403
 * naming the permission and writes a `platform.permission_denied` security event, so a probing operator is visible.
 */
@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: PlatformRbacService,
    private readonly audit: AuthAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PLATFORM_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'platform_operator' || !ctx.actorId) throw AppError.unauthenticated();

    const held = await this.rbac.permissionsOf(ctx.actorId);
    if (required.some((key) => held.has(key))) return true;

    await this.audit.recordStandalone({
      event: 'platform.permission_denied',
      status: 'failure',
      actorType: 'platform_operator',
      actorId: ctx.actorId,
      payload: {
        route: context.switchToHttp().getRequest<{ path?: string }>().path,
        permission: required[0],
      },
    });
    throw new AppError(
      ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED,
      `Missing platform permission: ${required[0]}`,
      HttpStatus.FORBIDDEN,
      [{ path: 'permission', message: required[0]! }],
    );
  }
}
