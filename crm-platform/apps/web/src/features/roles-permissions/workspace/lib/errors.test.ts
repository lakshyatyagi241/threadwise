import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { isForbidden, wsError } from './errors';

const err = (status: number, code: string, fields: Array<{ path: string; message: string }> = []) =>
  new ApiError(status, code, 'text that must never be read', 'req-1', fields);

describe('wsError', () => {
  it('maps the member refusals by code', () => {
    expect(wsError(err(403, ERROR_CODES.RBAC_ROLE_GRANT_FORBIDDEN)).key).toBe('grantRole');
    expect(wsError(err(422, ERROR_CODES.RBAC_SELF_ROLE_CHANGE)).key).toBe('selfRoleChange');
    expect(wsError(err(422, ERROR_CODES.RBAC_LAST_OWNER)).key).toBe('lastOwner');
    expect(wsError(err(422, ERROR_CODES.RBAC_SELF_DEACTIVATE)).key).toBe('selfDeactivate');
    expect(wsError(err(403, ERROR_CODES.FORBIDDEN)).kind).toBe('noAccess');
  });
  it('treats a row-version conflict as a reload prompt and keeps the request id', () => {
    const e = wsError(err(409, ERROR_CODES.ROW_VERSION_CONFLICT));
    expect(e).toMatchObject({ kind: 'conflict', key: 'conflict', requestId: 'req-1' });
  });
  it('names the permission when a role grant is refused', () => {
    const e = wsError(
      err(403, ERROR_CODES.RBAC_ROLE_GRANT_FORBIDDEN, [
        { path: 'grants', message: 'billing.wallet.topup' },
      ]),
    );
    expect(e).toMatchObject({
      key: 'grantPermission',
      field: 'grants',
      values: { permission: 'billing.wallet.topup' },
    });
  });
  it('maps validation details to the field and keeps the server text', () => {
    const e = wsError(
      err(422, ERROR_CODES.VALIDATION_FAILED, [{ path: 'password', message: 'Too weak' }]),
    );
    expect(e).toMatchObject({ kind: 'field', field: 'password', detail: 'Too weak' });
    expect(wsError(err(422, ERROR_CODES.VALIDATION_FAILED)).key).toBe('validation');
  });
  it('lists the rules a weak password broke', () => {
    const e = wsError(
      err(422, ERROR_CODES.AUTH_PASSWORD_POLICY, [
        { path: 'password.number', message: 'Include at least one number.' },
        { path: 'password.common', message: 'Too easy to guess.' },
      ]),
    );
    expect(e).toMatchObject({ field: 'password', key: 'passwordPolicy' });
    expect(e.policy).toEqual(['Include at least one number.', 'Too easy to guess.']);
  });
  it('maps in-use, preset and name-taken', () => {
    expect(wsError(err(422, ERROR_CODES.RBAC_ROLE_IN_USE)).key).toBe('roleInUse');
    expect(wsError(err(422, ERROR_CODES.RBAC_PRESET_ROLE)).key).toBe('presetRole');
    expect(wsError(err(409, ERROR_CODES.RBAC_ROLE_NAME_TAKEN))).toMatchObject({ field: 'name' });
  });
  it('falls back for unknown failures', () => {
    expect(wsError(new Error('x')).key).toBe('unexpected');
    expect(wsError(err(500, 'INTERNAL')).key).toBe('unexpected');
    expect(wsError(err(400, 'WHATEVER')).key).toBe('request');
  });
  it('isForbidden is only the missing-permission refusal', () => {
    expect(isForbidden(err(403, ERROR_CODES.FORBIDDEN))).toBe(true);
    expect(isForbidden(err(403, ERROR_CODES.RBAC_ROLE_GRANT_FORBIDDEN))).toBe(false);
  });
});
