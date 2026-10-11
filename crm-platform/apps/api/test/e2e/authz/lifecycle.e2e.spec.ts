import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from '@node-rs/argon2';
import {
  Api,
  PASSWORD,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Roles, membership and session lifecycle (AUTHZ-016, 017, 022..030, 063, 089, 096).
 *
 * Everything goes through the real HTTP API against real Postgres (restricted role, RLS) and real Redis; the owner connection is used
 * only to arrange state and to inspect it. Every negative sits next to a positive (the same actor succeeding before the change, or a
 * sibling actor succeeding), so a suite that denies everything cannot pass.
 *
 * Findings that are real application defects keep a strict assertion and therefore fail; decisions the product made on purpose are
 * pinned with a test whose name carries POLICY-DECISION.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

// ---- helpers ---------------------------------------------------------------------------------------------------------------------

let ipCounter = 10;
const nextIp = () => `10.88.${Math.floor(ipCounter / 250) % 250}.${ipCounter++ % 250}`;
let seq = 0;
const http = () => request(h.app.getHttpServer());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
function call(
  token: string | null,
  method: Method,
  path: string,
  body?: object,
  headers: Record<string, string> = {},
) {
  let r = http()[method](path).set('x-forwarded-for', nextIp());
  if (token) r = r.set(bearer(token));
  if (method === 'post') r = r.set('Idempotency-Key', randomUUID());
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return body === undefined ? r : r.send(body);
}

type GrantSpec = [key: string, effect?: 'allow' | 'deny', scope?: 'all' | 'team' | 'own'];

interface Seeded {
  token: string;
  refresh: string;
  userId: number;
  uuid: string;
  email: string;
  roleIds: number[];
  roleUuids: string[];
}

const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function login(slug: string, email: string, password = PASSWORD) {
  return http()
    .post('/v2/auth/login')
    .set('x-forwarded-for', nextIp())
    .send({ orgSlug: slug, email, password });
}

async function presetRole(t: Tenant, name: string): Promise<{ id: number; uuid: string }> {
  const r = await h.owner.query(`SELECT id, uuid FROM roles WHERE org_id = $1 AND name = $2`, [
    t.orgId,
    name,
  ]);
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

/** A signed-in member. Each entry of `roles` is either a preset role name or a new custom role with exactly those grants. */
async function seed(t: Tenant, name: string, roles: Array<string | GrantSpec[]>): Promise<Seeded> {
  const email = `${slugName(name)}${Date.now()}${seq++}@example.test`;
  const roleIds: number[] = [];
  const roleUuids: string[] = [];
  for (const set of roles) {
    if (typeof set === 'string') {
      const r = await presetRole(t, set);
      roleIds.push(r.id);
      roleUuids.push(r.uuid);
      continue;
    }
    const role = await h.owner.query(
      `INSERT INTO roles (org_id, name) VALUES ($1, $2) RETURNING id, uuid`,
      [t.orgId, `${name}-${seq++}`],
    );
    for (const [key, effect, scope] of set) {
      await h.owner.query(
        `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,$3,$4,$5)`,
        [t.orgId, role.rows[0].id, key, effect ?? 'allow', scope ?? 'all'],
      );
    }
    roleIds.push(Number(role.rows[0].id));
    roleUuids.push(role.rows[0].uuid as string);
  }
  const user = await h.owner.query(
    `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, uuid`,
    [t.orgId, email, name, await hash(PASSWORD)],
  );
  const userId = Number(user.rows[0].id);
  for (const roleId of roleIds) {
    await h.owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      userId,
      roleId,
    ]);
  }
  await h.owner.query(
    `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at) VALUES ($1,$2,now(),now())`,
    [t.orgId, userId],
  );
  const res = await login(t.slug, email);
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return {
    token: res.body.tokens.accessToken as string,
    refresh: res.body.tokens.refreshToken as string,
    userId,
    uuid: user.rows[0].uuid as string,
    email,
    roleIds,
    roleUuids,
  };
}

const rolesVersion = async (orgId: number) =>
  Number(
    (await h.owner.query(`SELECT roles_version FROM organizations WHERE id = $1`, [orgId])).rows[0]
      .roles_version,
  );
const grantCacheKey = (orgId: number, version: number, userId: number) =>
  `rbac:${orgId}:v${version}:u${userId}`;
const userRv = async (uuid: string) =>
  Number(
    (await h.owner.query(`SELECT row_version FROM users WHERE uuid = $1`, [uuid])).rows[0]
      .row_version,
  );
const roleRv = async (uuid: string) =>
  Number(
    (await h.owner.query(`SELECT row_version FROM roles WHERE uuid = $1`, [uuid])).rows[0]
      .row_version,
  );
const rolesOfUser = async (orgId: number, userId: number): Promise<string[]> =>
  (
    await h.owner.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
        WHERE ur.org_id = $1 AND ur.user_id = $2 ORDER BY r.name`,
      [orgId, userId],
    )
  ).rows.map((r) => r.name as string);
const grantsOfRole = async (roleUuid: string) =>
  (
    await h.owner.query(
      `SELECT g.permission_key, g.effect::text AS effect, g.record_scope::text AS scope
         FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
        WHERE r.uuid = $1 ORDER BY g.permission_key`,
      [roleUuid],
    )
  ).rows.map((r) => `${r.permission_key}:${r.effect}:${r.scope}`);
const roleCount = async (orgId: number, name: string) =>
  Number(
    (
      await h.owner.query(`SELECT count(*)::int AS n FROM roles WHERE org_id = $1 AND name = $2`, [
        orgId,
        name,
      ])
    ).rows[0].n,
  );
const activeOwners = async (orgId: number) =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM user_roles ur
           JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id AND r.system_key = 'admin'
           JOIN users u ON u.org_id = ur.org_id AND u.id = ur.user_id AND u.status = 'active'
          WHERE ur.org_id = $1`,
        [orgId],
      )
    ).rows[0].n,
  );

const readContacts = (token: string) => call(token, 'get', '/v2/contacts');
const readTickets = (token: string) => call(token, 'get', '/v2/support/tickets');
const readModels = (token: string) => call(token, 'get', '/v2/ai/models');
const session = (token: string) => call(token, 'get', '/v2/auth/session');
const denied = (status: number) => status === 401 || status === 403;
const emailOf = (name: string) => `${slugName(name)}@example.test`;

/**
 * A suspended or removed person may still sign in (WD-AUTH-016: they land on the suspended screen), so what must hold is that the
 * session they obtain, by sign-in or by refresh, opens no workspace data.
 */
async function expectNoAccessFromSignIn(slug: string, email: string) {
  const res = await login(slug, email);
  if (res.status < 300) {
    const next = await readContacts(res.body.tokens.accessToken as string);
    expect(
      denied(next.status),
      `a fresh session must not open workspace data, got ${next.status}`,
    ).toBe(true);
  } else {
    expect(res.status).toBeLessThan(500);
  }
}
async function expectNoAccessFromRefresh(refreshToken: string) {
  const res = await http().post('/v2/auth/refresh').send({ refreshToken });
  if (res.status < 300) {
    const next = await readContacts(
      (res.body.tokens?.accessToken ?? res.body.accessToken) as string,
    );
    expect(
      denied(next.status),
      `a refreshed session must not open workspace data, got ${next.status}`,
    ).toBe(true);
  } else {
    expect(res.status).toBeLessThan(500);
  }
}
const tokenOf = (res: { body: { tokens: { accessToken: string; refreshToken: string } } }) => ({
  access: res.body.tokens.accessToken,
  refresh: res.body.tokens.refreshToken,
});

async function editGrants(actor: string, roleUuid: string, grants: object[]) {
  return call(actor, 'patch', `/v2/roles/${roleUuid}`, {
    grants,
    rowVersion: await roleRv(roleUuid),
  });
}
const patchUser = async (actor: string, uuid: string, body: object) =>
  call(actor, 'patch', `/v2/users/${uuid}`, { rowVersion: await userRv(uuid), ...body });
const memberRole = async (actor: string, uuid: string, roleUuid: string) =>
  call(actor, 'patch', `/v2/workspace/members/${uuid}/role`, {
    roleId: roleUuid,
    rowVersion: await userRv(uuid),
  });
const mailTo = (email: string) => {
  const m = [...h.mail].reverse().find((x) => x.to === email);
  return { mail: m, token: m?.text.match(/token=([^&\s]+)/)?.[1] ?? '' };
};

const ROLE_KEYS: GrantSpec[] = [
  ['admin.role.manage'],
  ['admin.user.manage'],
  ['org.member.role_assign'],
  ['org.member.invite'],
  ['record.contacts.read'],
  ['support.ticket.read'],
];

// ---- 1. revocation is immediate --------------------------------------------------------------------------------------------------

