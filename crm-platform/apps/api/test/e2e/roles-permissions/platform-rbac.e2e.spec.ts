import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PLATFORM_PERMISSION_KEYS,
  platformMyPermissionsSchema,
  platformPermissionListResponseSchema,
  platformRoleDetailSchema,
  platformRoleListResponseSchema,
  platformStaffListResponseSchema,
} from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Platform roles, the permission catalogue and staff assignment end to end through HTTP (WD-RBAC-001, 003, 005..014, 021, 023).
 * One app, one database; each test makes its own roles and permissions so none depends on another.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let superToken = '';
let supportToken = '';
let auditorToken = '';
let counter = 0;
const uniq = (p: string) => `${p}${Date.now()}${counter++}`;

type Method = 'get' | 'post' | 'put' | 'delete';
const call = (token: string, method: Method, path: string) =>
  api()[method](`/v2/platform${path}`).set(bearer(token));
const sup = (method: Method, path: string) => call(superToken, method, path);

async function login(email: string): Promise<string> {
  const res = await api()
    .post('/v2/platform/auth/login')
    .send({ email, password: OPERATOR_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.tokens.accessToken as string;
}

async function createRole(name: string, permissions: string[] = []) {
  const res = await sup('post', '/roles').send({ name, permissions });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return platformRoleDetailSchema.parse(res.body);
}

const roleByName = async (name: string) => {
  const res = await sup('get', '/roles');
  const found = platformRoleListResponseSchema.parse(res.body).data.find((r) => r.name === name);
  expect(found, `role ${name}`).toBeTruthy();
  return found!;
};

const auditEvents = async (event: string) =>
  (await h.owner.query(`SELECT payload FROM security_events WHERE event = $1 ORDER BY id`, [event]))
    .rows;

beforeAll(async () => {
  h = await startHarness();
  superToken = await login(OPERATOR_EMAIL);
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(superToken));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(superToken))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);

  supportToken = await login('support@platform.test');
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'auditor@platform.test', 'Auditor', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
    [OPERATOR_EMAIL],
  );
  auditorToken = await login('auditor@platform.test');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('seed (WD-RBAC-001, 003)', () => {
  it('has the six WaDesk roles and 107 permissions, with the seeded matrix', async () => {
    const roles = platformRoleListResponseSchema.parse((await sup('get', '/roles')).body);
    const count = Object.fromEntries(roles.data.map((r) => [r.name, r.permissionCount]));
    expect(count).toMatchObject({
      'Super Admin': 107,
      Admin: 107,
      Manager: 42,
      User: 22,
      'Platform Support': 9,
      Auditor: 4,
    });
    expect(roles.kpis.totalPermissions).toBe(107);
    expect(roles.kpis.systemRoles).toBe(2);
    expect(roles.data.find((r) => r.name === 'Super Admin')).toMatchObject({
      isLocked: true,
      userCount: 1,
    });
  });

  it('keeps the WaDesk quirk: the User role holds platform.audit.view and platform.billing.view', async () => {
    const user = platformRoleDetailSchema.parse(
      (await sup('get', `/roles/${(await roleByName('User')).id}`)).body,
    );
    expect(user.permissions).toEqual(
      expect.arrayContaining(['platform.audit.view', 'platform.billing.view']),
    );
    expect(user.permissions.every((p) => p.endsWith('.view'))).toBe(true);
  });

  it('gives each existing operator the role of their tier', async () => {
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const byEmail = Object.fromEntries(
      staff.data.map((s) => [s.email, s.roles.map((r) => r.name)]),
    );
    expect(byEmail[OPERATOR_EMAIL]).toEqual(['Super Admin']);
    expect(byEmail['support@platform.test']).toEqual(['Platform Support']);
    expect(byEmail['auditor@platform.test']).toEqual(['Auditor']);
  });
});

