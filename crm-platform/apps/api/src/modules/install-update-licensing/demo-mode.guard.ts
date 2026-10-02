import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { INST_ENV, type InstEnv } from '../../config/domains/install-update-licensing.env';
import { DEMO_SAFE_KEY, isWriteAllowedInDemo } from './demo-policy';

/** Marks a write route as fine to call on the public demo (e.g. creating a throwaway contact). */
export const DemoSafe = () => SetMetadata(DEMO_SAFE_KEY, true);

/**
 * Global guard for the live demo (TW-INST-029). A no-op unless DEMO_MODE is on. It runs for every controller in the
 * app, so the public and partner APIs are covered by the same rule as the staff API.
 */
@Injectable()
export class DemoModeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(INST_ENV) private readonly env: InstEnv,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.env.DEMO_MODE || context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { route?: { path?: string } }>();
    const allowed = isWriteAllowedInDemo({
      method: req.method,
      routePath: req.route?.path ?? req.path,
      demoSafe:
        this.reflector.getAllAndOverride<boolean>(DEMO_SAFE_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) === true,
    });
    if (allowed) return true;
    throw new AppError(
      ERROR_CODES.DEMO_MODE_BLOCKED,
      'This is a demo: changes are disabled.',
      HttpStatus.FORBIDDEN,
    );
  }
}
