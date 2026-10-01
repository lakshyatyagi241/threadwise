import { DELETE_CONFIRMATION_PHRASE, ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { fieldMessages } from '../../shared/error-utils';

/** Why the API refused to delete the account (`fieldErrors` entry `reason`). */
export type DeleteBlocker = 'sole_member' | 'sole_admin';

/** The blocker named by an AUTH_DELETE_BLOCKED refusal, or null for any other error. */
export function blockerOf(error: unknown): DeleteBlocker | null {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.AUTH_DELETE_BLOCKED) return null;
  const reason = fieldMessages(error, 'reason')[0];
  return reason === 'sole_member' || reason === 'sole_admin' ? reason : null;
}

/** True when what was typed is exactly the phrase: case-sensitive, surrounding spaces ignored as WaDesk does. */
export function phraseMatches(input: string): boolean {
  return input.trim() === DELETE_CONFIRMATION_PHRASE;
}
