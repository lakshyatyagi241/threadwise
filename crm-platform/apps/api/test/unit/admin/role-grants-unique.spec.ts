import { describe, expect, it } from 'vitest';
import { createRoleSchema, updateRoleSchema } from '@crm/contracts';

const grant = (permissionKey: string, recordScope: 'all' | 'own' = 'all') => ({
  permissionKey,
  effect: 'allow' as const,
  recordScope,
});

// role_grants has a unique index on (org, role, permission_key): a repeated key reached the insert and answered 500.
describe('role grant sets', () => {
  it('rejects a repeated permission key on update', () => {
    const res = updateRoleSchema.safeParse({
      rowVersion: 1,
      grants: [grant('contacts.read'), grant('contacts.read', 'own')],
    });
    expect(res.success).toBe(false);
  });

  it('rejects a repeated permission key on create', () => {
    const res = createRoleSchema.safeParse({
      name: 'Support',
      grants: [grant('contacts.read'), grant('contacts.read')],
    });
    expect(res.success).toBe(false);
  });

  it('accepts distinct keys', () => {
    const res = updateRoleSchema.safeParse({
      rowVersion: 1,
      grants: [grant('contacts.read'), grant('contacts.write', 'own')],
    });
    expect(res.success).toBe(true);
  });
});
