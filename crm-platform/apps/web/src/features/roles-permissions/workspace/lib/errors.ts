import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type WsErrorKind = 'conflict' | 'noAccess' | 'field' | 'general';

export interface WsError {
  kind: WsErrorKind;
  /** Message key under `roles-permissions-workspace.errors`. */
  key: string;
  field?: 'name' | 'email' | 'password' | 'fullName' | 'roleIds' | 'grants';
  values?: Record<string, string>;
  /** Server-sent text for a field (validation details). */
  detail?: string;
  /** The rules the password broke (AUTH_PASSWORD_POLICY details), one line each. */
  policy?: string[];
  requestId?: string;
}

const FIELDS = ['name', 'email', 'password', 'fullName', 'roleIds', 'grants'] as const;
const asField = (p: string | undefined) => FIELDS.find((f) => f === p);

/** Branches on the problem+json `code`, never on message text. */
export function wsError(err: unknown): WsError {
  if (!(err instanceof ApiError)) return { kind: 'general', key: 'unexpected' };
  const requestId = err.requestId;
  const first = err.fieldErrors[0];
  switch (err.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return { kind: 'conflict', key: 'conflict', requestId };
    case ERROR_CODES.FORBIDDEN:
      return { kind: 'noAccess', key: 'forbidden', requestId };
    case ERROR_CODES.RBAC_ROLE_GRANT_FORBIDDEN:
      // Role grant (members) or permission grant (role editor); the permission key rides in details[0].message.
      return first?.path === 'grants'
        ? {
            kind: 'field',
            key: 'grantPermission',
            field: 'grants',
            values: { permission: first.message },
            requestId,
          }
        : { kind: 'general', key: 'grantRole', requestId };
    case ERROR_CODES.RBAC_SELF_ROLE_CHANGE:
      return { kind: 'general', key: 'selfRoleChange', requestId };
    case ERROR_CODES.RBAC_LAST_OWNER:
      return { kind: 'general', key: 'lastOwner', requestId };
    case ERROR_CODES.RBAC_SELF_DEACTIVATE:
      return { kind: 'general', key: 'selfDeactivate', requestId };
    case ERROR_CODES.RBAC_PRESET_ROLE:
      return { kind: 'general', key: 'presetRole', requestId };
    case ERROR_CODES.RBAC_ROLE_IN_USE:
      return { kind: 'general', key: 'roleInUse', requestId };
    case ERROR_CODES.RBAC_ROLE_NAME_TAKEN:
      return { kind: 'field', key: 'nameTaken', field: 'name', requestId };
    case ERROR_CODES.AUTH_PASSWORD_POLICY:
      return {
        kind: 'field',
        key: 'passwordPolicy',
        field: 'password',
        policy: err.fieldErrors.map((e) => e.message),
        requestId,
      };
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      // `custom_roles` is off for the plan (or the add-on is not bought): the Roles screen already says so before a save is tried.
      return { kind: 'general', key: 'customRolesLocked', requestId };
    case ERROR_CODES.NOT_FOUND:
      return { kind: 'general', key: 'notFound', requestId };
    case ERROR_CODES.VALIDATION_FAILED: {
      const field = asField(first?.path);
      if (field && first) {
        // A duplicate role name arrives as a validation detail on `name` too.
        return { kind: 'field', key: 'validationField', field, detail: first.message, requestId };
      }
      return { kind: 'general', key: 'validation', requestId };
    }
    default:
      return { kind: 'general', key: err.status >= 500 ? 'unexpected' : 'request', requestId };
  }
}

/** True when the failure means "this person may not use this screen". */
export const isForbidden = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 403 && err.code === ERROR_CODES.FORBIDDEN;
