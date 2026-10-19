import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import type { Env } from '../../config/env.schema';
import { RequestContextStore } from '../context/request-context';

/**
 * Logs any HTTP request that took at least SLOW_REQUEST_MS (default 500 ms) as one structured warn line:
 * route pattern (not the URL, so ids and tokens never reach the log), method, organisation, status, duration and request id.
 * It is how a slow endpoint is noticed in the running app between benchmark runs (QA 51); the benchmark ranks them, this catches
 * the ones the benchmark does not call. Set SLOW_REQUEST_MS=0 to turn it off.
 *
 * Duration is the handler time seen by interceptors (guards run before it), which is what the code under our control costs.
 */
@Injectable()
export class SlowRequestInterceptor implements NestInterceptor {
  private readonly logger = new Logger('SlowRequest');
  private readonly thresholdMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.thresholdMs = config.get('SLOW_REQUEST_MS', { infer: true }) ?? 500;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.thresholdMs <= 0 || context.getType() !== 'http') return next.handle();
    const started = process.hrtime.bigint();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const report = (status: number) => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (durationMs < this.thresholdMs) return;
      const ctx = RequestContextStore.peek();
      this.logger.warn({
        msg: 'slow request',
        method: request.method,
        route: (request.route as { path?: string } | undefined)?.path ?? 'unmatched',
        orgId: ctx?.orgId ?? 0,
        status,
        durationMs: Math.round(durationMs),
        requestId: ctx?.requestId,
      });
    };
    return next.handle().pipe(
      tap({
        next: () => report(http.getResponse<Response>().statusCode),
        error: (err: unknown) => report(err instanceof HttpException ? err.getStatus() : 500),
      }),
    );
  }
}
