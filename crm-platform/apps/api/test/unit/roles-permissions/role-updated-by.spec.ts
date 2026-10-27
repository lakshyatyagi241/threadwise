import { describe, expect, it } from 'vitest';
import { toRoleResponse } from '../../../src/modules/admin/roles/roles.mapper';
import type { RoleRow } from '../../../src/modules/admin/roles/roles.repository';

const row = {
  id: 7,
  uuid: '11111111-1111-4111-8111-111111111111',
  name: 'Agent',
  systemKey: null,
  isLocked: false,
  rowVersion: 3,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-20T09:30:00Z'),
} as unknown as RoleRow;

const view = {
  userCount: 2,
  membersWithoutTeam: 0,
  grantable: true,
  editable: true,
  updatedBy: 'Lakshya Tyagi',
};

describe('role response: who last edited the role', () => {
  it('names the person who last saved the role, with the time it was saved', () => {
    const out = toRoleResponse(row, [], view);
    expect(out.updatedBy).toBe('Lakshya Tyagi');
    expect(out.updatedAt).toBe('2026-10-20T09:30:00.000Z');
  });

  it('is null when the audit trail has no one who saved the role', () => {
    expect(toRoleResponse(row, [], { ...view, updatedBy: null }).updatedBy).toBeNull();
  });
});
