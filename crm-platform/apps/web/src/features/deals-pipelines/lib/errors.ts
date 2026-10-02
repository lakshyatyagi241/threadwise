import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed call, chosen by error `code`, never by the server's wording. */
export const ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'conflict',
  'validation',
  'unavailable',
  'rateLimited',
  'notFound',
  'planDisabled',
  'planLimit',
  'lostReasonRequired',
  'ownerInvalid',
  'stageMismatch',
  'stageHasDeals',
  'pipelineHasDeals',
  'defaultProtected',
  'kindTaken',
  'lastStage',
  'nameTaken',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.UNAUTHENTICATED:
      return 'signedOut';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.VALIDATION_FAILED:
    case ERROR_CODES.DEAL_VALUE_INVALID:
    case ERROR_CODES.DEAL_POSITION_INVALID:
    case ERROR_CODES.DEAL_ORDER_INVALID:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.NOT_FOUND:
    case ERROR_CODES.DEAL_TASK_NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'planDisabled';
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return 'planLimit';
    case ERROR_CODES.DEAL_LOST_REASON_REQUIRED:
      return 'lostReasonRequired';
    case ERROR_CODES.DEAL_OWNER_INVALID:
      return 'ownerInvalid';
    case ERROR_CODES.DEAL_STAGE_MISMATCH:
      return 'stageMismatch';
    case ERROR_CODES.DEAL_STAGE_HAS_DEALS:
      return 'stageHasDeals';
    case ERROR_CODES.DEAL_PIPELINE_HAS_DEALS:
    case ERROR_CODES.DEAL_PIPELINE_TARGET_INVALID:
      return 'pipelineHasDeals';
    case ERROR_CODES.DEAL_PIPELINE_DEFAULT_PROTECTED:
      return 'defaultProtected';
    case ERROR_CODES.DEAL_STAGE_KIND_TAKEN:
      return 'kindTaken';
    case ERROR_CODES.DEAL_STAGE_LAST:
      return 'lastStage';
    case ERROR_CODES.DEAL_PIPELINE_NAME_TAKEN:
    case ERROR_CODES.DEAL_STAGE_NAME_TAKEN:
    case ERROR_CODES.DEAL_LOST_REASON_NAME_TAKEN:
      return 'nameTaken';
  }
  // A route that is not deployed answers 404 or 501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}

export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;

/** The API has no deals routes yet: not a failure of this screen. */
export const isUnavailable = (error: unknown): boolean => errorKind(error) === 'unavailable';
