import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../../../common/errors/app-error';
import { v1Error } from '../../http/v1-error';
import type { V1SendFailure } from '@crm/contracts';

export { v1Error };

/**
 * Reference's `send_failed`: the request was understood but the message cannot go out. Its `message` is the machine code
 * (`empty_message`, `wrong_channel`...), not a sentence, and clients branch on it, so it stays that way.
 */
export function sendFailed(
  reason: V1SendFailure | string,
  status: number = HttpStatus.UNPROCESSABLE_ENTITY,
): AppError {
  return v1Error('send_failed', reason, status);
}

export const notFound = (what: 'Message' | 'Conversation' | 'Device' | 'Media'): AppError =>
  v1Error('not_found', `${what} not found.`, HttpStatus.NOT_FOUND);

export function validationFailed(field: string, message: string): AppError {
  return AppError.validation('Validation failed.', [{ path: field, message }]);
}
