import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** Message keys under `workspaces-hub.errors`. */
export type HubErrorKey =
  | 'unexpected'
  | 'forbidden'
  | 'conflict'
  | 'notFound'
  | 'reasonRequired'
  | 'orgSuspended'
  | 'noOwner'
  | 'validation';

export interface HubError {
  key: HubErrorKey;
  requestId?: string;
}

/** Branches on the problem+json `code`, never on its message text. */
export function hubError(err: unknown): HubError {
  if (!(err instanceof ApiError)) return { key: 'unexpected' };
  const requestId = err.requestId ?? undefined;
  switch (err.code) {
    case ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED:
    case ERROR_CODES.FORBIDDEN:
      return { key: 'forbidden', requestId };
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return { key: 'conflict', requestId };
    case ERROR_CODES.NOT_FOUND:
      return { key: 'notFound', requestId };
    case ERROR_CODES.WSP_IMPERSONATION_REASON_REQUIRED:
      return { key: 'reasonRequired', requestId };
    case ERROR_CODES.WSP_ORG_SUSPENDED:
      return { key: 'orgSuspended', requestId };
    case ERROR_CODES.WSP_IMPERSONATION_NO_OWNER:
      return { key: 'noOwner', requestId };
    case ERROR_CODES.VALIDATION_FAILED:
      return { key: 'validation', requestId };
    default:
      return { key: 'unexpected', requestId };
  }
}
