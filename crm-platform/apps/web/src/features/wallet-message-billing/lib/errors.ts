import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `wallet-message-billing.errors`) for an API failure: chosen by the stable code, never the wording. */
export const ERROR_KINDS = [
  'noteRequired',
  'amountInvalid',
  'insufficient',
  'notFound',
  'rateInvalid',
  'importFailed',
  'syncFailed',
  'conflict',
  'forbidden',
  'validation',
  'network',
  'generic',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

const BY_CODE: Record<string, ErrorKind> = {
  [ERROR_CODES.WALLET_NOTE_REQUIRED]: 'noteRequired',
  [ERROR_CODES.WALLET_AMOUNT_INVALID]: 'amountInvalid',
  [ERROR_CODES.WALLET_INSUFFICIENT_BALANCE]: 'insufficient',
  [ERROR_CODES.WALLET_NOT_FOUND]: 'notFound',
  [ERROR_CODES.WALLET_RATE_INVALID]: 'rateInvalid',
  [ERROR_CODES.WALLET_IMPORT_FAILED]: 'importFailed',
  [ERROR_CODES.WALLET_SYNC_FAILED]: 'syncFailed',
  ROW_VERSION_CONFLICT: 'conflict',
  AUTH_OPERATOR_ROLE_REQUIRED: 'forbidden',
  VALIDATION_FAILED: 'validation',
};

export function errorKind(err: unknown): ErrorKind {
  if (!(err instanceof ApiError)) return 'network';
  return BY_CODE[err.code] ?? (err.status === 403 ? 'forbidden' : 'generic');
}

export const requestIdOf = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.requestId : undefined;
