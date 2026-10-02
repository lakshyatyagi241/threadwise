import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { NodeBridgeSettingsService } from './node-bridge-settings.service';

const digest = (v: string) => createHash('sha256').update(v).digest();

/**
 * TW-NODE-002: every route the bridge calls is guarded by the shared `X-Node-Token`. A constant-time compare (both sides
 * hashed first so the lengths match), and no configured secret means nobody gets in: it fails closed, never open.
 */
@Injectable()
export class NodeTokenGuard implements CanActivate {
  constructor(private readonly settings: NodeBridgeSettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const expected = await this.settings.token();
    const header = context.switchToHttp().getRequest<Request>().headers['x-node-token'];
    const given = Array.isArray(header) ? header[0] : header;
    if (!expected || !given || !timingSafeEqual(digest(expected), digest(given))) {
      throw AppError.forbidden('node bridge token');
    }
    return true;
  }
}
