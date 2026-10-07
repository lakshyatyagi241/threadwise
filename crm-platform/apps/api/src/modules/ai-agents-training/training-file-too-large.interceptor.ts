import {
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';
import { tooLarge } from './sources.service';

/**
 * Turns the transport's bare "413 File too large" into the `AIAG_FILE_TOO_LARGE` problem the screen shows. List it BEFORE the file
 * interceptor: the outer interceptor sees what the inner one throws.
 */
@Injectable()
export class TrainingFileTooLargeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((err: unknown) =>
          throwError(() => (err instanceof PayloadTooLargeException ? tooLarge() : err)),
        ),
      );
  }
}