describe('revocation takes effect on the next request with the same still-valid access token', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await api.signup('lc-rev');
  });
  const reader = (name: string, extra: GrantSpec[] = []) =>
    seed(T, name, [[['record.contacts.read'], ...extra]]);

  it('AUTHZ-026 removing the grant from the role takes effect on the next request, with the grant cache warm', async () => {
    const m = await reader('revgrant', [['support.ticket.read']]);
    expect((await readContacts(m.token)).status).toBe(200);
    expect((await readTickets(m.token)).status).toBe(200);
    const before = await rolesVersion(T.orgId);
    const warmKey = grantCacheKey(T.orgId, before, m.userId);
    expect(
      await h.redis.get(warmKey),
      'the grant set must be cached before the change',
    ).not.toBeNull();

    const edit = await editGrants(T.admin, m.roleUuids[0]!, [
      { permissionKey: 'support.ticket.read', effect: 'allow', recordScope: 'all' },
    ]);
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);

    expect((await readContacts(m.token)).status).toBe(403);
    // the key the change did not touch still works: the member is not simply locked out
    expect((await readTickets(m.token)).status).toBe(200);
    // and the stale set was not what answered: the new version has its own cache entry, without the removed grant
    const after = await rolesVersion(T.orgId);
    const fresh = await h.redis.get(grantCacheKey(T.orgId, after, m.userId));
    expect(fresh).not.toBeNull();
    expect(JSON.parse(fresh!)['record.contacts.read']).toBeUndefined();
  });

  it('AUTHZ-089 every role change moves roles_version, so a cached grant set cannot outlive it', async () => {
    const m = await reader('revver');
    expect((await readContacts(m.token)).status).toBe(200);
    const v0 = await rolesVersion(T.orgId);
    const staleKey = grantCacheKey(T.orgId, v0, m.userId);
    const staleBody = await h.redis.get(staleKey);
    expect(JSON.parse(staleBody!)['record.contacts.read']).toMatchObject({ effect: 'allow' });

    const steps: Array<[string, () => Promise<{ status: number }>]> = [
      [
        'grant edit',
        () =>
          editGrants(T.admin, m.roleUuids[0]!, [
            { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'own' },
          ]),
      ],
      ['role assignment (users)', () => patchUser(T.admin, m.uuid, { roleIds: [] })],
      [
        'role assignment (members)',
        async () => memberRole(T.admin, m.uuid, (await presetRole(T, 'Viewer')).uuid),
      ],
    ];
    let last = v0;
    for (const [what, step] of steps) {
      const res = await step();
      expect(res.status, what).toBe(200);
      const now = await rolesVersion(T.orgId);
      expect(now, `${what} must bump roles_version`).toBeGreaterThan(last);
      last = now;
      // a request is served from the new version's key, never the old one
      await readContacts(m.token);
      expect(await h.redis.get(grantCacheKey(T.orgId, now, m.userId)), what).not.toBeNull();
    }
    // deleting a role bumps it too
    const doomed = await seed(T, 'revdoomed', [[['record.contacts.read']]]);
    expect((await patchUser(T.admin, doomed.uuid, { roleIds: [] })).status).toBe(200);
    const beforeDelete = await rolesVersion(T.orgId);
    expect((await call(T.admin, 'delete', `/v2/roles/${doomed.roleUuids[0]}`)).status).toBe(204);
    expect(await rolesVersion(T.orgId)).toBeGreaterThan(beforeDelete);
  });

  it('AUTHZ-026 turning an allow into a deny closes the door on the next request', async () => {
    const m = await reader('revdeny');
    expect((await readContacts(m.token)).status).toBe(200);
    const edit = await editGrants(T.admin, m.roleUuids[0]!, [
      { permissionKey: 'record.contacts.read', effect: 'deny', recordScope: 'all' },
    ]);
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await readContacts(m.token)).status).toBe(403);
  });

  it('AUTHZ-026 unassigning the role (users API) takes effect on the next request', async () => {
    const m = await reader('revunassign');
    expect((await readContacts(m.token)).status).toBe(200);
    const res = await patchUser(T.admin, m.uuid, { roleIds: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await readContacts(m.token)).status).toBe(403);
  });

  it('AUTHZ-026 changing the role (members API) takes effect on the next request', async () => {
    const m = await reader('revswap');
    expect((await readContacts(m.token)).status).toBe(200);
    const viewer = await presetRole(T, 'Viewer');
    const res = await memberRole(T.admin, m.uuid, viewer.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await readContacts(m.token)).status).toBe(403);
    // Viewer keeps what the Viewer preset has: the member is demoted, not locked out
    expect((await readTickets(m.token)).status).toBe(200);
  });

  it('AUTHZ-026 a role still held cannot be deleted; once unassigned and deleted the access stays gone', async () => {
    const m = await reader('revdelete');
    expect((await readContacts(m.token)).status).toBe(200);
    const inUse = await call(T.admin, 'delete', `/v2/roles/${m.roleUuids[0]}`);
    expect(inUse.status).toBe(422);
    expect(inUse.body.code).toBe('RBAC_ROLE_IN_USE');
    expect((await readContacts(m.token)).status, 'a refused delete changes nothing').toBe(200);
    expect((await patchUser(T.admin, m.uuid, { roleIds: [] })).status).toBe(200);
    expect((await call(T.admin, 'delete', `/v2/roles/${m.roleUuids[0]}`)).status).toBe(204);
    expect((await readContacts(m.token)).status).toBe(403);
    expect((await call(T.admin, 'get', `/v2/roles/${m.roleUuids[0]}`)).status).toBe(404);
  });

  it('AUTHZ-027 suspending a member stops the same access token on the next request', async () => {
    const m = await reader('revsuspend');
    expect((await readContacts(m.token)).status).toBe(200);
    expect((await session(m.token)).status).toBe(200);
    const res = await patchUser(T.admin, m.uuid, { status: 'inactive' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const next = await readContacts(m.token);
    const cachedGate = await h.redis.get(`auth:gate:${T.orgId}:${m.userId}`);
    expect
      .soft(denied(next.status), `status ${next.status}; cached account-gate state: ${cachedGate}`)
      .toBe(true);
    // a new sign-in or a refresh opens nothing either
    await expectNoAccessFromSignIn(T.slug, m.email);
    await expectNoAccessFromRefresh(m.refresh);
  });

  it('AUTHZ-027 removing a member from the workspace ends the access token, the refresh token and sign-in', async () => {
    const m = await reader('revremove');
    expect((await readContacts(m.token)).status).toBe(200);
    const res = await call(T.admin, 'delete', `/v2/workspace/members/${m.uuid}`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    const next = await readContacts(m.token);
    expect(denied(next.status), `status ${next.status}`).toBe(true);
    expect(denied((await session(m.token)).status)).toBe(true);
    const refresh = await http().post('/v2/auth/refresh').send({ refreshToken: m.refresh });
    expect(refresh.status).toBeGreaterThanOrEqual(400);
    await expectNoAccessFromSignIn(T.slug, m.email);
    // the same actor is still able to manage others: removal is about that member only
    const other = await reader('revremove-other');
    expect((await readContacts(other.token)).status).toBe(200);
  });

  it('AUTHZ-027 a user who deletes their own account is out on the next request', async () => {
    const m = await reader('revself');
    expect((await readContacts(m.token)).status).toBe(200);
    const res = await call(m.token, 'delete', '/v2/account', {
      confirmation: 'DELETE my account',
      password: PASSWORD,
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const next = await readContacts(m.token);
    expect(denied(next.status), `status ${next.status}`).toBe(true);
    expect(
      Number(
        (await h.owner.query(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [m.userId]))
          .rows[0].n,
      ),
    ).toBe(0);
    expect(
      (await http().post('/v2/auth/refresh').send({ refreshToken: m.refresh })).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await login(T.slug, m.email)).status).toBeGreaterThanOrEqual(400);
  });

  it('AUTHZ-027 reactivating a suspended member restores access (the suspension is the cause, not a side effect)', async () => {
    const m = await reader('revreactivate');
    expect((await patchUser(T.admin, m.uuid, { status: 'inactive' })).status).toBe(200);
    // the 30 second account-gate cache is dropped by hand here, so this test isolates reactivation from the suspension-latency defect
    await h.redis.del(`auth:gate:${T.orgId}:${m.userId}`);
    expect(denied((await readContacts(m.token)).status)).toBe(true);
    expect((await patchUser(T.admin, m.uuid, { status: 'active' })).status).toBe(200);
    const again = await login(T.slug, m.email);
    expect(again.status, JSON.stringify(again.body)).toBeLessThan(300);
    expect((await readContacts(again.body.tokens.accessToken as string)).status).toBe(200);
  });
});

// ---- 2. merge rules ---------------------------------------------------------------------------------------------------------------

describe('AUTHZ-028/029 deny beats allow, the widest allow wins, roles union', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await api.signup('lc-merge');
  });

  it('AUTHZ-028 a deny in any role beats an allow in another, whichever order the roles were granted in', async () => {
    const allowFirst = await seed(T, 'mergea', [
      [['record.contacts.read', 'allow', 'all']],
      [['record.contacts.read', 'deny', 'all']],
    ]);
    const denyFirst = await seed(T, 'mergeb', [
      [['record.contacts.read', 'deny', 'all']],
      [['record.contacts.read', 'allow', 'all']],
    ]);
    const sameRole = await seed(T, 'mergec', [
      [['record.contacts.read', 'allow', 'all'], ['support.ticket.read']],
    ]);
    for (const m of [allowFirst, denyFirst]) expect((await readContacts(m.token)).status).toBe(403);
    expect((await readContacts(sameRole.token)).status, 'control: the allow alone works').toBe(200);
    // a deny narrower in scope than the allow still denies
    const narrowDeny = await seed(T, 'merged', [
      [['record.contacts.read', 'allow', 'all']],
      [['record.contacts.read', 'deny', 'own']],
    ]);
    expect((await readContacts(narrowDeny.token)).status).toBe(403);
    // the deny takes only its own key: a third role keeps its other keys
    const withTickets = await seed(T, 'mergee', [
      [['record.contacts.read']],
      [['record.contacts.read', 'deny']],
      [['support.ticket.read']],
    ]);
    expect((await readContacts(withTickets.token)).status).toBe(403);
    expect((await readTickets(withTickets.token)).status).toBe(200);
    const perms = (await session(withTickets.token)).body.permissions as Record<string, string>;
    expect(Object.keys(perms)).toEqual(['support.ticket.read']);
  });

  it('AUTHZ-028 removing the denying role lifts the denial', async () => {
    const m = await seed(T, 'mergelift', [
      [['record.contacts.read']],
      [['record.contacts.read', 'deny']],
    ]);
    expect((await readContacts(m.token)).status).toBe(403);
    const res = await patchUser(T.admin, m.uuid, { roleIds: [m.roleUuids[0]!] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await readContacts(m.token)).status).toBe(200);
  });

  it('AUTHZ-029 the widest allow scope wins across roles', async () => {
    const own = await seed(T, 'scopea', [[['record.contacts.read', 'allow', 'own']]]);
    const ownTeam = await seed(T, 'scopeb', [
      [['record.contacts.read', 'allow', 'own']],
      [['record.contacts.read', 'allow', 'team']],
    ]);
    const all = await seed(T, 'scopec', [
      [['record.contacts.read', 'allow', 'team']],
      [['record.contacts.read', 'allow', 'all']],
      [['record.contacts.read', 'allow', 'own']],
    ]);
    const scopeOf = async (m: Seeded) =>
      ((await session(m.token)).body.permissions as Record<string, string>)['record.contacts.read'];
    expect(await scopeOf(own)).toBe('own');
    expect(await scopeOf(ownTeam)).toBe('team');
    expect(await scopeOf(all)).toBe('all');
  });

  it('AUTHZ-029 a member with two roles holds the union of their keys and nothing else', async () => {
    const m = await seed(T, 'union', [[['record.contacts.read']], [['support.ticket.read']]]);
    expect((await readContacts(m.token)).status).toBe(200);
    expect((await readTickets(m.token)).status).toBe(200);
    expect((await readModels(m.token)).status, 'a key neither role has').toBe(403);
    expect(Object.keys((await session(m.token)).body.permissions).sort()).toEqual([
      'record.contacts.read',
      'support.ticket.read',
    ]);
  });

  it('AUTHZ-029 a role carries exactly the grants it shows: nothing is inherited from outside them', async () => {
    const m = await seed(T, 'noinherit', [[['record.contacts.read', 'allow', 'team']]]);
    const shown = await call(T.admin, 'get', `/v2/roles/${m.roleUuids[0]}`);
    expect(shown.status).toBe(200);
    expect(shown.body.grants).toEqual([
      { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'team' },
    ]);
    const perms = (await session(m.token)).body.permissions as Record<string, string>;
    expect(perms).toEqual({ 'record.contacts.read': 'team' });
    // a sibling role created later with a wider grant does not leak into this one
    await seed(T, 'noinheritb', [
      [['record.contacts.read', 'allow', 'all'], ['admin.role.manage']],
    ]);
    expect((await session(m.token)).body.permissions).toEqual({ 'record.contacts.read': 'team' });
    expect((await call(m.token, 'get', '/v2/roles')).status).toBe(403);
  });
});

