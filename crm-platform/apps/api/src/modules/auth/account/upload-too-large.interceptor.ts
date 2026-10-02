import {
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { AVATAR_MAX_BYTES } from './account.service';

/**
 * Turns the transport's bare "413 File too large" into the same stable
 * `AUTH_UPLOAD_REJECTED` problem the upload policy raises for a file just over
 * the limit, with the reason and the limit in `errors`, so a client words the
 * message from data instead of guessing the cap. List it BEFORE the file
 * interceptor: the outer interceptor sees what the inner one throws.
 */
@Injectable()
export class UploadTooLargeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) =>
        throwError(() =>
          err instanceof PayloadTooLargeException
            ? new AppError(
                ERROR_CODES.AUTH_UPLOAD_REJECTED,
                `The file is too large (limit ${Math.round(AVATAR_MAX_BYTES / 1024)} KB).`,
                HttpStatus.PAYLOAD_TOO_LARGE,
                [
                  { path: 'file', message: 'too_large' },
                  { path: 'limitBytes', message: String(AVATAR_MAX_BYTES) },
                ],
              )
            : err,
        ),
      ),
    );
  }
}
