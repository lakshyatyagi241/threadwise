import {
  DELETE_CONFIRMATION_PHRASE,
  ERROR_CODES,
  deleteAccountRequestSchema,
  type DeleteAccountRequest,
} from '@crm/contracts';
import { isApiError } from '@/lib/api';

/** Why the API refused to delete the account (the `reason` of its refusal). */
export type DeleteBlocker = 'sole_member' | 'sole_admin';

/** The blocker named by an AUTH_DELETE_BLOCKED refusal, or null for any other error. */
export function blockerOf(error: unknown): DeleteBlocker | null {
  if (!isApiError(error) || error.code !== ERROR_CODES.AUTH_DELETE_BLOCKED) return null;
  const reason = error.fieldErrors.find((e) => e.path === 'reason')?.message;
  return reason === 'sole_member' || reason === 'sole_admin' ? reason : null;
}

/** True when what was typed is exactly the phrase: capitals count, spaces around it do not. */
export const phraseMatches = (input: string): boolean =>
  input.trim() === DELETE_CONFIRMATION_PHRASE;

/** The request body: the confirmation phrase and the password, nothing else. Null when either is not usable. */
export function buildDeleteRequest(phrase: string, password: string): DeleteAccountRequest | null {
  const parsed = deleteAccountRequestSchema.safeParse({ confirmation: phrase.trim(), password });
  return parsed.success ? parsed.data : null;
}