// ---- 3. privilege escalation ------------------------------------------------------------------------------------------------------

describe('AUTHZ-022/024 a role or member manager cannot escalate', () => {
  let P: Tenant;
  let Q: Tenant;
  let mgr: Seeded;
  let teamMgr: Seeded;
  let plain: Seeded;
  let adminM: Seeded;
  let agentM: Seeded;
  let ownerUuid: string;
  let ownerRole: { id: number; uuid: string };
  let adminRole: { id: number; uuid: string };
  let managerRole: { id: number; uuid: string };
  let agentRole: { id: number; uuid: string };

  beforeAll(async () => {
    P = await api.signup('lc-esc');
    Q = await api.signup('lc-esc-other');
    mgr = await seed(P, 'escmgr', [ROLE_KEYS]);
    teamMgr = await seed(P, 'escteam', [
      [...ROLE_KEYS, ['record.contacts.update', 'allow', 'team']],
    ]);
    plain = await seed(P, 'escplain', [[['record.contacts.read']]]);
    adminM = await seed(P, 'escadmin', ['Admin']);
    agentM = await seed(P, 'escagent', ['Agent']);
    ownerRole = await presetRole(P, 'Owner');
    adminRole = await presetRole(P, 'Admin');
    managerRole = await presetRole(P, 'Manager');
    agentRole = await presetRole(P, 'Agent');
    ownerUuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [P.adminUserId]))
      .rows[0].uuid;
  });

  const newRole = (actor: string, name: string, grants: GrantSpec[]) =>
    call(actor, 'post', '/v2/roles', {
      name,
      grants: grants.map(([permissionKey, effect, recordScope]) => ({
        permissionKey,
        effect: effect ?? 'allow',
        recordScope: recordScope ?? 'all',
      })),
    });

  it('AUTHZ-022 cannot create a role holding a permission the creator does not hold (and can create one within their own)', async () => {
    const over = await newRole(mgr.token, 'esc-over', [['billing.manage']]);
    expect(over.status, JSON.stringify(over.body)).toBe(403);
    expect(over.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect(await roleCount(P.orgId, 'esc-over')).toBe(0);
    const mixed = await newRole(mgr.token, 'esc-mixed', [
      ['record.contacts.read'],
      ['billing.manage'],
    ]);
    expect(mixed.status).toBe(403);
    expect(await roleCount(P.orgId, 'esc-mixed')).toBe(0);
    const ok = await newRole(mgr.token, 'esc-ok', [['record.contacts.read']]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await grantsOfRole(ok.body.id)).toEqual(['record.contacts.read:allow:all']);
  });

  it('AUTHZ-022 cannot create or widen a role beyond the record scope the creator holds', async () => {
    const wider = await newRole(teamMgr.token, 'esc-scope-all', [
      ['record.contacts.update', 'allow', 'all'],
    ]);
    expect(wider.status, JSON.stringify(wider.body)).toBe(403);
    expect(await roleCount(P.orgId, 'esc-scope-all')).toBe(0);
    expect(
      (
        await newRole(teamMgr.token, 'esc-scope-team', [
          ['record.contacts.update', 'allow', 'team'],
        ])
      ).status,
    ).toBe(201);
    expect(
      (await newRole(teamMgr.token, 'esc-scope-own', [['record.contacts.update', 'allow', 'own']]))
        .status,
    ).toBe(201);
    // widening an existing grant is refused too
    const target = await newRole(P.admin, 'esc-widen', [
      ['record.contacts.update', 'allow', 'own'],
    ]);
    expect(target.status).toBe(201);
    const widen = await editGrants(teamMgr.token, target.body.id, [
      { permissionKey: 'record.contacts.update', effect: 'allow', recordScope: 'all' },
    ]);
    expect(widen.status, JSON.stringify(widen.body)).toBe(403);
    expect(await grantsOfRole(target.body.id)).toEqual(['record.contacts.update:allow:own']);
    expect(
      (
        await editGrants(teamMgr.token, target.body.id, [
          { permissionKey: 'record.contacts.update', effect: 'allow', recordScope: 'team' },
        ])
      ).status,
    ).toBe(200);
  });

  it('AUTHZ-022 cannot add a permission they do not hold to an existing role (and can add one they hold)', async () => {
    const target = await newRole(P.admin, 'esc-edit', []);
    expect(target.status).toBe(201);
    const bad = await editGrants(mgr.token, target.body.id, [
      { permissionKey: 'billing.manage', effect: 'allow', recordScope: 'all' },
    ]);
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect(await grantsOfRole(target.body.id)).toEqual([]);
    const ok = await editGrants(mgr.token, target.body.id, [
      { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' },
    ]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await grantsOfRole(target.body.id)).toEqual(['record.contacts.read:allow:all']);
  });

  it('AUTHZ-022 the Owner and Admin presets cannot be edited by a role manager; a lower preset only within their own holdings', async () => {
    const ownerGrants = await grantsOfRole(ownerRole.uuid);
    const adminGrants = await grantsOfRole(adminRole.uuid);
    const owner = await editGrants(mgr.token, ownerRole.uuid, []);
    expect(owner.status, 'the Owner preset is locked').toBeGreaterThanOrEqual(400);
    expect((await editGrants(mgr.token, adminRole.uuid, [])).status).toBe(403);
    expect(
      (await editGrants(adminM.token, adminRole.uuid, [])).status,
      'an Admin cannot edit the Admin preset either',
    ).toBe(403);
    expect(await grantsOfRole(ownerRole.uuid)).toEqual(ownerGrants);
    expect(await grantsOfRole(adminRole.uuid)).toEqual(adminGrants);
    const managerBefore = await grantsOfRole(managerRole.uuid);
    const managerGrants = managerBefore.map((g) => {
      const [permissionKey, effect, recordScope] = g.split(':');
      return { permissionKey, effect, recordScope };
    });
    const escalate = await editGrants(mgr.token, managerRole.uuid, [
      ...managerGrants,
      { permissionKey: 'billing.manage', effect: 'allow', recordScope: 'all' },
    ]);
    expect(escalate.status).toBe(403);
    expect(await grantsOfRole(managerRole.uuid)).toEqual(managerBefore);
    // an Owner can tune the Manager preset (the positive for the same route)
    const ok = await editGrants(P.admin, managerRole.uuid, managerGrants);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('AUTHZ-022 cannot hand the Owner or Admin role to anyone, through either member API', async () => {
    const plainBefore = await rolesOfUser(P.orgId, plain.userId);
    for (const role of [ownerRole, adminRole]) {
      const viaUsers = await patchUser(mgr.token, plain.uuid, { roleIds: [role.uuid] });
      expect(viaUsers.status, JSON.stringify(viaUsers.body)).toBe(403);
      const viaMembers = await memberRole(mgr.token, plain.uuid, role.uuid);
      expect(viaMembers.status, JSON.stringify(viaMembers.body)).toBe(403);
      // an Admin may not hand them out either: owner-only
      expect((await patchUser(adminM.token, agentM.uuid, { roleIds: [role.uuid] })).status).toBe(
        403,
      );
      expect((await memberRole(adminM.token, agentM.uuid, role.uuid)).status).toBe(403);
    }
    expect(await rolesOfUser(P.orgId, plain.userId)).toEqual(plainBefore);
    expect(await rolesOfUser(P.orgId, agentM.userId)).toEqual(['Agent']);
    // positives: an Admin hands out Manager, an Owner hands out Admin
    expect((await memberRole(adminM.token, agentM.uuid, managerRole.uuid)).status).toBe(200);
    expect((await memberRole(P.admin, agentM.uuid, adminRole.uuid)).status).toBe(200);
    expect(await rolesOfUser(P.orgId, agentM.userId)).toEqual(['Admin']);
    expect((await memberRole(P.admin, agentM.uuid, agentRole.uuid)).status).toBe(200);
  });

  it('AUTHZ-022 a role manager can only hand out custom roles they fully hold, to people not above them', async () => {
    const target = await seed(P, 'esctarget', [[['support.ticket.read']]]);
    const holds = await newRole(P.admin, 'esc-holds', [['record.contacts.read']]);
    const exceeds = await newRole(P.admin, 'esc-exceeds', [
      ['record.contacts.read'],
      ['billing.manage'],
    ]);
    expect(holds.status).toBe(201);
    expect(exceeds.status).toBe(201);
    const bad = await patchUser(mgr.token, target.uuid, { roleIds: [exceeds.body.id] });
    expect(bad.status, JSON.stringify(bad.body)).toBe(403);
    expect(bad.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect((await memberRole(mgr.token, target.uuid, exceeds.body.id)).status).toBe(403);
    const ok = await patchUser(mgr.token, target.uuid, { roleIds: [holds.body.id] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // someone holding a preset outranks a custom-role manager: Agent cannot be moved by them
    const above = await patchUser(mgr.token, agentM.uuid, { roleIds: [holds.body.id] });
    expect(above.status).toBe(403);
    expect(await rolesOfUser(P.orgId, agentM.userId)).toEqual(['Agent']);
  });

  it('AUTHZ-024 nobody changes their own role, however privileged (Owner included)', async () => {
    const before = await rolesOfUser(P.orgId, mgr.userId);
    for (const attempt of [
      () => patchUser(mgr.token, mgr.uuid, { roleIds: [adminRole.uuid] }),
      () => memberRole(mgr.token, mgr.uuid, adminRole.uuid),
      () => patchUser(adminM.token, adminM.uuid, { roleIds: [ownerRole.uuid] }),
      () => memberRole(adminM.token, adminM.uuid, ownerRole.uuid),
    ]) {
      const res = await attempt();
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.code).toBe('RBAC_SELF_ROLE_CHANGE');
    }
    expect(await rolesOfUser(P.orgId, mgr.userId)).toEqual(before);
    expect(await rolesOfUser(P.orgId, adminM.userId)).toEqual(['Admin']);
    const ownSelf = await patchUser(P.admin, ownerUuid, { roleIds: [agentRole.uuid] });
    expect(ownSelf.status).toBe(422);
    expect(await rolesOfUser(P.orgId, P.adminUserId)).toEqual(['Owner']);
  });

  it("AUTHZ-024 the owner's role, status and account cannot be touched by an Admin or a role manager", async () => {
    for (const actor of [mgr, adminM]) {
      const demote = await patchUser(actor.token, ownerUuid, { roleIds: [agentRole.uuid] });
      expect(demote.status, JSON.stringify(demote.body)).toBe(403);
      expect((await memberRole(actor.token, ownerUuid, agentRole.uuid)).status).toBe(403);
      expect((await patchUser(actor.token, ownerUuid, { status: 'inactive' })).status).toBe(403);
      expect(
        (await call(actor.token, 'post', `/v2/workspace/members/${ownerUuid}/reset-password`))
          .status,
      ).toBe(403);
    }
    // removal is refused to everyone, the Owner included
    for (const token of [mgr.token, adminM.token, P.admin]) {
      const res = await call(token, 'delete', `/v2/workspace/members/${ownerUuid}`);
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect(await rolesOfUser(P.orgId, P.adminUserId)).toEqual(['Owner']);
    expect(await activeOwners(P.orgId)).toBe(1);
    expect((await session(P.admin)).status, 'the owner is untouched and active').toBe(200);
  });

  it('AUTHZ-024 the workspace keeps an Owner: the last one cannot be demoted, deactivated or removed', async () => {
    const R = await api.signup('lc-esc-last');
    const second = await seed(R, 'esclast2', ['Admin']);
    const ownerUuidR = (
      await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [R.adminUserId])
    ).rows[0].uuid as string;
    const ownerRoleR = await presetRole(R, 'Owner');
    const agentRoleR = await presetRole(R, 'Agent');
    // the sole Owner cannot step down or switch themselves off
    expect((await patchUser(R.admin, ownerUuidR, { roleIds: [agentRoleR.uuid] })).body.code).toBe(
      'RBAC_SELF_ROLE_CHANGE',
    );
    expect((await patchUser(R.admin, ownerUuidR, { status: 'inactive' })).body.code).toBe(
      'RBAC_SELF_DEACTIVATE',
    );
    expect((await patchUser(second.token, ownerUuidR, { roleIds: [agentRoleR.uuid] })).status).toBe(
      403,
    );
    expect(await activeOwners(R.orgId)).toBe(1);
    // with two Owners one may step aside; then the remaining one is the last
    expect((await memberRole(R.admin, second.uuid, ownerRoleR.uuid)).status).toBe(200);
    expect((await memberRole(second.token, ownerUuidR, agentRoleR.uuid)).status).toBe(200);
    expect(await activeOwners(R.orgId)).toBe(1);
    const stepDown = await memberRole(second.token, second.uuid, agentRoleR.uuid);
    expect(stepDown.status).toBe(422);
    expect(await activeOwners(R.orgId)).toBe(1);
    // the database enforces the same invariant for anything that bypasses the service rules
    await expect(
      h.owner.query(`DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2 AND role_id = $3`, [
        R.orgId,
        second.userId,
        ownerRoleR.id,
      ]),
    ).rejects.toThrow(/at least one Owner/);
  });

  it('AUTHZ-024 a role or user of another workspace cannot be read, edited, deleted or assigned by id', async () => {
    const qRole = await newRole(Q.admin, 'q-private-role', [['record.contacts.read']]);
    expect(qRole.status).toBe(201);
    const qMember = await seed(Q, 'qmember', [[['support.ticket.read']]]);
    const roleGrantsBefore = await grantsOfRole(qRole.body.id);
    const qUserRolesBefore = await rolesOfUser(Q.orgId, qMember.userId);
    const target = await seed(P, 'esccross', [[['support.ticket.read']]]);
    const targetBefore = await rolesOfUser(P.orgId, target.userId);

    for (const actor of [mgr.token, P.admin]) {
      expect((await call(actor, 'get', `/v2/roles/${qRole.body.id}`)).status).toBe(404);
      expect((await editGrants(actor, qRole.body.id, [])).status).toBe(404);
      expect((await call(actor, 'delete', `/v2/roles/${qRole.body.id}`)).status).toBe(404);
      expect((await call(actor, 'get', `/v2/users/${qMember.uuid}`)).status).toBe(404);
      expect(
        (
          await call(actor, 'patch', `/v2/users/${qMember.uuid}`, {
            status: 'inactive',
            rowVersion: 1,
          })
        ).status,
      ).toBe(404);
      expect((await memberRole(actor, qMember.uuid, qRole.body.id)).status).toBe(404);
      expect((await call(actor, 'delete', `/v2/workspace/members/${qMember.uuid}`)).status).toBe(
        404,
      );
      // assigning the other workspace's role to one of ours is refused, and does not wipe their roles
      const viaMembers = await memberRole(actor, target.uuid, qRole.body.id);
      expect(viaMembers.status, JSON.stringify(viaMembers.body)).toBeGreaterThanOrEqual(400);
      expect(await rolesOfUser(P.orgId, target.userId)).toEqual(targetBefore);
    }
    expect(await grantsOfRole(qRole.body.id)).toEqual(roleGrantsBefore);
    expect(await rolesOfUser(Q.orgId, qMember.userId)).toEqual(qUserRolesBefore);
    expect(
      (await readTickets(qMember.token)).status,
      'the other workspace member is untouched',
    ).toBe(200);
    // the owner of Q can of course manage their own role
    expect((await call(Q.admin, 'get', `/v2/roles/${qRole.body.id}`)).status).toBe(200);
  });

  it('AUTHZ-024 a role id of another workspace in roleIds is rejected, not silently dropped (which would strip the target of every role)', async () => {
    const qRole = await newRole(Q.admin, 'q-foreign-role', [['record.contacts.read']]);
    expect(qRole.status).toBe(201);
    const target = await seed(P, 'escforeign', [[['support.ticket.read']]]);
    const before = await rolesOfUser(P.orgId, target.userId);
    for (const bogus of [qRole.body.id, randomUUID()]) {
      const res = await patchUser(mgr.token, target.uuid, { roleIds: [bogus] });
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(
        await rolesOfUser(P.orgId, target.userId),
        'the target keeps the roles it had',
      ).toEqual(before);
    }
    expect((await readTickets(target.token)).status).toBe(200);
  });

  it('AUTHZ-022 a member without the management keys gets 403 on every role and member write, and nothing changes', async () => {
    const victim = await seed(P, 'escvictim', [[['support.ticket.read']]]);
    const role = await newRole(P.admin, 'esc-nokeys', []);
    const rv = await userRv(victim.uuid);
    const attempts: Array<[string, () => Promise<{ status: number }>]> = [
      ['list roles', () => call(plain.token, 'get', '/v2/roles')],
      ['read role', () => call(plain.token, 'get', `/v2/roles/${role.body.id}`)],
      ['create role', () => newRole(plain.token, 'esc-nokeys-new', [['record.contacts.read']])],
      ['edit role', () => editGrants(plain.token, role.body.id, [])],
      ['delete role', () => call(plain.token, 'delete', `/v2/roles/${role.body.id}`)],
      ['list users', () => call(plain.token, 'get', '/v2/users')],
      ['read user', () => call(plain.token, 'get', `/v2/users/${victim.uuid}`)],
      [
        'create user',
        () =>
          call(plain.token, 'post', '/v2/users', {
            email: `nokeys${Date.now()}@example.test`,
            fullName: 'N',
            password: PASSWORD,
            roleIds: [],
          }),
      ],
      ['edit user', () => patchUser(plain.token, victim.uuid, { status: 'inactive' })],
      ['assign roles', () => patchUser(plain.token, victim.uuid, { roleIds: [] })],
      ['member role', () => memberRole(plain.token, victim.uuid, agentRole.uuid)],
      [
        'invite',
        () =>
          call(plain.token, 'post', '/v2/workspace/members/invite', {
            fullName: 'X',
            email: `x${Date.now()}@example.test`,
            roleId: agentRole.uuid,
          }),
      ],
      ['remove member', () => call(plain.token, 'delete', `/v2/workspace/members/${victim.uuid}`)],
      [
        'reset password',
        () => call(plain.token, 'post', `/v2/workspace/members/${victim.uuid}/reset-password`),
      ],
    ];
    for (const [what, run] of attempts) expect((await run()).status, what).toBe(403);
    expect(await userRv(victim.uuid)).toBe(rv);
    expect(await roleCount(P.orgId, 'esc-nokeys-new')).toBe(0);
    expect(
      (await readContacts(plain.token)).status,
      'control: the same member still does what their role allows',
    ).toBe(200);
    expect(
      (await call(mgr.token, 'get', '/v2/roles')).status,
      'control: the manager passes the same gate',
    ).toBe(200);
  });

  it('AUTHZ-022 POLICY-DECISION: what a role manager may still do within the rank rules', async () => {
    // Each assertion pins today's behaviour; the owner decides whether it is intended (see the report).
    // (a) A role manager may remove grants from a custom role that carries keys they do not hold.
    const rich = await newRole(P.admin, 'esc-rich', [['record.contacts.read'], ['billing.manage']]);
    expect(rich.status).toBe(201);
    const strip = await editGrants(mgr.token, rich.body.id, [
      { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' },
    ]);
    expect(strip.status, JSON.stringify(strip.body)).toBe(200);
    // (b) A role manager may add a deny for a key they do not hold (denies are never checked against holdings).
    const target = await newRole(P.admin, 'esc-denyadd', [['record.contacts.read']]);
    const deny = await editGrants(mgr.token, target.body.id, [
      { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' },
      { permissionKey: 'billing.manage', effect: 'deny', recordScope: 'all' },
    ]);
    expect(deny.status, JSON.stringify(deny.body)).toBe(200);
    // (c) A role manager may delete an unused custom role whose keys they do not hold.
    const doomed = await newRole(P.admin, 'esc-doomed', [['billing.manage']]);
    expect((await call(mgr.token, 'delete', `/v2/roles/${doomed.body.id}`)).status).toBe(204);
    // (d) admin.user.manage alone (no org.member.invite) can create a user that has no role, with an admin-set password.
    const onlyUsers = await seed(P, 'esconlyusers', [[['admin.user.manage']]]);
    const email = `norole${Date.now()}@example.test`;
    const created = await call(onlyUsers.token, 'post', '/v2/users', {
      email,
      fullName: 'No Role',
      password: PASSWORD,
      roleIds: [],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // ...but cannot give that user a role (needs org.member.invite and org.member.role_assign)
    const withRole = await call(onlyUsers.token, 'post', '/v2/users', {
      email: `role${Date.now()}@example.test`,
      fullName: 'R',
      password: PASSWORD,
      roleIds: [agentRole.uuid],
    });
    expect(withRole.status).toBe(403);
  });
});

// ---- 4. custom roles --------------------------------------------------------------------------------------------------------------

describe('AUTHZ-023 custom roles are validated and tenant-bound', () => {
  let T: Tenant;
  let U: Tenant;
  beforeAll(async () => {
    T = await api.signup('lc-cust');
    U = await api.signup('lc-cust-other');
  });

  it('AUTHZ-023 a permission key that does not exist is rejected as a client error, on create and on update', async () => {
    const bogus = await call(T.admin, 'post', '/v2/roles', {
      name: 'bogus-key',
      grants: [{ permissionKey: 'zz.not.a.permission', effect: 'allow', recordScope: 'all' }],
    });
    expect(bogus.status, JSON.stringify(bogus.body)).toBeGreaterThanOrEqual(400);
    expect(
      bogus.status,
      `must be a client error, got ${bogus.status} ${JSON.stringify(bogus.body)}`,
    ).toBeLessThan(500);
    expect(await roleCount(T.orgId, 'bogus-key')).toBe(0);

    const real = await call(T.admin, 'post', '/v2/roles', {
      name: 'real-key',
      grants: [{ permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' }],
    });
    expect(real.status, JSON.stringify(real.body)).toBe(201);
    const upd = await editGrants(T.admin, real.body.id, [
      { permissionKey: 'zz.not.a.permission', effect: 'allow', recordScope: 'all' },
    ]);
    expect(upd.status, `got ${upd.status} ${JSON.stringify(upd.body)}`).toBeGreaterThanOrEqual(400);
    expect(upd.status).toBeLessThan(500);
    expect(await grantsOfRole(real.body.id)).toEqual(['record.contacts.read:allow:all']);
  });

  it('AUTHZ-023 an invalid effect or scope is rejected and a preset name cannot be reused for a lookalike role', async () => {
    const effect = await call(T.admin, 'post', '/v2/roles', {
      name: 'bad-effect',
      grants: [{ permissionKey: 'record.contacts.read', effect: 'maybe', recordScope: 'all' }],
    });
    const scope = await call(T.admin, 'post', '/v2/roles', {
      name: 'bad-scope',
      grants: [
        { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'everything' },
      ],
    });
    expect(effect.status).toBe(422);
    expect(scope.status).toBe(422);
    const lookalike = await call(T.admin, 'post', '/v2/roles', { name: 'Owner', grants: [] });
    expect(lookalike.status).toBeGreaterThanOrEqual(400);
    expect(lookalike.status).toBeLessThan(500);
    expect(await roleCount(T.orgId, 'Owner')).toBe(1);
  });

  it("AUTHZ-023 the database refuses a grant or a role assignment that points at another tenant's role", async () => {
    const tRole = (
      await h.owner.query(`INSERT INTO roles (org_id, name) VALUES ($1, 'cust-t') RETURNING id`, [
        T.orgId,
      ])
    ).rows[0].id;
    const uRole = (
      await h.owner.query(`INSERT INTO roles (org_id, name) VALUES ($1, 'cust-u') RETURNING id`, [
        U.orgId,
      ])
    ).rows[0].id;
    const member = await seed(T, 'custmember', []);
    const app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    const asTenant = async (orgId: number, sql: string, params: unknown[]) => {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
        await app.query(`SELECT set_config('app.user_id', '', true)`);
        return await app.query(sql, params);
      } finally {
        await app.query('ROLLBACK');
      }
    };
    try {
      const insertGrant = `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,'record.contacts.read','allow','all')`;
      // tenant T's context, T's org id, U's role id: the composite foreign key refuses
      await expect(asTenant(T.orgId, insertGrant, [T.orgId, uRole])).rejects.toThrow();
      // tenant T's context writing a row stamped with U's org id: row-level security refuses
      await expect(asTenant(T.orgId, insertGrant, [U.orgId, uRole])).rejects.toThrow();
      await expect(
        asTenant(T.orgId, `INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
          T.orgId,
          member.userId,
          uRole,
        ]),
      ).rejects.toThrow();
      // and tenant T cannot even see U's role grants
      await h.owner.query(
        `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,'record.contacts.read','allow','all')`,
        [U.orgId, uRole],
      );
      const seen = await asTenant(
        T.orgId,
        `SELECT count(*)::int AS n FROM role_grants WHERE org_id = $1`,
        [U.orgId],
      );
      expect(seen.rows[0].n).toBe(0);
      // control: the same statement inside the right tenant works
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(T.orgId)]);
      await app.query(insertGrant, [T.orgId, tRole]);
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }
  });
});

// ---- 5. tokens and claims ---------------------------------------------------------------------------------------------------------

describe('AUTHZ-030 tokens carry identity, never authority', () => {
  let X: Tenant;
  let Y: Tenant;
  let member: Seeded;
  const jwtService = () => h.app.get(JwtService, { strict: false });
  const mint = (claims: Record<string, unknown>) =>
    jwtService().sign(claims, { secret: process.env.JWT_ACCESS_SECRET!, algorithm: 'HS256' });
  const claimsOf = (token: string) => {
    const c = jwtService().decode(token) as Record<string, unknown>;
    return c;
  };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  beforeAll(async () => {
    X = await api.signup('lc-tok-x');
    Y = await api.signup('lc-tok-y');
    member = await seed(X, 'tokmember', [[['record.contacts.read'], ['record.contacts.create']]]);
  });

  it('AUTHZ-030 the token holds no role or permission claims', () => {
    const claims = claimsOf(member.token);
    expect(Object.keys(claims).sort()).toEqual(
      expect.arrayContaining(['org', 'sub', 'typ', 'sid']),
    );
    for (const key of Object.keys(claims)) {
      expect(key, `claim ${key}`).not.toMatch(
        /^(role|roles|perm|perms|permissions|scope|scopes|grants|admin|isAdmin)$/i,
      );
    }
  });

  it('AUTHZ-030 claims added to a validly signed token do not change what the database grants', async () => {
    const base = claimsOf(member.token);
    const forged = mint({
      ...base,
      role: 'Owner',
      roles: ['Owner', 'admin'],
      permissions: ['admin.role.manage', 'billing.manage'],
      perms: { 'admin.role.manage': 'all' },
      scope: '*',
      isAdmin: true,
    });
    const control = mint({ ...base, exp: Math.floor(Date.now() / 1000) + 600 });
    expect((await readContacts(control)).status, 'control: the minting works').toBe(200);
    expect((await readContacts(forged)).status).toBe(200);
    expect(
      (await call(forged, 'post', '/v2/roles', { name: 'forged-role', grants: [] })).status,
    ).toBe(403);
    expect((await call(forged, 'get', '/v2/users')).status).toBe(403);
    expect((await session(forged)).body.permissions).toEqual({
      'record.contacts.read': 'all',
      'record.contacts.create': 'all',
    });
    expect(await roleCount(X.orgId, 'forged-role')).toBe(0);
  });

  it('AUTHZ-030 an edited payload, an unsigned token and a token for another audience are refused', async () => {
    const [head, payload, sig] = member.token.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect((await readContacts(member.token)).status, 'control').toBe(200);
    const swapOrg = [head, b64({ ...claims, org: Y.orgId }), sig].join('.');
    const swapSub = [head, b64({ ...claims, sub: Y.adminUserId, org: Y.orgId }), sig].join('.');
    const addRole = [head, b64({ ...claims, role: 'Owner' }), sig].join('.');
    const none = [b64({ alg: 'none', typ: 'JWT' }), payload, ''].join('.');
    const wrongAud = mint({
      ...claims,
      aud: 'someone-else',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    for (const [what, token] of Object.entries({ swapOrg, swapSub, addRole, none, wrongAud })) {
      const res = await readContacts(token);
      expect(res.status, what).toBe(401);
    }
  });

  it('AUTHZ-030 an expired token is refused (and the same minting with a future expiry is accepted)', async () => {
    const { iat: _iat, exp: _exp, ...base } = claimsOf(member.token);
    const now = Math.floor(Date.now() / 1000);
    expect((await readContacts(mint({ ...base, iat: now, exp: now + 600 }))).status).toBe(200);
    expect((await readContacts(mint({ ...base, iat: now - 7200, exp: now - 60 }))).status).toBe(
      401,
    );
  });

  it('AUTHZ-016 tenant hints in headers, query or body never move a token to another tenant', async () => {
    await api.seedContacts(Y, [{ name: 'tok-y-secret-contact' }]);
    await api.seedContacts(X, [{ name: 'tok-x-own-contact' }]);
    const hints = {
      'x-org-id': String(Y.orgId),
      'x-org-slug': Y.slug,
      'x-tenant-id': String(Y.orgId),
      'x-organization': Y.slug,
      'x-workspace': Y.slug,
    };
    const plain = await readContacts(member.token);
    expect(JSON.stringify(plain.body)).toContain('tok-x-own-contact');
    const hinted = await call(
      member.token,
      'get',
      `/v2/contacts?orgId=${Y.orgId}&orgSlug=${Y.slug}&org_id=${Y.orgId}`,
      undefined,
      hints,
    );
    expect(hinted.status).toBeLessThan(500);
    expect(JSON.stringify(hinted.body)).not.toContain('tok-y-secret-contact');
    const sess = await call(
      member.token,
      'get',
      `/v2/auth/session?orgSlug=${Y.slug}`,
      undefined,
      hints,
    );
    expect(sess.body.org.slug).toBe(X.slug);
    // a write that names the other tenant lands in (or is refused for) the token's own tenant
    const name = `tok-hint-write-${seq++}`;
    const write = await call(
      member.token,
      'post',
      '/v2/contacts',
      { name, email: emailOf(name), orgId: Y.orgId, org_id: Y.orgId },
      hints,
    );
    expect(write.status, JSON.stringify(write.body)).toBeLessThan(500);
    const rows = await h.owner.query(`SELECT org_id FROM contacts WHERE name = $1`, [name]);
    expect(rows.rows.filter((r) => Number(r.org_id) === Y.orgId)).toEqual([]);
    if (write.status < 300) expect(rows.rows.map((r) => Number(r.org_id))).toEqual([X.orgId]);
    // control: without hints the same write works in the token's tenant
    const ok = await call(member.token, 'post', '/v2/contacts', {
      name: `${name}-control`,
      email: emailOf(`${name}-control`),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('AUTHZ-017 a token stops working after logout, and its refresh token with it', async () => {
    const m = await seed(X, 'toklogout', [[['record.contacts.read']]]);
    expect((await readContacts(m.token)).status).toBe(200);
    expect((await call(m.token, 'post', '/v2/auth/logout', {})).status).toBeLessThan(300);
    expect((await readContacts(m.token)).status).toBe(401);
    expect(
      (await http().post('/v2/auth/refresh').send({ refreshToken: m.refresh })).status,
    ).toBeGreaterThanOrEqual(400);
    // a second session of the same person is a separate session and keeps working
    const again = await login(X.slug, m.email);
    expect((await readContacts(again.body.tokens.accessToken)).status).toBe(200);
  });

  it('AUTHZ-017 changing the password signs out the other sessions, their refresh tokens and the old password', async () => {
    const m = await seed(X, 'tokpassword', [[['record.contacts.read']]]);
    const other = tokenOf(await login(X.slug, m.email));
    expect((await readContacts(other.access)).status).toBe(200);
    const newPassword = 'N3wStr0ngPass#77';
    const change = await call(m.token, 'post', '/v2/account/password', {
      currentPassword: PASSWORD,
      newPassword,
    });
    expect(change.status, JSON.stringify(change.body)).toBeLessThan(300);
    expect((await readContacts(other.access)).status).toBe(401);
    expect(
      (await http().post('/v2/auth/refresh').send({ refreshToken: other.refresh })).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await login(X.slug, m.email, PASSWORD)).status).toBeGreaterThanOrEqual(400);
    const fresh = await login(X.slug, m.email, newPassword);
    expect(fresh.status).toBeLessThan(300);
    expect((await readContacts(fresh.body.tokens.accessToken)).status).toBe(200);
    expect((await readContacts(m.token)).status, 'the session that changed it stays').toBe(200);
  });

  it('AUTHZ-017 after removal from the workspace every older token of that member is dead', async () => {
    const m = await seed(X, 'tokremoved', [[['record.contacts.read']]]);
    const second = tokenOf(await login(X.slug, m.email));
    expect((await readContacts(second.access)).status).toBe(200);
    expect((await call(X.admin, 'delete', `/v2/workspace/members/${m.uuid}`)).status).toBe(204);
    for (const token of [m.token, second.access])
      expect(denied((await readContacts(token)).status)).toBe(true);
    for (const refreshToken of [m.refresh, second.refresh]) {
      expect(
        (await http().post('/v2/auth/refresh').send({ refreshToken })).status,
      ).toBeGreaterThanOrEqual(400);
    }
  });
});

// ---- 6. workspace switch ----------------------------------------------------------------------------------------------------------

describe('AUTHZ-016/017/027 workspace switch follows live membership', () => {
  let A: Tenant;
  let B: Tenant;
  let C: Tenant;

  /** The same verified address as a member of two workspaces, with a different role in each. */
  async function twoWorkspaces(name: string, verifiedInB = true) {
    const inA = await seed(A, name, [[['record.contacts.read'], ['admin.role.manage']]]);
    const user = await h.owner.query(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, uuid`,
      [B.orgId, inA.email, name, await hash(PASSWORD)],
    );
    const viewer = await presetRole(B, 'Viewer');
    await h.owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
      B.orgId,
      user.rows[0].id,
      viewer.id,
    ]);
    await h.owner.query(
      `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at) VALUES ($1,$2,${verifiedInB ? 'now()' : 'NULL'},now())`,
      [B.orgId, user.rows[0].id],
    );
    return { inA, bUserId: Number(user.rows[0].id), bUuid: user.rows[0].uuid as string };
  }

  beforeAll(async () => {
    A = await api.signup('lc-sw-a');
    B = await api.signup('lc-sw-b');
    C = await api.signup('lc-sw-c');
  });

  const switchTo = (token: string, orgSlug: string) =>
    call(token, 'post', '/v2/auth/workspaces/switch', { orgSlug });

  it('AUTHZ-016 a member of A and B switches to B only; the new token is B-scoped and the old one ends', async () => {
    const { inA } = await twoWorkspaces('swlive');
    expect((await readContacts(inA.token)).status).toBe(200);
    const list = await call(inA.token, 'get', '/v2/auth/workspaces');
    expect(list.body.data.map((w: { slug: string }) => w.slug).sort()).toEqual(
      [A.slug, B.slug].sort(),
    );
    const res = await switchTo(inA.token, B.slug);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const inB = res.body.tokens.accessToken as string;
    const sess = await session(inB);
    expect(sess.body.org.slug).toBe(B.slug);
    // B's role, not A's: the A privileges did not travel
    expect(sess.body.roles.map((r: { name: string }) => r.name)).toEqual(['Viewer']);
    expect((await readContacts(inB)).status).toBe(403);
    expect((await call(inB, 'get', '/v2/roles')).status).toBe(403);
    expect((await readTickets(inB)).status).toBe(200);
    // the switch ended the session in A
    expect((await readContacts(inA.token)).status).toBe(401);
  });

  it('AUTHZ-016 a workspace the person is not a member of, their own workspace and an unknown slug are refused', async () => {
    const { inA } = await twoWorkspaces('swrefuse');
    for (const slug of [C.slug, A.slug, 'no-such-workspace-slug']) {
      const res = await switchTo(inA.token, slug);
      expect(res.status, slug).toBe(403);
      expect(res.body.code).toBe('AUTH_WORKSPACE_NOT_AVAILABLE');
    }
    expect((await readContacts(inA.token)).status, 'refusals leave the session alone').toBe(200);
    expect((await switchTo(inA.token, B.slug)).status, 'control: B works').toBeLessThan(300);
  });

  it('AUTHZ-016 an unverified address in the target workspace cannot be used to enter it', async () => {
    const { inA } = await twoWorkspaces('swunverified', false);
    const list = await call(inA.token, 'get', '/v2/auth/workspaces');
    expect(list.body.data.map((w: { slug: string }) => w.slug)).toEqual([A.slug]);
    const res = await switchTo(inA.token, B.slug);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_WORKSPACE_NOT_AVAILABLE');
  });

  it('AUTHZ-027 after removal from B the switch fails, B is no longer listed and the old B token is dead', async () => {
    const { inA, bUuid } = await twoWorkspaces('swremoved');
    const entered = await switchTo(inA.token, B.slug);
    expect(entered.status).toBeLessThan(300);
    const oldB = tokenOf(entered);
    expect((await session(oldB.access)).status).toBe(200);

    const removed = await call(B.admin, 'delete', `/v2/workspace/members/${bUuid}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(204);

    expect(denied((await session(oldB.access)).status)).toBe(true);
    expect(
      (await http().post('/v2/auth/refresh').send({ refreshToken: oldB.refresh })).status,
    ).toBeGreaterThanOrEqual(400);
    const backInA = await login(A.slug, inA.email);
    expect(backInA.status).toBeLessThan(300);
    const aToken = backInA.body.tokens.accessToken as string;
    expect(
      (await call(aToken, 'get', '/v2/auth/workspaces')).body.data.map(
        (w: { slug: string }) => w.slug,
      ),
    ).toEqual([A.slug]);
    const again = await switchTo(aToken, B.slug);
    expect(again.status, JSON.stringify(again.body)).toBe(403);
    expect(again.body.code).toBe('AUTH_WORKSPACE_NOT_AVAILABLE');
    await expectNoAccessFromSignIn(B.slug, inA.email);
  });

  it('AUTHZ-027 a suspended membership cannot be switched into, a reactivated one can', async () => {
    const { inA, bUuid } = await twoWorkspaces('swsuspend');
    expect((await patchUser(B.admin, bUuid, { status: 'inactive' })).status).toBe(200);
    const blocked = await switchTo(inA.token, B.slug);
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(403);
    expect(blocked.body.code).toBe('AUTH_WORKSPACE_NOT_AVAILABLE');
    expect((await readContacts(inA.token)).status).toBe(200);
    expect((await patchUser(B.admin, bUuid, { status: 'active' })).status).toBe(200);
    const open = await switchTo(inA.token, B.slug);
    expect(open.status, JSON.stringify(open.body)).toBeLessThan(300);
    expect((await session(open.body.tokens.accessToken)).body.org.slug).toBe(B.slug);
  });
});

// ---- 7. invitations and team management ------------------------------------------------------------------------------------------

describe('AUTHZ-063 invitations and member lifecycle', () => {
  let I: Tenant;
  let J: Tenant;
  let adminM: Seeded;
  let managerM: Seeded;
  let roleOf: Record<string, string>;

  beforeAll(async () => {
    I = await api.signup('lc-inv');
    J = await api.signup('lc-inv-other');
    adminM = await seed(I, 'invadmin', ['Admin']);
    managerM = await seed(I, 'invmanager', ['Manager']);
    roleOf = Object.fromEntries(
      await Promise.all(
        ['Owner', 'Admin', 'Manager', 'Agent', 'Viewer'].map(
          async (n) => [n, (await presetRole(I, n)).uuid] as const,
        ),
      ),
    );
  });

  const invite = (actor: string, email: string, roleId: string) =>
    call(actor, 'post', '/v2/workspace/members/invite', {
      fullName: 'Invited Person',
      email,
      roleId,
    });
  const accept = (token: string, orgSlug: string, extra: object = {}) =>
    http()
      .post('/v2/workspace/invitations/accept')
      .set('x-forwarded-for', nextIp())
      .send({ token, orgSlug, password: PASSWORD, ...extra });
  const emailFor = (tag: string) => `${tag}${Date.now()}${seq++}@example.test`;
  const userExists = async (orgId: number, email: string) =>
    Number(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND email = $2`,
          [orgId, email],
        )
      ).rows[0].n,
    ) > 0;

  it('AUTHZ-063 an inviter cannot offer a role above their own; within their rank the invitation is created', async () => {
    for (const role of ['Owner', 'Admin']) {
      const email = emailFor(`inv${role.toLowerCase()}`);
      const res = await invite(adminM.token, email, roleOf[role]!);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
      expect(await userExists(I.orgId, email)).toBe(false);
    }
    const ok = emailFor('invok');
    const res = await invite(adminM.token, ok, roleOf.Manager!);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(await userExists(I.orgId, ok)).toBe(true);
    // a Manager has no invite key at all
    const blocked = emailFor('invmanager');
    expect((await invite(managerM.token, blocked, roleOf.Viewer!)).status).toBe(403);
    expect(await userExists(I.orgId, blocked)).toBe(false);
    // an Owner may offer Admin
    expect((await invite(I.admin, emailFor('invbyowner'), roleOf.Admin!)).status).toBeLessThan(300);
  });

  it('AUTHZ-063 an invitation is accepted only in the workspace that issued it, once, with the role it carried', async () => {
    const email = emailFor('invaccept');
    expect((await invite(adminM.token, email, roleOf.Agent!)).status).toBeLessThan(300);
    const { token } = mailTo(email);
    expect(token.length).toBeGreaterThan(16);

    // guessed or foreign: refused with the one generic answer, and nothing is consumed
    for (const [what, t, slug] of [
      ['the token in another workspace', token, J.slug],
      ['a guessed token', randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''), I.slug],
      [
        'a token with one character changed',
        token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'),
        I.slug,
      ],
      ['an unknown workspace', token, 'no-such-workspace-slug'],
    ] as const) {
      const res = await accept(t, slug);
      expect(res.status, what).toBe(400);
      expect(res.body.code, what).toBe('WSP_INVITE_INVALID');
    }
    expect(await userExists(J.orgId, email)).toBe(false);

    // the body cannot choose the role
    const ok = await accept(token, I.slug, {
      roleId: roleOf.Owner,
      roleIds: [roleOf.Owner],
      role: 'Owner',
    });
    if (ok.status < 300) {
      expect(
        await rolesOfUser(
          I.orgId,
          Number(
            (
              await h.owner.query(`SELECT id FROM users WHERE org_id = $1 AND email = $2`, [
                I.orgId,
                email,
              ])
            ).rows[0].id,
          ),
        ),
      ).toEqual(['Agent']);
      const sess = await session(ok.body.tokens.accessToken);
      expect(sess.body.roles.map((r: { name: string }) => r.name)).toEqual(['Agent']);
      expect(sess.body.org.slug).toBe(I.slug);
    } else {
      expect(ok.status).toBeGreaterThanOrEqual(400);
      expect(ok.status).toBeLessThan(500);
    }
  });

  it('AUTHZ-063 an accepted, expired, replaced or revoked invitation cannot be used', async () => {
    // reuse
    const reuseEmail = emailFor('invreuse');
    await invite(adminM.token, reuseEmail, roleOf.Viewer!);
    const reuse = mailTo(reuseEmail).token;
    const first = await accept(reuse, I.slug);
    expect(first.status, JSON.stringify(first.body)).toBeLessThan(300);
    const second = await accept(reuse, I.slug);
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('WSP_INVITE_INVALID');
    expect(
      (await call(first.body.tokens.accessToken, 'get', '/v2/auth/session')).status,
      'control: the first acceptance signed in',
    ).toBe(200);

    // expired
    const expiredEmail = emailFor('invexpired');
    await invite(adminM.token, expiredEmail, roleOf.Viewer!);
    const expired = mailTo(expiredEmail).token;
    await h.owner.query(
      `UPDATE user_tokens SET expires_at = now() - interval '1 minute'
        WHERE org_id = $1 AND kind = 'invite' AND user_id = (SELECT id FROM users WHERE org_id = $1 AND email = $2)`,
      [I.orgId, expiredEmail],
    );
    const late = await accept(expired, I.slug);
    expect(late.status).toBe(400);
    expect(late.body.code).toBe('WSP_INVITE_INVALID');
    const preview = await http()
      .get('/v2/workspace/invitations/preview')
      .set('x-forwarded-for', nextIp())
      .query({ token: expired, orgSlug: I.slug });
    expect(preview.status).toBe(400);

    // replaced by a resend: the old link stops, the new one works
    const resendEmail = emailFor('invresend');
    const invited = await invite(adminM.token, resendEmail, roleOf.Viewer!);
    const oldLink = mailTo(resendEmail).token;
    const resent = await call(
      adminM.token,
      'post',
      `/v2/workspace/members/${invited.body.member.id}/resend-invite`,
    );
    expect(resent.status, JSON.stringify(resent.body)).toBeLessThan(300);
    const newLink = mailTo(resendEmail).token;
    expect(newLink).not.toBe(oldLink);
    expect((await accept(oldLink, I.slug)).status).toBe(400);
    expect((await accept(newLink, I.slug)).status).toBeLessThan(300);

    // removed before accepting
    const removedEmail = emailFor('invremoved');
    const pending = await invite(adminM.token, removedEmail, roleOf.Viewer!);
    const removedToken = mailTo(removedEmail).token;
    expect(
      (await call(adminM.token, 'delete', `/v2/workspace/members/${pending.body.member.id}`))
        .status,
    ).toBe(204);
    const gone = await accept(removedToken, I.slug);
    expect(gone.status).toBe(400);
    expect(gone.body.code).toBe('WSP_INVITE_INVALID');
  });

  it('AUTHZ-063 a member suspended by an Admin cannot act on the next request', async () => {
    const m = await seed(I, 'invsuspendedat', [[['record.contacts.read']]]);
    expect((await readContacts(m.token)).status).toBe(200);
    expect((await patchUser(adminM.token, m.uuid, { status: 'inactive' })).status).toBe(200);
    expect(denied((await readContacts(m.token)).status)).toBe(true);
  });

  it('AUTHZ-063 a suspended member is still visible to the admin, ranks are respected, and reactivation restores them', async () => {
    const m = await seed(I, 'invsuspended', [[['record.contacts.read']]]);
    expect((await readContacts(m.token)).status).toBe(200);
    expect((await patchUser(adminM.token, m.uuid, { status: 'inactive' })).status).toBe(200);
    // account-gate cache dropped by hand: the previous test covers the latency, this one the rest of the lifecycle
    await h.redis.del(`auth:gate:${I.orgId}:${m.userId}`);
    expect(denied((await readContacts(m.token)).status)).toBe(true);
    await expectNoAccessFromSignIn(I.slug, m.email);
    // still visible to the people manager, with the status that explains it
    const list = await call(adminM.token, 'get', '/v2/users?status=inactive&limit=100');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const row = (list.body.data as Array<{ id: string; status: string }>).find(
      (u) => u.id === m.uuid,
    );
    expect(row?.status).toBe('inactive');
    const one = await call(adminM.token, 'get', `/v2/users/${m.uuid}`);
    expect(one.body.status).toBe('inactive');
    // an Admin cannot suspend an Owner or another Admin, but can suspend lower tiers
    const owner = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [I.adminUserId]))
      .rows[0].uuid as string;
    expect((await patchUser(adminM.token, owner, { status: 'inactive' })).status).toBe(403);
    const otherAdmin = await seed(I, 'invadmin2', ['Admin']);
    expect((await patchUser(adminM.token, otherAdmin.uuid, { status: 'inactive' })).status).toBe(
      403,
    );
    expect(denied((await session(otherAdmin.token)).status)).toBe(false);
    // reactivate
    expect((await patchUser(adminM.token, m.uuid, { status: 'active' })).status).toBe(200);
    const back = await login(I.slug, m.email);
    expect(back.status, JSON.stringify(back.body)).toBeLessThan(300);
    expect((await readContacts(back.body.tokens.accessToken)).status).toBe(200);
  });
});

// ---- 8. audit of decisions --------------------------------------------------------------------------------------------------------

describe('AUTHZ-096 authorization decisions leave a sanitized trail', () => {
  let T: Tenant;
  let adminM: Seeded;
  let mgr: Seeded;
  const eventRows = async (orgId: number, actorId: number) => {
    const audit = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND actor_id = $2`,
      [orgId, actorId],
    );
    const sec = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE subject_org_id = $1 AND actor_id = $2 AND event NOT LIKE 'auth.login%'`,
      [orgId, actorId],
    );
    return Number(audit.rows[0].n) + Number(sec.rows[0].n);
  };

  beforeAll(async () => {
    T = await api.signup('lc-audit');
    adminM = await seed(T, 'auditadmin', ['Admin']);
    mgr = await seed(T, 'auditmgr', [ROLE_KEYS]);
  });

  it('AUTHZ-096 a successful role change writes exactly one audit row with who, what and before/after', async () => {
    const target = await seed(T, 'audittarget', ['Agent']);
    const managerRole = await presetRole(T, 'Manager');
    const res = await memberRole(T.admin, target.uuid, managerRole.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = (
      await h.owner.query(
        `SELECT actor_id, actor_type, module, action, delta, request_id FROM audit_log
        WHERE org_id = $1 AND record_id = $2 AND action = 'member.role_changed'`,
        [T.orgId, target.userId],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].actor_id)).toBe(T.adminUserId);
    expect(rows[0].actor_type).toBe('user');
    expect(rows[0].request_id).toBeTruthy();
    expect(rows[0].delta.role).toEqual({ old: ['Agent'], new: ['Manager'] });

    const viaUsers = await seed(T, 'audittarget2', ['Agent']);
    expect((await patchUser(T.admin, viaUsers.uuid, { roleIds: [managerRole.uuid] })).status).toBe(
      200,
    );
    const changed = (
      await h.owner.query(
        `SELECT actor_id, delta FROM audit_log WHERE org_id = $1 AND module = 'users' AND record_id = $2 AND delta ? 'roles'`,
        [T.orgId, viaUsers.userId],
      )
    ).rows;
    expect(changed).toHaveLength(1);
    expect(Number(changed[0].actor_id)).toBe(T.adminUserId);
    expect(changed[0].delta.roles).toEqual({ old: ['Agent'], new: ['Manager'] });

    const roleEdit = await seed(T, 'auditrole', [[['record.contacts.read']]]);
    expect((await editGrants(T.admin, roleEdit.roleUuids[0]!, [])).status).toBe(200);
    const edits = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'roles' AND record_id = $2 AND action = 'update'`,
      [T.orgId, roleEdit.roleIds[0]],
    );
    expect(edits.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('AUTHZ-096 a denied privileged action (role change, role create, role edit) is recorded with the actor', async () => {
    const owner = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [T.adminUserId]))
      .rows[0].uuid as string;
    const ownerRole = await presetRole(T, 'Owner');
    const agent = await seed(T, 'auditvictim', ['Agent']);
    const adminRole = await presetRole(T, 'Admin');
    const attempts: Array<[string, Seeded, () => Promise<{ status: number }>]> = [
      [
        'assign Owner to a member',
        adminM,
        () => memberRole(adminM.token, agent.uuid, ownerRole.uuid),
      ],
      ['demote the Owner', adminM, () => memberRole(adminM.token, owner, adminRole.uuid)],
      [
        'create a role beyond holdings',
        mgr,
        () =>
          call(mgr.token, 'post', '/v2/roles', {
            name: 'audit-over',
            grants: [{ permissionKey: 'billing.manage', effect: 'allow', recordScope: 'all' }],
          }),
      ],
      ['edit the Admin preset', mgr, () => editGrants(mgr.token, adminRole.uuid, [])],
    ];
    const unrecorded: string[] = [];
    for (const [what, actor, run] of attempts) {
      const before = await eventRows(T.orgId, actor.userId);
      const res = await run();
      expect(res.status, what).toBe(403);
      if ((await eventRows(T.orgId, actor.userId)) <= before) unrecorded.push(what);
    }
    expect(
      unrecorded,
      'refusals that left no audit row and no security event for the actor',
    ).toEqual([]);
  });

  it('AUTHZ-096 no secret (password, token, hash, invite link) appears in audit, security or outbox rows', async () => {
    const wrongMarker = 'Wr0ngSecret#Marker42';
    const invitee = `auditinvite${Date.now()}@example.test`;
    const invited = await call(adminM.token, 'post', '/v2/workspace/members/invite', {
      fullName: 'Audit Invitee',
      email: invitee,
      roleId: (await presetRole(T, 'Viewer')).uuid,
    });
    expect(invited.status, JSON.stringify(invited.body)).toBeLessThan(300);
    const inviteToken = mailTo(invitee).token;
    const accepted = await http()
      .post('/v2/workspace/invitations/accept')
      .set('x-forwarded-for', nextIp())
      .send({ token: inviteToken, orgSlug: T.slug, password: PASSWORD });
    expect(accepted.status).toBeLessThan(300);
    const victim = await seed(T, 'auditsecret', [[['record.contacts.read']]]);
    await login(T.slug, victim.email, wrongMarker);
    const newPassword = 'Aud1tNewPass#88';
    expect(
      (
        await call(victim.token, 'post', '/v2/account/password', {
          currentPassword: PASSWORD,
          newPassword,
        })
      ).status,
    ).toBeLessThan(300);
    const reset = await call(
      T.admin,
      'post',
      `/v2/workspace/members/${victim.uuid}/reset-password`,
    );
    expect(reset.status).toBeLessThan(300);
    const resetToken = mailTo(victim.email).token;
    await call(T.admin, 'delete', `/v2/workspace/members/${victim.uuid}`);

    const secrets = [
      PASSWORD,
      wrongMarker,
      newPassword,
      inviteToken,
      resetToken,
      victim.token,
      victim.refresh,
      accepted.body.tokens.accessToken,
      accepted.body.tokens.refreshToken,
      '$argon2',
      'eyJhbGciOi',
    ].filter(Boolean);
    const dumps = [
      await h.owner.query(`SELECT to_jsonb(a)::text AS t FROM audit_log a`),
      await h.owner.query(`SELECT to_jsonb(s)::text AS t FROM security_events s`),
      await h.owner.query(`SELECT to_jsonb(o)::text AS t FROM event_outbox o`),
    ].flatMap((r) => r.rows.map((x) => x.t as string));
    expect(dumps.length).toBeGreaterThan(0);
    for (const secret of secrets) {
      const hits = dumps.filter((row) => row.includes(secret)).map((row) => row.slice(0, 160));
      expect(hits, `a row contains ${secret.slice(0, 12)}...`).toEqual([]);
    }
  });
});

// ---- 9. concurrency ---------------------------------------------------------------------------------------------------------------

describe('AUTHZ-026/089 a revocation racing the revoked member leaves no mutation behind it', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await api.signup('lc-race');
  });

  type Variant = 'role-edit' | 'unassign' | 'member-role' | 'member-remove' | 'suspend';
  const writes: GrantSpec[] = [['record.contacts.read'], ['record.contacts.create']];

  async function race(variant: Variant, iteration: number) {
    const m = await seed(T, `race${variant}${iteration}`, [writes]);
    const prefix = `race-${variant}-${iteration}-`;
    const post = (name: string) =>
      call(m.token, 'post', '/v2/contacts', {
        name: `${prefix}${name}`,
        email: emailOf(`${prefix}${name}`),
      });
    const warm = await post('warm');
    expect(warm.status, JSON.stringify(warm.body)).toBe(201);

    const viewer = (await presetRole(T, 'Viewer')).uuid;
    const revoke = async () => {
      switch (variant) {
        case 'role-edit':
          return editGrants(T.admin, m.roleUuids[0]!, [
            { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' },
          ]);
        case 'unassign':
          return patchUser(T.admin, m.uuid, { roleIds: [] });
        case 'member-role':
          return memberRole(T.admin, m.uuid, viewer);
        case 'member-remove':
          return call(T.admin, 'delete', `/v2/workspace/members/${m.uuid}`);
        case 'suspend':
          return patchUser(T.admin, m.uuid, { status: 'inactive' });
      }
    };

    let revoked = false;
    const seen: Array<{ name: string; status: number; afterRevoke: boolean }> = [];
    const poster = async (id: number) => {
      let after = 0;
      for (let n = 0; n < 60; n++) {
        const afterRevoke = revoked;
        const name = `${id}-${n}`;
        const res = await post(name);
        seen.push({ name: `${prefix}${name}`, status: res.status, afterRevoke });
        if (revoked && ++after >= 3) break;
      }
    };
    const revoker = async () => {
      await sleep(15 + (iteration % 5) * 7);
      const res = await revoke();
      revoked = true;
      return res;
    };
    const [revokeRes] = await Promise.all([revoker(), poster(0), poster(1), poster(2)]);
    expect(
      revokeRes.status,
      `${variant} #${iteration}: ${JSON.stringify(revokeRes.body)}`,
    ).toBeLessThan(300);

    const leaked = seen
      .filter((s) => s.afterRevoke && s.status < 300)
      .map((s) => `${s.name} -> ${s.status}`);
    const rows = await h.owner.query(
      `SELECT name FROM contacts WHERE org_id = $1 AND name LIKE $2`,
      [T.orgId, `${prefix}%`],
    );
    const created = seen.filter((s) => s.status === 201).length + 1; // + the warm-up
    const orphans = Number(rows.rowCount) - created;
    return {
      leaked,
      orphans,
      statuses: seen.map((s) => s.status),
      sawDenied: seen.some((s) => denied(s.status)),
    };
  }

  for (const variant of [
    'role-edit',
    'unassign',
    'member-role',
    'member-remove',
    'suspend',
  ] as const) {
    it(`AUTHZ-026 ${variant}: after the revocation commits no further write by the member succeeds`, async () => {
      const problems: string[] = [];
      let sawDenied = 0;
      for (let i = 0; i < 12; i++) {
        const r = await race(variant, i);
        problems.push(...r.leaked.map((l) => `iteration ${i}: ${l}`));
        if (r.orphans !== 0)
          problems.push(`iteration ${i}: ${r.orphans} contact rows do not match the 201 responses`);
        if (r.sawDenied) sawDenied++;
      }
      expect.soft(problems).toEqual([]);
      expect(
        sawDenied,
        'the revocation must actually have been observed by the member',
      ).toBeGreaterThan(0);
    }, 300_000);
  }

  it('AUTHZ-024 two Owners demoting each other at the same time cannot leave the workspace without an Owner', async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const R = await api.signup(`lc-race-own${i}`);
      const second = await seed(R, `raceowner${i}`, ['Owner']);
      const agent = (await presetRole(R, 'Agent')).uuid;
      const firstUuid = (
        await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [R.adminUserId])
      ).rows[0].uuid as string;
      expect(await activeOwners(R.orgId)).toBe(2);
      const [a, b] = await Promise.all([
        memberRole(R.admin, second.uuid, agent),
        memberRole(second.token, firstUuid, agent),
      ]);
      const owners = await activeOwners(R.orgId);
      if (owners < 1)
        outcomes.push(`iteration ${i}: statuses ${a.status}/${b.status}, ${owners} owners left`);
    }
    expect(outcomes).toEqual([]);
  }, 300_000);

  it('AUTHZ-089 parallel role edits and reads never leave a cached grant set that disagrees with the database', async () => {
    const m = await seed(T, 'racecache', [[['record.contacts.read'], ['support.ticket.read']]]);
    const problems: string[] = [];
    for (let i = 0; i < 10; i++) {
      const grants =
        i % 2 === 0
          ? [{ permissionKey: 'support.ticket.read', effect: 'allow', recordScope: 'all' }]
          : [
              { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' },
              { permissionKey: 'support.ticket.read', effect: 'allow', recordScope: 'all' },
            ];
      let done = false;
      const reader = async () => {
        while (!done) await readContacts(m.token);
      };
      const writer = async () => {
        await sleep(10);
        const res = await editGrants(T.admin, m.roleUuids[0]!, grants);
        done = true;
        return res;
      };
      const [, , res] = await Promise.all([reader(), reader(), writer()]);
      expect(res.status).toBe(200);
      const expected = i % 2 === 0 ? 403 : 200;
      const now = await readContacts(m.token);
      if (now.status !== expected)
        problems.push(`iteration ${i}: expected ${expected} after the edit, got ${now.status}`);
    }
    expect(problems).toEqual([]);
  }, 300_000);
});
