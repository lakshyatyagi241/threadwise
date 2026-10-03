import {
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';
import { AppError } from '../../common/errors/app-error';
import { FLOW_MEDIA_MAX_BYTES } from './flow-media.service';

/** Reference's validation copy for a builder upload over the limit: `file` max 51200 KB. */
export const FLOW_MEDIA_TOO_LARGE = `The file may not be greater than ${FLOW_MEDIA_MAX_BYTES / 1024} kilobytes.`;

/**
 * Turns the transport's bare "413 File too large" into the validation error Reference gives (`file` may not be greater than
 * 51200 KB, 422) so the builder's "Upload failed: <message>" toast says what is wrong. List it BEFORE the file interceptor:
 * the outer interceptor sees what the inner one throws.
 */
@Injectable()
export class FlowMediaTooLargeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((err: unknown) =>
          throwError(() =>
            err instanceof PayloadTooLargeException
              ? AppError.validation(FLOW_MEDIA_TOO_LARGE, [{ path: 'file', message: FLOW_MEDIA_TOO_LARGE }])
              : err,
          ),
        ),
      );
  }
}
