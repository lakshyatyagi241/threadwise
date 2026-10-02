import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The form field an error belongs to, when it has one. */
export type RbacField = 'name' | 'permissions' | 'targetRoleId' | 'roleIds';

export type RbacErrorKind =
  /** Someone else saved the role first: offer a reload, never a blind retry. */
  | 'conflict'
  /** The operator lacks the platform permission the route demands. */
  | 'noAccess'
  /** Belongs to one input. */
  | 'field'
  | 'general';

export interface RbacError {
  kind: RbacErrorKind;
  /** Message key under `roles-permissions.errors`. */
  key: string;
  field?: RbacField;
  /** ICU values for the message (`names`, `permission`). */
  values?: Record<string, string>;
  requestId?: string;
}

/** What the person was doing when the call failed: the lock message differs between a save and a delete. */
export type RbacAction = 'save' | 'delete' | 'other';

const FIELDS: readonly RbacField[] = ['name', 'permissions', 'targetRoleId', 'roleIds'];
const asField = (path: string | undefined): RbacField | undefined => FIELDS.find((f) => f === path);

/** Branches on the problem+json `code`, never on its message text. */
export function rbacError(err: unknown, action: RbacAction = 'other'): RbacError {
  if (!(err instanceof ApiError)) return { kind: 'general', key: 'unexpected' };
  const requestId = err.requestId;
  const first = err.fieldErrors[0];
  switch (err.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return { kind: 'conflict', key: 'conflict', requestId };
    case ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED:
      return {
        kind: 'noAccess',
        key: 'noAccess',
        values: { permission: first?.message ?? '' },
        requestId,
      };
    case ERROR_CODES.RBAC_ROLE_NAME_TAKEN:
    case ERROR_CODES.RBAC_PERMISSION_NAME_TAKEN:
      return { kind: 'field', key: 'nameTaken', field: 'name', requestId };
    case ERROR_CODES.RBAC_ROLE_LOCKED:
      return { kind: 'general', key: action === 'delete' ? 'lockedDelete' : 'locked', requestId };
    case ERROR_CODES.RBAC_PERMISSION_SYSTEM:
      return { kind: 'general', key: 'permissionSystem', requestId };
    case ERROR_CODES.RBAC_PERMISSION_UNKNOWN:
      return {
        kind: 'field',
        key: 'permissionUnknown',
        field: 'permissions',
        values: { names: err.fieldErrors.map((e) => e.message).join(', ') },
        requestId,
      };
    case ERROR_CODES.RBAC_REASSIGN_SAME_ROLE:
      return { kind: 'field', key: 'reassignSame', field: 'targetRoleId', requestId };
    case ERROR_CODES.RBAC_LAST_SUPER_ADMIN:
      return { kind: 'general', key: 'lastSuperAdmin', requestId };
    case ERROR_CODES.RBAC_PRIVILEGED_ROLE:
      return { kind: 'general', key: 'privilegedRole', requestId };
    case ERROR_CODES.NOT_FOUND:
      return { kind: 'general', key: 'notFound', requestId };
    case ERROR_CODES.VALIDATION_FAILED: {
      const field = asField(first?.path);
      if (field && first) {
        return {
          kind: 'field',
          key: 'validationField',
          field,
          values: { message: first.message },
          requestId,
        };
      }
      return { kind: 'general', key: 'validation', requestId };
    }
    default:
      return { kind: 'general', key: err.status >= 500 ? 'unexpected' : 'request', requestId };
  }
}

/** True when the failure is "this operator may not use this screen". */
export const isNoAccess = (err: unknown): boolean =>
  err instanceof ApiError &&
  (err.code === ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED ||
    (err.status === 403 && err.code === ERROR_CODES.FORBIDDEN));
