import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { PlatformRbacService } from '../../../src/modules/roles-permissions/platform-rbac.service';
import { PlatformRolesService } from '../../../src/modules/roles-permissions/platform-roles.service';

/** A platform operator who holds only `platform.role.manage` must not grant a role with more than that (issue #1505). */
const actor = 7;
const asOperator = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'cov', orgId: 0, actorType: 'platform_operator', actorId: actor, userId: null },
    fn,
  );

function rbacWith(holds: string[], superAdmin = false) {
  const rbac = new PlatformRbacService({} as never, {} as never);
  vi.spyOn(rbac, 'isSuperAdmin').mockResolvedValue(superAdmin);
  vi.spyOn(rbac, 'permissionsOf').mockResolvedValue(new Set(holds));
  return rbac;
}

describe('PlatformRbacService.covers', () => {
  it('is true only when the operator holds every named permission', async () => {
    const rbac = rbacWith(['platform.role.manage', 'users.view']);
    expect(await rbac.covers(actor, ['users.view'])).toBe(true);
    expect(await rbac.covers(actor, ['users.view', 'platform.permission.manage'])).toBe(false);
    expect(await rbac.covers(actor, [])).toBe(true);
  });

  it('lets the Super Admin grant anything', async () => {
    const rbac = rbacWith([], true);
    expect(await rbac.covers(actor, ['platform.permission.manage'])).toBe(true);
  });
});

describe('PlatformRolesService grants', () => {
  function service(holds: string[]) {
    const rbac = rbacWith(holds);
    const tx = { execute: vi.fn(async () => ({ rows: [] })) };
    const store = { tx: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
    const bumpInTx = vi.fn(async () => undefined);
    const dropVersionCache = vi.fn(async () => undefined);
    Object.assign(rbac, { bumpInTx, dropVersionCache });
    const roles = new PlatformRolesService(store as never, rbac, {} as never);
    return { roles, tx, rbac };
  }

  it('refuses to create a role with a permission the editor does not hold, before writing anything', async () => {
    const { roles, tx } = service(['platform.role.manage']);
    const err = await asOperator(() =>
      roles.create({
        name: 'Escalation',
        description: null,
        permissions: ['platform.role.manage', 'platform.permission.manage'],
      } as never),
    ).catch((e: unknown) => e as { code?: string; getStatus?: () => number });
    expect(err.code).toBe(ERROR_CODES.RBAC_PRIVILEGED_ROLE);
    expect(err.getStatus?.()).toBe(403);
    expect(tx.execute).not.toHaveBeenCalled();
  });
});
