import { ApiError } from '@/lib/api/errors';

/** The message key (under `bsp-billing-engine.errors`) for an API failure, branching on the stable code, never the wording. */
export const ERROR_KINDS = [
  'notConfigured',
  'currencyUnsupported',
  'wabaNotFound',
  'metaRejected',
  'notAttached',
  'resellerUnavailable',
  'conflict',
  'forbidden',
  'validation',
  'generic',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

const BY_CODE: Record<string, ErrorKind> = {
  BSP_NOT_CONFIGURED: 'notConfigured',
  BSP_CURRENCY_UNSUPPORTED: 'currencyUnsupported',
  BSP_WABA_NOT_FOUND: 'wabaNotFound',
  BSP_META_REJECTED: 'metaRejected',
  BSP_ALLOCATION_NOT_ATTACHED: 'notAttached',
  BSP_RESELLER_UNAVAILABLE: 'resellerUnavailable',
  ROW_VERSION_CONFLICT: 'conflict',
  AUTH_OPERATOR_ROLE_REQUIRED: 'forbidden',
  VALIDATION_FAILED: 'validation',
};

export interface ErrorView {
  kind: ErrorKind;
  /** Meta's own wording for `metaRejected` (the API puts it after "Revoke failed: "). */
  detail?: string;
}

export function errorView(err: unknown): ErrorView {
  if (!(err instanceof ApiError)) return { kind: 'generic' };
  const kind = BY_CODE[err.code] ?? (err.status === 403 ? 'forbidden' : 'generic');
  if (kind !== 'metaRejected') return { kind };
  return { kind, detail: err.message.replace(/^Revoke failed:\s*/i, '') };
}

/** Field paths the API rejected, for marking inputs (`errors[].path`). */
export function fieldErrors(err: unknown): Set<string> {
  return err instanceof ApiError ? new Set(err.fieldErrors.map((e) => e.path)) : new Set();
}
