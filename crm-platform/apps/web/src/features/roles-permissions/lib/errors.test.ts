import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { isNoAccess, rbacError } from './errors';

const api = (
  status: number,
  code: string,
  fieldErrors: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, 'text that must never be read', 'req-1', fieldErrors);

describe('rbacError', () => {
  it('maps a row version conflict to a reload prompt', () => {
    expect(rbacError(api(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toMatchObject({
      kind: 'conflict',
      requestId: 'req-1',
    });
  });
  it('names the missing permission on a 403', () => {
    expect(
      rbacError(
        api(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED, [
          { path: 'permission', message: 'platform.role.manage' },
        ]),
      ),
    ).toMatchObject({ kind: 'noAccess', values: { permission: 'platform.role.manage' } });
  });
  it('puts name clashes on the name field, for roles and permissions', () => {
    for (const code of [ERROR_CODES.RBAC_ROLE_NAME_TAKEN, ERROR_CODES.RBAC_PERMISSION_NAME_TAKEN]) {
      expect(rbacError(api(409, code))).toMatchObject({
        kind: 'field',
        key: 'nameTaken',
        field: 'name',
      });
    }
  });
  it('uses the delete wording for the Super Admin lock only when deleting', () => {
    expect(rbacError(api(403, ERROR_CODES.RBAC_ROLE_LOCKED), 'delete').key).toBe('lockedDelete');
    expect(rbacError(api(403, ERROR_CODES.RBAC_ROLE_LOCKED), 'save').key).toBe('locked');
  });
  it('lists unknown permission names', () => {
    expect(
      rbacError(
        api(422, ERROR_CODES.RBAC_PERMISSION_UNKNOWN, [
          { path: 'permissions', message: 'a.b' },
          { path: 'permissions', message: 'c.d' },
        ]),
      ),
    ).toMatchObject({ field: 'permissions', values: { names: 'a.b, c.d' } });
  });
  it('puts the same-role refusal on the target select', () => {
    expect(rbacError(api(422, ERROR_CODES.RBAC_REASSIGN_SAME_ROLE))).toMatchObject({
      field: 'targetRoleId',
      key: 'reassignSame',
    });
  });
  it('maps the staff guards', () => {
    expect(rbacError(api(409, ERROR_CODES.RBAC_LAST_SUPER_ADMIN)).key).toBe('lastSuperAdmin');
    expect(rbacError(api(403, ERROR_CODES.RBAC_PRIVILEGED_ROLE)).key).toBe('privilegedRole');
    expect(rbacError(api(409, ERROR_CODES.RBAC_PERMISSION_SYSTEM)).key).toBe('permissionSystem');
  });
  it('keeps the server message for a field validation failure', () => {
    expect(
      rbacError(api(422, ERROR_CODES.VALIDATION_FAILED, [{ path: 'name', message: 'Too long.' }])),
    ).toMatchObject({ field: 'name', key: 'validationField', values: { message: 'Too long.' } });
  });
  it('falls back by status for anything else, and for non API errors', () => {
    expect(rbacError(api(500, 'INTERNAL')).key).toBe('unexpected');
    expect(rbacError(api(400, 'WHATEVER')).key).toBe('request');
    expect(rbacError(new Error('boom')).key).toBe('unexpected');
  });
});

describe('isNoAccess', () => {
  it('recognises the permission refusal', () => {
    expect(isNoAccess(api(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED))).toBe(true);
    expect(isNoAccess(api(403, ERROR_CODES.FORBIDDEN))).toBe(true);
    expect(isNoAccess(api(500, 'INTERNAL'))).toBe(false);
    expect(isNoAccess(new Error('x'))).toBe(false);
  });
});