describe('the platform permission gate (WD-RBAC-003, 019)', () => {
  it('maps the 16 enforced keys for the caller', async () => {
    const mine = platformMyPermissionsSchema.parse(
      (await call(auditorToken, 'get', '/me/permissions')).body,
    );
    expect(Object.keys(mine.permissions).sort()).toEqual([...PLATFORM_PERMISSION_KEYS].sort());
    expect(mine.permissions['platform.audit.view']).toBe(true);
    expect(mine.permissions['platform.workspace.impersonate']).toBe(false);
    expect(mine.roles).toEqual(['Auditor']);
    expect(mine.isSuperAdmin).toBe(false);
  });

  it('refuses an operator without platform.role.manage, naming the permission, and records the attempt', async () => {
    for (const token of [supportToken, auditorToken]) {
      const res = await call(token, 'get', '/roles');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('RBAC_PLATFORM_PERMISSION_REQUIRED');
    }
    expect((await call(supportToken, 'get', '/permissions')).status).toBe(403);
    expect((await call(supportToken, 'post', '/roles').send({ name: 'x' })).status).toBe(403);
    expect((await auditEvents('platform.permission_denied')).length).toBeGreaterThan(0);
  });

  it('applies a role edit on the holder’s very next request, without waiting for the cache', async () => {
    const role = await createRole(uniq('Role Managers '), ['platform.role.manage']);
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const supportOp = staff.data.find((s) => s.email === 'support@platform.test')!;
    const keep = supportOp.roles.map((r) => r.id);
    const set = await sup('put', `/staff/${supportOp.id}/roles`).send({
      roleIds: [...keep, role.id],
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    expect((await call(supportToken, 'get', '/roles')).status).toBe(200);

    const edit = await sup('put', `/roles/${role.id}`).send({
      name: role.name,
      description: '',
      permissions: [],
      rowVersion: role.rowVersion,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await call(supportToken, 'get', '/roles')).status).toBe(403);
  });

  it('fails closed when a key is deleted from the catalogue', async () => {
    const name = `tmp.${uniq('gate')}`;
    const created = await sup('post', '/permissions').send({ name });
    expect(created.status).toBe(201);
    const role = await createRole(uniq('Gate '), [name]);
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const audit = staff.data.find((s) => s.email === 'auditor@platform.test')!;
    await sup('put', `/staff/${audit.id}/roles`).send({
      roleIds: [...audit.roles.map((r) => r.id), role.id],
    });
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM platform_role_permissions WHERE role_id = (SELECT id FROM platform_roles WHERE uuid = $1)`,
          [role.id],
        )
      ).rowCount,
    ).toBe(1);
    expect((await sup('delete', `/permissions/${created.body.id}`)).status).toBe(200);
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM platform_role_permissions WHERE role_id = (SELECT id FROM platform_roles WHERE uuid = $1)`,
          [role.id],
        )
      ).rowCount,
    ).toBe(0);
    await sup('put', `/staff/${audit.id}/roles`).send({ roleIds: audit.roles.map((r) => r.id) });
  });
});

describe('roles list (WD-RBAC-005)', () => {
  it('filters by type and searches by name, treating % and _ as text', async () => {
    const custom = await createRole(uniq('Sales_Lead% '));
    const system = platformRoleListResponseSchema.parse(
      (await sup('get', '/roles?type=system')).body,
    );
    expect(system.data.map((r) => r.name).sort()).toEqual(['Admin', 'Super Admin']);
    const customList = platformRoleListResponseSchema.parse(
      (await sup('get', '/roles?type=custom')).body,
    );
    expect(customList.data.map((r) => r.name)).toContain(custom.name);
    expect(customList.data.every((r) => !r.isSystem)).toBe(true);

    const wild = platformRoleListResponseSchema.parse((await sup('get', '/roles?search=%25')).body);
    expect(wild.data.map((r) => r.name)).toEqual([custom.name]);
    const found = platformRoleListResponseSchema.parse(
      (await sup('get', '/roles?search=SUPER')).body,
    );
    expect(found.data.map((r) => r.name)).toEqual(['Super Admin']);
    // the KPI strip counts every role whatever the filter
    expect(found.kpis.totalRoles).toBeGreaterThanOrEqual(7);
  });
});

