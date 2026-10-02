import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { TokenService } from '../auth';
import { SettingsService } from './settings.service';

/**
 * Paths that stay open while the app is in maintenance (WD-SET-008 rule 3): operator console and sign-in
 * (staff keep working), the guest auth endpoints (sign-in must be reachable), the public settings
 * projection, health probes, and the machine callers that would lose events if refused (public API keys,
 * provider webhooks), which authenticate themselves by signature.
 */
const OPEN = [
  /^\/(health|ready)(\/|$)/,
  /^\/v\d+\/platform(\/|$)/,
  /^\/v\d+\/auth(\/|$)/,
  /^\/v\d+\/public(\/|$)/,
  /^\/v\d+\/webhooks(\/|$)/,
  /^\/public\/v\d+(\/|$)/,
];

export const isOpenDuringMaintenance = (path: string) => OPEN.some((r) => r.test(path));

/**
 * Refuses every other request with 503 + Retry-After while `general.maintenanceMode` is on, unless the
 * caller carries a valid platform operator token. It reads the bearer itself rather than relying on the
 * auth guard having run first, so it does not depend on guard order.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly settings: SettingsService,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (isOpenDuringMaintenance(req.path)) return true;
    if (!(await this.settings.values('general')).maintenanceMode) return true;

    const header = req.header('authorization');
    if (header?.startsWith('Bearer ')) {
      try {
        const claims = await this.tokens.verifyAccess(header.slice(7).trim());
        if (claims.typ === 'platform_operator') return true;
      } catch {
        // fall through to the 503: an invalid token gets no special treatment
      }
    }
    context.switchToHttp().getResponse<Response>().setHeader('Retry-After', '3600');
    throw new AppError(
      ERROR_CODES.SET_MAINTENANCE,
      'The service is temporarily down for maintenance. Please try again shortly.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
