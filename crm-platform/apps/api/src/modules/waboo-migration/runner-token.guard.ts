import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { runnerTokenMatches } from './runner-auth';

/**
 * Proves the caller holds the runner agent's token before anything else about the request is looked at. A guard, not a call in the
 * handler: Nest validates the body and the path parameters BEFORE the handler runs, so an unauthenticated caller would otherwise get a
 * 400 that describes the schema instead of the same 401 every wrong or missing token gets.
 */
@Injectable()
export class RunnerTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (!runnerTokenMatches(process.env.WABOO_RUNNER_TOKEN, req.header('authorization')))
      throw AppError.unauthenticated('Invalid or missing runner token');
    return true;
  }
}
