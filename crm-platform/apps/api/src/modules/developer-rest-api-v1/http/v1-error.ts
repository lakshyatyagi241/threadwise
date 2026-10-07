import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

/**
 * An error under one of Reference's own wire codes (`send_failed`, `template_not_found`, `no_recipients`...). They are Reference's contract with
 * existing clients and have no business in the platform-wide registry, so they are not in `ERROR_CODES`; `v1-error-renderer.ts` writes any
 * code it has no mapping for lower-cased, so the client reads exactly the spelling given here. The cast is the one place that is allowed.
 */
export function v1Error(
  code: string,
  message: string,
  status: number = HttpStatus.UNPROCESSABLE_ENTITY,
  details?: Array<{ path: string; message: string }>,
): AppError {
  return new AppError(code as ErrorCode, message, status, details);
}

/** A wire code as the `ErrorCode` an `AppError` and a code map are typed with (see `v1Error`). */
export const asErrorCode = (code: string): ErrorCode => code as ErrorCode;
