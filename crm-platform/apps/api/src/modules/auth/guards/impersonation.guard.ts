import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { impersonationVerdict } from './impersonation-rules';

/**
 * Global, right after JwtAuthGuard. A request that carries an act-as token is held to the rules in `impersonation-rules.ts`:
 * a read-only session cannot write, and no session can touch the owner's credentials or the operator console. Requests
 * without an act-as token are untouched (one property read).
 */
@Injectable()
export class ImpersonationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const imp = RequestContextStore.peek()?.impersonation;
    if (!imp) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const verdict = impersonationVerdict(
      req.originalUrl ?? req.url ?? '',
      req.method,
      imp.readOnly,
    );
    if (verdict === 'forbidden') {
      throw new AppError(
        ERROR_CODES.WSP_IMPERSONATION_FORBIDDEN,
        'This is not available while you are viewing the workspace as its owner.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (verdict === 'read_only') {
      throw new AppError(
        ERROR_CODES.WSP_IMPERSONATION_READ_ONLY,
        'This session is read-only. Stop it and start a normal one to make changes.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
