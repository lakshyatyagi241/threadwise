import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from './app-error';

/** The text of a refused purge. Neutral on purpose: it never says why, for what matter, or that a person is under investigation. */
export const LEGAL_HOLD_BLOCKED_MESSAGE =
  'This record is protected and cannot be deleted at the moment.';

/**
 * The 409 every refused purge answers with. `held` is how many of the records asked for are held: it goes to the audit row of the
 * refusal, never to the caller (a person who is not entitled to know about a hold must not learn how many of a selection are held).
 * `restricted` says the refusal was a rights erasure, which the service has recorded as a restricted case.
 */
export function legalHoldActive(_held = 1, restricted = false): AppError {
  return new AppError(
    ERROR_CODES.LEGAL_HOLD_ACTIVE,
    LEGAL_HOLD_BLOCKED_MESSAGE,
    HttpStatus.CONFLICT,
    [
      { path: 'held', message: 'true' },
      ...(restricted ? [{ path: 'restricted', message: 'true' }] : []),
    ],
  );
}

/** Did this database error come from the delete trigger of a held record? */
export function isLegalHoldDbError(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    const msg = (cur as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.includes('LEGAL_HOLD_ACTIVE')) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The 409 a feature answers when it would send a held person's data somewhere new (an AI provider): the data is kept and locked, not
 * processed. Neutral on purpose, like the purge refusal.
 */
export function legalHoldRestricted(): AppError {
  return new AppError(
    ERROR_CODES.LEGAL_HOLD_ACTIVE,
    "Processing of this contact's data is restricted at the moment, so it cannot be sent to an AI provider.",
    HttpStatus.CONFLICT,
  );
}
