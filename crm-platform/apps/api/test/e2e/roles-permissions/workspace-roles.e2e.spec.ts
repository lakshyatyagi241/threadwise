import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../auth-registration-security/harness';

/**
 * The five workspace roles end to end through HTTP (TW-RBAC-004, 024, 026, 027, 037): the preset matrix, who may hand out which role,
 * the Owner that every organization keeps, and the keys that reach the top presets by themselves.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const PASSWORD = 'Str0ngPassw0rd#1';
let ipCounter = 40;
const nextIp = () => `10.7.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let counter = 0;

interface Org {
  orgId: number;
  owner: string;
  ownerUserId: number;
  roles: Record<string, string>;
}
interface Member {
  token: string;
  uuid: string;
  userId: number;
}

async function signupOrg(): Promise<Org> {
  const email = `rbac${Date.now()}${counter++}@example.test`;
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `Rbac Org ${counter}`,
      fullName: 'Owner Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = res.body.tokens.accessToken as string;
  const row = await h.owner.query(`SELECT id, org_id FROM users WHERE email = $1`, [email]);
  const list = await api().get('/v2/roles').set(bearer(token));
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  const roles = Object.fromEntries(
    (list.body.data as Array<{ id: string; name: string }>).map((r) => [r.name, r.id]),
  );
  return {
    orgId: Number(row.rows[0].org_id),
    owner: token,
    ownerUserId: Number(row.rows[0].id),
    roles,
  };
}

async function addMember(org: Org, roleName: string, by = org.owner): Promise<Member> {
  const email = `m${Date.now()}${counter++}@example.test`;
  const res = await api()
    .post('/v2/users')
    .set(bearer(by))
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      email,
      fullName: `${roleName} Member`,
      password: PASSWORD,
      roleIds: [org.roles[roleName]],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const login = await api()
    .post('/v2/auth/login')
    .set('x-forwarded-for', nextIp())
    .send({ email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(201);
  const row = await h.owner.query(`SELECT id FROM users WHERE email = $1`, [email]);
  return {
    token: login.body.tokens.accessToken as string,
    uuid: res.body.id as string,
    userId: Number(row.rows[0].id),
  };
}

const setRoles = (token: string, userUuid: string, roleIds: string[]) =>
  api().patch(`/v2/users/${userUuid}`).set(bearer(token)).send({ roleIds, rowVersion: 1 });

const grantsOf = async (orgId: number, roleName: string) =>
  new Map(
    (
      await h.owner.query(
        `SELECT g.permission_key, g.record_scope::text AS scope FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
         WHERE g.org_id = $1 AND r.name = $2 AND g.effect = 'allow'`,
        [orgId, roleName],
      )
    ).rows.map((r: { permission_key: string; scope: string }) => [r.permission_key, r.scope]),
  );

beforeAll(async () => {
  h = await startHarness();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('presets (TW-RBAC-004, 024)', () => {
  it('gives every new organization the five Reference roles, the Owner locked', async () => {
    const org = await signupOrg();
    const rows = (
      await h.owner.query(
        `SELECT name, system_key, is_locked FROM roles WHERE org_id = $1 AND system_key IS NOT NULL ORDER BY id`,
        [org.orgId],
      )
    ).rows;
    expect(rows.map((r) => [r.name, r.system_key, r.is_locked])).toEqual([
      ['Owner', 'admin', true],
      ['Admin', 'workspace_admin', false],
      ['Manager', 'manager', false],
      ['Agent', 'agent', false],
      ['Viewer', 'viewer', false],
    ]);
    const session = await api().get('/v2/auth/session').set(bearer(org.owner));
    expect(session.body.roles.map((r: { name: string }) => r.name)).toEqual(['Owner']);
  });

  it('Owner holds every key; Admin every key but billing, plan purchase and the owner-only settings', async () => {
    const org = await signupOrg();
    const all = (await h.owner.query(`SELECT key FROM permission_defs`)).rows.map(
      (r: { key: string }) => r.key,
    );
    const owner = await grantsOf(org.orgId, 'Owner');
    expect([...owner.keys()].sort()).toEqual([...all].sort());
    const admin = await grantsOf(org.orgId, 'Admin');
    const missing = all.filter((k: string) => !admin.has(k)).sort();
    expect(missing.length).toBeGreaterThan(0);
    expect(
      missing.every(
        (k: string) =>
          /^(billing\.|paygw\.)/.test(k) || ['org.delete', 'org.owner_settings.manage'].includes(k),
      ),
    ).toBe(true);
    expect(admin.has('org.member.role_assign')).toBe(true);
    expect(admin.has('billing.manage')).toBe(false);
  });

  it('Manager: assigns, bulks, prioritises, manages labels and saved replies; not teams, routing, SLA, members or integrations', async () => {
    const org = await signupOrg();
    const m = await grantsOf(org.orgId, 'Manager');
    for (const k of [
      'inbox.conversation.assign',
      'inbox.conversation.assign_self',
      'inbox.conversation.bulk',
      'inbox.conversation.priority',
      'inbox.tag.manage',
      'inbox.savedreply.manage',
      'dash.analytics.read',
    ]) {
      expect(m.get(k), k).toBe('all');
    }
    for (const k of [
      'inbox.team.manage',
      'inbox.routing.manage',
      'inbox.sla.manage',
      'inbox.integration.manage',
      'org.member.invite',
      'org.member.role_assign',
      'admin.settings.manage',
    ]) {
      expect(m.has(k), k).toBe(false);
    }
  });

  it('Agent claims but does not assign, reads the whole shared queue, cannot bulk or prioritise', async () => {
    const org = await signupOrg();
    const a = await grantsOf(org.orgId, 'Agent');
    expect(a.get('inbox.conversation.assign_self')).toBe('all');
    expect(a.get('inbox.conversation.read')).toBe('all');
    for (const k of [
      'inbox.conversation.reply',
      'inbox.conversation.note',
      'inbox.conversation.resolve',
      'inbox.conversation.snooze',
      'inbox.conversation.tag',
    ]) {
      expect(a.has(k), k).toBe(true);
    }
    for (const k of [
      'inbox.conversation.assign',
      'inbox.conversation.bulk',
      'inbox.conversation.priority',
      'inbox.tag.manage',
    ]) {
      expect(a.has(k), k).toBe(false);
    }
    // the front-line grants the product shipped with are still there, at their own scope
    expect(a.get('record.contacts.read')).toBe('own');
  });

  it('Viewer reads the conversations of its own teams, plus the keys every member holds', async () => {
    const org = await signupOrg();
    const v = await grantsOf(org.orgId, 'Viewer');
    expect([...v.entries()].sort()).toEqual([
      ['aiadm.models.read', 'all'],
      ['inbox.conversation.read', 'team'],
      ['support.ticket.create', 'all'],
      ['support.ticket.read', 'all'],
    ]);
  });

  it('keeps the presets: no delete, no rename, in the API and in the database', async () => {
    const org = await signupOrg();
    expect(
      (await api().delete(`/v2/roles/${org.roles.Manager}`).set(bearer(org.owner))).body.code,
    ).toBe('RBAC_PRESET_ROLE');
    const manager = await api().get(`/v2/roles/${org.roles.Manager}`).set(bearer(org.owner));
    const rename = await api()
      .patch(`/v2/roles/${org.roles.Manager}`)
      .set(bearer(org.owner))
      .send({ name: 'Lead', rowVersion: manager.body.rowVersion });
    expect(rename.body.code).toBe('RBAC_PRESET_ROLE');
    await expect(
      h.owner.query(`DELETE FROM roles WHERE org_id = $1 AND system_key = 'viewer'`, [org.orgId]),
    ).rejects.toThrow(/preset/);
    // the Owner preset is locked outright
    const owner = await api()
      .patch(`/v2/roles/${org.roles.Owner}`)
      .set(bearer(org.owner))
      .send({ grants: [], rowVersion: 1 });
    expect(owner.status).toBe(422);
  });

  it('lets a preset below Admin be tuned, within what the editor holds themselves', async () => {
    const org = await signupOrg();
    const admin = await addMember(org, 'Admin');
    const viewer = await api().get(`/v2/roles/${org.roles.Viewer}`).set(bearer(admin.token));
    const ok = await api()
      .patch(`/v2/roles/${org.roles.Viewer}`)
      .set(bearer(admin.token))
      .send({
        grants: [
          { permissionKey: 'inbox.conversation.read', effect: 'allow', recordScope: 'team' },
          { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'own' },
        ],
        rowVersion: viewer.body.rowVersion,
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const bad = await api()
      .patch(`/v2/roles/${org.roles.Viewer}`)
      .set(bearer(admin.token))
      .send({
        grants: [{ permissionKey: 'billing.manage', effect: 'allow', recordScope: 'all' }],
        rowVersion: ok.body.rowVersion,
      });
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    // an Admin cannot edit the Admin preset itself (it would be a way to grant yourself the owner-only keys)
    const adminRole = await api().get(`/v2/roles/${org.roles.Admin}`).set(bearer(org.owner));
    const edit = await api()
      .patch(`/v2/roles/${org.roles.Admin}`)
      .set(bearer(admin.token))
      .send({ grants: [], rowVersion: adminRole.body.rowVersion });
    expect(edit.status).toBe(403);
  });
});

describe('who may hand out which role (TW-RBAC-026, 027)', () => {
  it('Admin grants Manager, Agent and Viewer; granting Admin or Owner needs an Owner', async () => {
    const org = await signupOrg();
    const admin = await addMember(org, 'Admin');
    const target = await addMember(org, 'Agent');
    expect((await setRoles(admin.token, target.uuid, [org.roles.Manager])).status).toBe(200);
    for (const role of ['Admin', 'Owner']) {
      const res = await setRoles(admin.token, target.uuid, [org.roles[role]!]);
      expect(res.status, role).toBe(403);
      expect(res.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
      expect(res.body.detail ?? JSON.stringify(res.body)).toContain(`grant the ${role} role`);
    }
    // an Owner can
    expect((await setRoles(org.owner, target.uuid, [org.roles.Admin])).status).toBe(200);
    expect((await setRoles(org.owner, target.uuid, [org.roles.Owner])).status).toBe(200);
  });

  it('refuses to let an Admin demote an Owner or another Admin (Reference allowed it)', async () => {
    const org = await signupOrg();
    const admin = await addMember(org, 'Admin');
    const otherAdmin = await addMember(org, 'Admin');
    const ownerUuid = (await api().get('/v2/users/me').set(bearer(org.owner))).body.id as string;
    const owner = await setRoles(admin.token, ownerUuid, [org.roles.Agent]);
    expect(owner.status).toBe(403);
    expect(owner.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect((await setRoles(admin.token, otherAdmin.uuid, [org.roles.Viewer])).status).toBe(403);
    const unchanged = await h.owner.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id WHERE ur.org_id = $1 AND ur.user_id = $2`,
      [org.orgId, org.ownerUserId],
    );
    expect(unchanged.rows.map((r) => r.name)).toEqual(['Owner']);
  });

  it('blocks a change of your own role', async () => {
    const org = await signupOrg();
    const admin = await addMember(org, 'Admin');
    const res = await setRoles(admin.token, admin.uuid, [org.roles.Manager]);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RBAC_SELF_ROLE_CHANGE');
  });

  it('refuses members who lack org.member.role_assign or org.member.invite', async () => {
    const org = await signupOrg();
    const manager = await addMember(org, 'Manager');
    const target = await addMember(org, 'Agent');
    expect((await setRoles(manager.token, target.uuid, [org.roles.Viewer])).status).toBe(403);
    const create = await api()
      .post('/v2/users')
      .set(bearer(manager.token))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        email: `x${Date.now()}@example.test`,
        fullName: 'X',
        password: PASSWORD,
        roleIds: [org.roles.Viewer],
      });
    expect(create.status).toBe(403);
  });

  it('keeps at least one Owner, in the API and in the database', async () => {
    const org = await signupOrg();
    const ownerUuid = (await api().get('/v2/users/me').set(bearer(org.owner))).body.id as string;
    const second = await addMember(org, 'Admin');
    // the only Owner cannot be moved off the role (by another Owner, there is none: use the database to prove the invariant)
    expect((await setRoles(org.owner, second.uuid, [org.roles.Owner])).status).toBe(200);
    const demote = await setRoles(second.token, ownerUuid, [org.roles.Agent]);
    expect(demote.status, JSON.stringify(demote.body)).toBe(200); // two Owners: allowed
    const last = await setRoles(second.token, second.uuid, [org.roles.Agent]);
    expect(last.body.code).toBe('RBAC_SELF_ROLE_CHANGE');
    await expect(
      h.owner.query(`DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2`, [
        org.orgId,
        second.userId,
      ]),
    ).rejects.toThrow(/at least one Owner/);
  });

  it('records the previous roles beside the new ones', async () => {
    const org = await signupOrg();
    const target = await addMember(org, 'Agent');
    await setRoles(org.owner, target.uuid, [org.roles.Manager]);
    const row = (
      await h.owner.query(
        `SELECT delta FROM audit_log WHERE org_id = $1 AND record_id = $2 AND delta ? 'roles' ORDER BY id DESC LIMIT 1`,
        [org.orgId, target.userId],
      )
    ).rows[0];
    expect(row.delta.roles).toEqual({ old: ['Agent'], new: ['Manager'] });
  });

  it('hands a custom role only to someone who holds everything in it', async () => {
    const org = await signupOrg();
    const admin = await addMember(org, 'Admin');
    const target = await addMember(org, 'Agent');
    const billing = await api()
      .post('/v2/roles')
      .set(bearer(org.owner))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        name: 'Billing clerk',
        grants: [{ permissionKey: 'billing.manage', effect: 'allow', recordScope: 'all' }],
      });
    expect(billing.status, JSON.stringify(billing.body)).toBe(201);
    const denied = await setRoles(admin.token, target.uuid, [billing.body.id]);
    expect(denied.status).toBe(403);
    const mine = await api()
      .post('/v2/roles')
      .set(bearer(admin.token))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        name: 'Too much',
        grants: [{ permissionKey: 'billing.manage', effect: 'allow', recordScope: 'all' }],
      });
    expect(mine.status).toBe(403);
    expect((await setRoles(org.owner, target.uuid, [billing.body.id])).status).toBe(200);
  });
});

describe('new keys reach the top presets (TW-RBAC-037, decision D4)', () => {
  it('grants a new key to Owner and Admin in every organization; an owner-only key to Owner alone', async () => {
    const a = await signupOrg();
    const b = await signupOrg();
    const key = `zz.auto${counter++}.read`;
    const ownerOnly = `billing.auto${counter++}`;
    await h.owner.query(`SELECT set_config('app.privileged', 'on', false)`);
    await h.owner.query(
      `INSERT INTO permission_defs (key, label, category, supports_scope) VALUES ($1, 'x', 'test', false), ($2, 'y', 'billing', false)`,
      [key, ownerOnly],
    );
    for (const org of [a, b]) {
      expect((await grantsOf(org.orgId, 'Owner')).has(key)).toBe(true);
      expect((await grantsOf(org.orgId, 'Admin')).has(key)).toBe(true);
      expect((await grantsOf(org.orgId, 'Manager')).has(key)).toBe(false);
      expect((await grantsOf(org.orgId, 'Owner')).has(ownerOnly)).toBe(true);
      expect((await grantsOf(org.orgId, 'Admin')).has(ownerOnly)).toBe(false);
    }
    // and the Owner stays locked against the application
    await expect(
      h.owner.query(
        `UPDATE role_grants SET record_scope = 'own' WHERE org_id = $1 AND permission_key = $2`,
        [a.orgId, key],
      ),
    ).rejects.toThrow(/locked/);
  });
});

describe('landing and the permission map (TW-RBAC-033, 035)', () => {
  it('sends Owner, Admin and Manager to the dashboard and Agent and Viewer to the inbox', async () => {
    const org = await signupOrg();
    const landing = async (token: string) =>
      (await api().get('/v2/auth/session').set(bearer(token))).body.landing;
    expect(await landing(org.owner)).not.toBe('inbox');
    const want: Record<string, string> = {
      Admin: 'dashboard',
      Manager: 'dashboard',
      Agent: 'inbox',
      Viewer: 'inbox',
    };
    for (const [role, expected] of Object.entries(want)) {
      const m = await addMember(org, role);
      expect(await landing(m.token), role).toBe(expected);
    }
  });

  it('tells the client exactly which keys the caller holds, with their scopes', async () => {
    const org = await signupOrg();
    const agent = await addMember(org, 'Agent');
    const session = await api().get('/v2/auth/session').set(bearer(agent.token));
    const perms = session.body.permissions as Record<string, unknown>;
    expect(Object.keys(perms)).toContain('inbox.conversation.assign_self');
    expect(Object.keys(perms)).not.toContain('inbox.conversation.assign');
    expect(Object.keys(perms)).not.toContain('org.member.role_assign');
    const viewer = await addMember(org, 'Viewer');
    const vs = await api().get('/v2/auth/session').set(bearer(viewer.token));
    expect(Object.keys(vs.body.permissions).sort()).toEqual([
      'aiadm.models.read',
      'inbox.conversation.read',
      'support.ticket.create',
      'support.ticket.read',
    ]);
  });
});

describe('a workspace admin manages roles and members (screens: /settings/roles, /settings/team)', () => {
  const rolesOf = async (token: string) =>
    (await api().get('/v2/roles').set(bearer(token))).body.data as Array<{
      id: string;
      name: string;
      userCount: number;
      isPreset: boolean;
      grantable: boolean;
      editable: boolean;
      isLocked: boolean;
    }>;

  it('tells each caller which roles they can hand out and which they can edit, and counts the members', async () => {
    const org = await signupOrg();
    const admin = await addMember(org, 'Admin');
    await addMember(org, 'Agent');
    const asOwner = Object.fromEntries((await rolesOf(org.owner)).map((r) => [r.name, r]));
    expect(asOwner.Owner).toMatchObject({
      userCount: 1,
      isPreset: true,
      isLocked: true,
      grantable: true,
      editable: false,
    });
    expect(asOwner.Agent).toMatchObject({
      userCount: 1,
      isPreset: true,
      grantable: true,
      editable: true,
    });
    const asAdmin = Object.fromEntries((await rolesOf(admin.token)).map((r) => [r.name, r]));
    expect(asAdmin.Owner!.grantable).toBe(false);
    expect(asAdmin.Admin).toMatchObject({ grantable: false, editable: false });
    expect(asAdmin.Manager).toMatchObject({ grantable: true, editable: true });
  });

  it('creates, edits and deletes a custom role; one with members cannot be deleted until they are moved', async () => {
    const org = await signupOrg();
    const created = await api()
      .post('/v2/roles')
      .set(bearer(org.owner))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        name: 'Sales lead',
        grants: [
          { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'team' },
          { permissionKey: 'record.contacts.delete', effect: 'deny', recordScope: 'all' },
        ],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      isPreset: false,
      userCount: 0,
      editable: true,
      grantable: true,
    });
    const edited = await api()
      .patch(`/v2/roles/${created.body.id}`)
      .set(bearer(org.owner))
      .send({
        grants: [{ permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' }],
        rowVersion: created.body.rowVersion,
      });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.grants).toHaveLength(1);

    const member = await addMember(org, 'Agent');
    expect((await setRoles(org.owner, member.uuid, [created.body.id])).status).toBe(200);
    const blocked = await api().delete(`/v2/roles/${created.body.id}`).set(bearer(org.owner));
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('RBAC_ROLE_IN_USE');
    expect((await setRoles(org.owner, member.uuid, [org.roles.Agent!])).status).toBe(200);
    expect((await api().delete(`/v2/roles/${created.body.id}`).set(bearer(org.owner))).status).toBe(
      204,
    );
  });

  it('takes effect on the member at once: removing a permission from their role closes the door', async () => {
    const org = await signupOrg();
    const role = await api()
      .post('/v2/roles')
      .set(bearer(org.owner))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        name: 'Reader',
        grants: [{ permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' }],
      });
    const member = await addMember(org, 'Viewer');
    await setRoles(org.owner, member.uuid, [role.body.id]);
    expect((await api().get('/v2/contacts').set(bearer(member.token))).status).toBe(200);
    await api()
      .patch(`/v2/roles/${role.body.id}`)
      .set(bearer(org.owner))
      .send({ grants: [], rowVersion: role.body.rowVersion });
    expect((await api().get('/v2/contacts').set(bearer(member.token))).status).toBe(403);
  });

  it('deactivates and reactivates members, but not yourself, not a superior, not the last Owner', async () => {
    const org = await signupOrg();
    const admin = await addMember(org, 'Admin');
    const agent = await addMember(org, 'Agent');
    const ownerUuid = (await api().get('/v2/users/me').set(bearer(org.owner))).body.id as string;
    const patch = (token: string, uuid: string, status: string) =>
      api().patch(`/v2/users/${uuid}`).set(bearer(token)).send({ status, rowVersion: 1 });

    expect((await patch(admin.token, agent.uuid, 'inactive')).status).toBe(200);
    const row = (await api().get(`/v2/users/${agent.uuid}`).set(bearer(org.owner))).body;
    expect(row.status).toBe('inactive');
    const back = await api()
      .patch(`/v2/users/${agent.uuid}`)
      .set(bearer(org.owner))
      .send({ status: 'active', rowVersion: row.rowVersion });
    expect(back.status, JSON.stringify(back.body)).toBe(200);

    const self = await patch(admin.token, admin.uuid, 'inactive');
    expect(self.body.code).toBe('RBAC_SELF_DEACTIVATE');
    const superior = await patch(admin.token, ownerUuid, 'inactive');
    expect(superior.status).toBe(403);
    expect(superior.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    const soleOwner = await patch(org.owner, ownerUuid, 'inactive');
    expect(soleOwner.body.code).toBe('RBAC_SELF_DEACTIVATE');
  });

  it('switches filing support tickets and the AI model picker off per role', async () => {
    const org = await signupOrg();
    const viewer = await addMember(org, 'Viewer');
    const t1 = await api().get('/v2/support/tickets').set(bearer(viewer.token));
    expect(t1.status, JSON.stringify(t1.body)).toBe(200);
    const m1 = await api().get('/v2/ai/models').set(bearer(viewer.token));
    expect(m1.status, JSON.stringify(m1.body)).toBe(200);
    const roles = await rolesOf(org.owner);
    const v = roles.find((r) => r.name === 'Viewer')!;
    const full = await api().get(`/v2/roles/${v.id}`).set(bearer(org.owner));
    const stripped = await api()
      .patch(`/v2/roles/${v.id}`)
      .set(bearer(org.owner))
      .send({
        grants: full.body.grants.filter(
          (g: { permissionKey: string }) =>
            !/^(support\.ticket|aiadm\.models)/.test(g.permissionKey),
        ),
        rowVersion: full.body.rowVersion,
      });
    expect(stripped.status, JSON.stringify(stripped.body)).toBe(200);
    expect((await api().get('/v2/support/tickets').set(bearer(viewer.token))).status).toBe(403);
    expect((await api().get('/v2/ai/models').set(bearer(viewer.token))).status).toBe(403);
  });
});
