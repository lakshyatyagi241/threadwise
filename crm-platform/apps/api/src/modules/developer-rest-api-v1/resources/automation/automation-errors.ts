import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../../common/errors/app-error';

export { v1Error } from '../../http/v1-error';

/** The domain's "not found" answers rendered as Reference's `not_found`; every other error passes through unchanged. */
export function asV1NotFound(err: unknown, message: string): unknown {
  if (
    err instanceof AppError &&
    (err.code === ERROR_CODES.TPL_NOT_FOUND || err.code === ERROR_CODES.FLR_FLOW_NOT_FOUND)
  )
    return new AppError(ERROR_CODES.NOT_FOUND, message, HttpStatus.NOT_FOUND);
  return err;
}

export async function withV1NotFound<T>(message: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw asV1NotFound(err, message);
  }
}