describe('create role (WD-RBAC-006)', () => {
  it('creates a role with exactly the ticked permissions', async () => {
    const role = await createRole(uniq('Sales Lead '), [
      'users.view',
      'campaigns.send',
      'billing.refund',
    ]);
    expect(role.permissions).toEqual(['billing.refund', 'campaigns.send', 'users.view']);
    expect(role.permissionCount).toBe(3);
    expect(role.userCount).toBe(0);
    expect(role.isSystem).toBe(false);
    expect(
      (await auditEvents('admin.role.created')).some((e) => e.payload.role === role.name),
    ).toBe(true);
  });

  it('refuses a name that differs only by case, and an empty or over-long name', async () => {
    const name = uniq('Dup ');
    await createRole(name);
    const res = await sup('post', '/roles').send({ name: name.toLowerCase() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RBAC_ROLE_NAME_TAKEN');
    expect((await sup('post', '/roles').send({ name: '  ' })).status).toBe(422);
    expect((await sup('post', '/roles').send({ name: 'x'.repeat(192) })).status).toBe(422);
    expect((await roleByName(name)).name).toBe(name);
  });

  it('refuses a permission that is not in the catalogue and creates nothing', async () => {
    const name = uniq('Typo ');
    const res = await sup('post', '/roles').send({
      name,
      permissions: ['users.view', 'users.viewz'],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RBAC_PERMISSION_UNKNOWN');
    const all = platformRoleListResponseSchema.parse((await sup('get', '/roles')).body);
    expect(all.data.some((r) => r.name === name)).toBe(false);
  });

  it('creates a role with no permissions when none are sent', async () => {
    const role = await createRole(uniq('Empty '));
    expect(role.permissions).toEqual([]);
  });
});

describe('edit role (WD-RBAC-007)', () => {
  it('renames and fully replaces the permission set; unticking everything leaves zero', async () => {
    const role = await createRole(uniq('Editable '), ['users.view', 'users.edit']);
    const renamed = `${role.name} v2`;
    const res = await sup('put', `/roles/${role.id}`).send({
      name: renamed,
      description: 'Handles trials',
      permissions: ['flows.view'],
      rowVersion: role.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = platformRoleDetailSchema.parse(res.body);
    expect(after).toMatchObject({
      name: renamed,
      description: 'Handles trials',
      permissions: ['flows.view'],
    });
    expect(after.rowVersion).toBeGreaterThan(role.rowVersion);

    const cleared = await sup('put', `/roles/${role.id}`).send({
      name: renamed,
      permissions: [],
      rowVersion: after.rowVersion,
    });
    expect(platformRoleDetailSchema.parse(cleared.body).permissionCount).toBe(0);
    const updates = await auditEvents('admin.role.updated');
    expect(updates.some((e) => e.payload.removed?.includes('flows.view'))).toBe(true);
  });

  it('refuses a stale rowVersion with 409 and a name that another role owns', async () => {
    const a = await createRole(uniq('A '));
    const b = await createRole(uniq('B '));
    const stale = await sup('put', `/roles/${a.id}`).send({
      name: a.name,
      permissions: [],
      rowVersion: a.rowVersion + 5,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    const taken = await sup('put', `/roles/${a.id}`).send({
      name: b.name.toUpperCase(),
      permissions: [],
      rowVersion: a.rowVersion,
    });
    expect(taken.status).toBe(422);
    expect(taken.body.code).toBe('RBAC_ROLE_NAME_TAKEN');
  });

  it('lets a role keep its own name under another case', async () => {
    const role = await createRole(uniq('Keep '));
    const res = await sup('put', `/roles/${role.id}`).send({
      name: role.name.toUpperCase(),
      permissions: [],
      rowVersion: role.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('protects Super Admin in the server: no rename, no stripped permission; adding is allowed', async () => {
    const superRole = platformRoleDetailSchema.parse(
      (await sup('get', `/roles/${(await roleByName('Super Admin')).id}`)).body,
    );
    const rename = await sup('put', `/roles/${superRole.id}`).send({
      name: 'Root',
      permissions: superRole.permissions,
      rowVersion: superRole.rowVersion,
    });
    expect(rename.status).toBe(422);
    expect(rename.body.code).toBe('RBAC_ROLE_LOCKED');
    const strip = await sup('put', `/roles/${superRole.id}`).send({
      name: 'Super Admin',
      permissions: superRole.permissions.slice(1),
      rowVersion: superRole.rowVersion,
    });
    expect(strip.status).toBe(422);
    expect(strip.body.code).toBe('RBAC_ROLE_LOCKED');
    const same = await sup('put', `/roles/${superRole.id}`).send({
      name: 'Super Admin',
      description: 'Everything',
      permissions: superRole.permissions,
      rowVersion: superRole.rowVersion,
    });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(platformRoleDetailSchema.parse(same.body).permissionCount).toBe(107);
  });

  it('is enforced by the database even if the service is bypassed', async () => {
    await expect(
      h.owner.query(`DELETE FROM platform_roles WHERE name = 'Super Admin'`),
    ).rejects.toThrow(/locked/);
    await expect(
      h.owner.query(`UPDATE platform_roles SET name = 'Root' WHERE name = 'Super Admin'`),
    ).rejects.toThrow(/locked/);
    await expect(
      h.owner.query(
        `DELETE FROM platform_role_permissions WHERE role_id = (SELECT id FROM platform_roles WHERE name = 'Super Admin')`,
      ),
    ).rejects.toThrow(/locked/);
  });
});

describe('duplicate role (WD-RBAC-008)', () => {
  it('clones name, description and permissions, never the operators, and numbers the copies', async () => {
    const role = await createRole(uniq('Sales '), ['users.view', 'inbox.reply', 'metaads.approve']);
    const first = await sup('post', `/roles/${role.id}/duplicate`);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const copy = platformRoleDetailSchema.parse(first.body);
    expect(copy.name).toBe(`${role.name} (copy)`);
    expect(copy.permissions).toEqual(role.permissions);
    expect(copy.userCount).toBe(0);
    const second = platformRoleDetailSchema.parse(
      (await sup('post', `/roles/${role.id}/duplicate`)).body,
    );
    expect(second.name).toBe(`${role.name} (copy 2)`);
    expect(
      (await auditEvents('admin.role.duplicated')).some((e) => e.payload.to === copy.name),
    ).toBe(true);
  });

  it('never copies the lock: a copy of Super Admin is an ordinary editable role', async () => {
    const copy = platformRoleDetailSchema.parse(
      (await sup('post', `/roles/${(await roleByName('Super Admin')).id}/duplicate`)).body,
    );
    expect(copy.isLocked).toBe(false);
    expect(copy.permissionCount).toBe(107);
    expect((await sup('delete', `/roles/${copy.id}`)).status).toBe(200);
  });
});

describe('reassign (WD-RBAC-009)', () => {
  it('moves every holder onto the target, keeps their other roles, and reports the count', async () => {
    const from = await createRole(uniq('From '));
    const to = await createRole(uniq('To '));
    const other = await createRole(uniq('Other '));
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const aud = staff.data.find((s) => s.email === 'auditor@platform.test')!;
    const base = aud.roles.map((r) => r.id);
    await sup('put', `/staff/${aud.id}/roles`).send({ roleIds: [...base, from.id, other.id] });

    const res = await sup('post', `/roles/${from.id}/reassign`).send({ targetRoleId: to.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ moved: 1, from: from.name, to: to.name });

    const after = platformStaffListResponseSchema
      .parse((await sup('get', '/staff')).body)
      .data.find((s) => s.email === 'auditor@platform.test')!;
    const names = after.roles.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([to.name, other.name, 'Auditor']));
    expect(names).not.toContain(from.name);
    expect(
      (await auditEvents('admin.role.reassigned')).some(
        (e) => e.payload.from === from.name && e.payload.users === 1,
      ),
    ).toBe(true);
    await sup('put', `/staff/${aud.id}/roles`).send({ roleIds: base });
  });

  it('reports zero moved for an empty role, and refuses the same role as target', async () => {
    const a = await createRole(uniq('Empty '));
    const b = await createRole(uniq('Dest '));
    expect(
      (await sup('post', `/roles/${a.id}/reassign`).send({ targetRoleId: b.id })).body.moved,
    ).toBe(0);
    const same = await sup('post', `/roles/${a.id}/reassign`).send({ targetRoleId: a.id });
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('RBAC_REASSIGN_SAME_ROLE');
  });

  it('refuses to empty Super Admin', async () => {
    const to = await createRole(uniq('Dest '));
    const res = await sup('post', `/roles/${(await roleByName('Super Admin')).id}/reassign`).send({
      targetRoleId: to.id,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RBAC_ROLE_LOCKED');
  });
});

describe('delete role (WD-RBAC-010)', () => {
  it('deletes a custom role; its holders lose it and nothing else', async () => {
    const role = await createRole(uniq('Doomed '), ['users.view']);
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const aud = staff.data.find((s) => s.email === 'auditor@platform.test')!;
    const base = aud.roles.map((r) => r.id);
    await sup('put', `/staff/${aud.id}/roles`).send({ roleIds: [...base, role.id] });
    expect((await sup('delete', `/roles/${role.id}`)).status).toBe(200);
    const after = platformStaffListResponseSchema
      .parse((await sup('get', '/staff')).body)
      .data.find((s) => s.email === 'auditor@platform.test')!;
    expect(after.roles.map((r) => r.name)).toEqual(['Auditor']);
    expect((await sup('get', `/roles/${role.id}`)).status).toBe(404);
    expect(
      (await auditEvents('admin.role.deleted')).some((e) => e.payload.role === role.name),
    ).toBe(true);
  });

  it('refuses Super Admin even by a direct request', async () => {
    const res = await sup('delete', `/roles/${(await roleByName('Super Admin')).id}`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RBAC_ROLE_LOCKED');
    expect(res.body.detail ?? res.body.message).toMatch(/system-locked/);
    await roleByName('Super Admin');
  });

  it('allows deleting the other seeded roles (WaDesk parity)', async () => {
    const copy = platformRoleDetailSchema.parse(
      (await sup('post', `/roles/${(await roleByName('Manager')).id}/duplicate`)).body,
    );
    expect((await sup('delete', `/roles/${copy.id}`)).status).toBe(200);
  });
});

describe('permission catalogue (WD-RBAC-011..013)', () => {
  it('groups by module with role counts and the KPI strip', async () => {
    const list = platformPermissionListResponseSchema.parse(
      (await sup('get', '/permissions')).body,
    );
    expect(list.data.length).toBeGreaterThanOrEqual(101);
    const modules = new Set(list.data.map((p) => p.module));
    expect(modules.has('platform')).toBe(true);
    expect(modules.has('users')).toBe(true);
    expect(list.kpis.modules).toBe(modules.size);
    expect(list.kpis.total).toBe(list.data.length);
    expect(list.kpis.usedInRoles + list.kpis.orphans).toBe(list.kpis.total);
    const users = list.data.find((p) => p.name === 'users.view')!;
    expect(users.roleCount).toBeGreaterThanOrEqual(4);
    expect(list.data.filter((p) => p.isSystem)).toHaveLength(PLATFORM_PERMISSION_KEYS.length);
  });

  it('composes module.action when the name has no dot, and the new key starts orphaned', async () => {
    const action = uniq('export').toLowerCase();
    const res = await sup('post', '/permissions').send({
      name: action,
      module: 'campaigns',
      action,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      name: `campaigns.${action}`,
      module: 'campaigns',
      roleCount: 0,
      isSystem: false,
    });
    const list = platformPermissionListResponseSchema.parse(
      (await sup('get', '/permissions')).body,
    );
    expect(list.kpis.orphans).toBeGreaterThanOrEqual(1);
    expect(list.kpis.lastAdded?.name).toBe(`campaigns.${action}`);
  });

  it('validates uniqueness on the composed name (WaDesk answered 500) and the key format', async () => {
    const dup = await sup('post', '/permissions').send({
      name: 'x',
      module: 'users',
      action: 'view',
    });
    expect(dup.status).toBe(422);
    expect(dup.body.code).toBe('RBAC_PERMISSION_NAME_TAKEN');
    const same = await sup('post', '/permissions').send({ name: 'users.view' });
    expect(same.body.code).toBe('RBAC_PERMISSION_NAME_TAKEN');
    for (const name of ['Has Space', 'UPPER.case', 'trailing.', '.leading', 'a..b']) {
      expect((await sup('post', '/permissions').send({ name })).status, name).toBe(422);
    }
    expect((await sup('post', '/permissions').send({ name: '' })).status).toBe(422);
  });

  it('makes a role that holds a deleted permission lose it at once', async () => {
    const name = `tmp.${uniq('lose')}`;
    const perm = (await sup('post', '/permissions').send({ name })).body;
    const a = await createRole(uniq('A '), [name, 'users.view']);
    const b = await createRole(uniq('B '), [name]);
    expect(
      platformPermissionListResponseSchema
        .parse((await sup('get', '/permissions')).body)
        .data.find((p) => p.name === name)?.roleCount,
    ).toBe(2);
    expect((await sup('delete', `/permissions/${perm.id}`)).status).toBe(200);
    expect(
      platformRoleDetailSchema.parse((await sup('get', `/roles/${a.id}`)).body).permissions,
    ).toEqual(['users.view']);
    expect(
      platformRoleDetailSchema.parse((await sup('get', `/roles/${b.id}`)).body).permissions,
    ).toEqual([]);
    expect((await sup('delete', `/permissions/${perm.id}`)).status).toBe(404);
  });

  it('deletes a permission that the locked Super Admin role also holds', async () => {
    const name = `tmp.${uniq('super')}`;
    const perm = (await sup('post', '/permissions').send({ name })).body;
    const superRole = platformRoleDetailSchema.parse(
      (await sup('get', `/roles/${(await roleByName('Super Admin')).id}`)).body,
    );
    const added = await sup('put', `/roles/${superRole.id}`).send({
      name: 'Super Admin',
      permissions: [...superRole.permissions, name],
      rowVersion: superRole.rowVersion,
    });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect((await sup('delete', `/permissions/${perm.id}`)).status).toBe(200);
    expect(
      platformRoleDetailSchema.parse((await sup('get', `/roles/${superRole.id}`)).body)
        .permissionCount,
    ).toBe(107);
  });

  it('lets an operator who only manages roles read the catalogue for the role editor', async () => {
    const role = await createRole(uniq('Roles only '), ['platform.role.manage']);
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const aud = staff.data.find((s) => s.email === 'auditor@platform.test')!;
    const base = aud.roles.map((r) => r.id);
    await sup('put', `/staff/${aud.id}/roles`).send({ roleIds: [role.id] });
    expect((await call(auditorToken, 'get', '/permissions')).status).toBe(200);
    expect((await call(auditorToken, 'post', '/permissions').send({ name: 'x.y' })).status).toBe(
      403,
    );
    await sup('put', `/staff/${aud.id}/roles`).send({ roleIds: base });
  });

  it('refuses to delete a key the code checks (WaDesk let it fail closed for everybody)', async () => {
    const list = platformPermissionListResponseSchema.parse(
      (await sup('get', '/permissions')).body,
    );
    const system = list.data.find((p) => p.name === 'platform.workspace.impersonate')!;
    const res = await sup('delete', `/permissions/${system.id}`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RBAC_PERMISSION_SYSTEM');
    expect(
      platformPermissionListResponseSchema
        .parse((await sup('get', '/permissions')).body)
        .data.some((p) => p.name === system.name),
    ).toBe(true);
  });
});

describe('staff role assignment (WD-RBAC-021) and the Super Admin tier (WD-RBAC-018)', () => {
  it('sets exactly the chosen roles and audits the change', async () => {
    const role = await createRole(uniq('Extra '));
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const aud = staff.data.find((s) => s.email === 'auditor@platform.test')!;
    const res = await sup('put', `/staff/${aud.id}/roles`).send({ roleIds: [role.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.roles.map((r: { name: string }) => r.name)).toEqual([role.name]);
    expect(
      (await auditEvents('admin.staff.roles_changed')).some(
        (e) => e.payload.operator === 'auditor@platform.test',
      ),
    ).toBe(true);
    await sup('put', `/staff/${aud.id}/roles`).send({ roleIds: aud.roles.map((r) => r.id) });
  });

  it('refuses unknown roles and unknown operators', async () => {
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const any = staff.data[0]!;
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await sup('put', `/staff/${any.id}/roles`).send({ roleIds: [missing] })).status).toBe(
      422,
    );
    expect((await sup('put', `/staff/${missing}/roles`).send({ roleIds: [] })).status).toBe(404);
  });

  it('only lets a Super Admin grant or revoke the Super Admin role', async () => {
    const admin = await roleByName('Admin');
    const superRole = await roleByName('Super Admin');
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const support = staff.data.find((s) => s.email === 'support@platform.test')!;
    const original = support.roles.map((r) => r.id);

    // The support operator becomes an Admin (all 107 keys, so role.manage) but is not a Super Admin.
    expect(
      (await sup('put', `/staff/${support.id}/roles`).send({ roleIds: [admin.id] })).status,
    ).toBe(200);
    const aud = staff.data.find((s) => s.email === 'auditor@platform.test')!;
    const denied = await call(supportToken, 'put', `/staff/${aud.id}/roles`).send({
      roleIds: [superRole.id],
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('RBAC_PRIVILEGED_ROLE');
    const deniedReassign = await call(
      supportToken,
      'post',
      `/roles/${(await createRole(uniq('Src '))).id}/reassign`,
    ).send({ targetRoleId: superRole.id });
    expect(deniedReassign.status).toBe(403);

    expect(
      (await sup('put', `/staff/${support.id}/roles`).send({ roleIds: original })).status,
    ).toBe(200);
  });

  it('keeps at least one active Super Admin', async () => {
    const staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    const me = staff.data.find((s) => s.email === OPERATOR_EMAIL)!;
    const res = await sup('put', `/staff/${me.id}/roles`).send({ roleIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RBAC_LAST_SUPER_ADMIN');
  });

  it('swaps the tier role when an operator changes tier, and gives a new operator the role of its tier', async () => {
    await h.owner.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ('new@platform.test', 'New', 'x', 'auditor')`,
    );
    let staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    expect(
      staff.data.find((s) => s.email === 'new@platform.test')!.roles.map((r) => r.name),
    ).toEqual(['Auditor']);
    await h.owner.query(
      `UPDATE platform_operators SET role = 'support' WHERE email = 'new@platform.test'`,
    );
    staff = platformStaffListResponseSchema.parse((await sup('get', '/staff')).body);
    expect(
      staff.data.find((s) => s.email === 'new@platform.test')!.roles.map((r) => r.name),
    ).toEqual(['Platform Support']);
  });
});
