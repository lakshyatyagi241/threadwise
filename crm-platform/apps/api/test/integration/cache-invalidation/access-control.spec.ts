import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { RolesRepository } from '../../../src/modules/admin/roles/roles.repository';
import { RolesService } from '../../../src/modules/admin/roles/roles.service';
import { UsersRepository } from '../../../src/modules/admin/users/users.repository';
import { UsersService } from '../../../src/modules/admin/users/users.service';
import { MembersRepository } from '../../../src/modules/workspaces-teams-tenancy/members.repository';
import { MembersService } from '../../../src/modules/workspaces-teams-tenancy/members.service';
import { spawnInstance, type RemoteInstance } from './cross-process';
import { buildInstance, secondsUntil, startEnv, type Env, type Instance } from './harness';
import { record } from './results';

/**
 * Who may do what (item #66, P0): RBAC grant sets (R01/R02), the account gate (R04), the workspace suspension verdict (R05) and the
 * partner-agent flag (R06), each changed through the real writer class on a real Postgres and a private Redis, then read back on
 * this process (A) and on a second OS process (B). Seconds are measured on a monotonic clock.
 */
Logger.overrideLogger(false);

let KEY = '';
const stub = (o: object) => o as never;
const audit = stub({ record: async () => undefined });
const outbox = stub({ emit: async () => undefined });
// The rank/last-owner rules are not what is under test here; every one of them passes.
const rules = new Proxy(
  {},
  {
    get: (_t, p) =>
      p === 'withDenialAudit' ? (_a: string, run: () => unknown) => run() : async () => undefined,
  },
) as never;

describe('access control caches follow their source of truth', () => {
  let env: Env;
  let a: Instance;
  let b: RemoteInstance;
  let roles: RolesService;
  let users: UsersService;
  let members: MembersService;
  const sessionsStub = stub({
    revokeAllForUser: async () => undefined,
    tombstone: async () => undefined,
  });
  let n = 0;

  async function ws() {
    const tag = `${Date.now().toString(36)}${n++}`;
    const q = async (sql: string, p: unknown[] = []) =>
      (await env.pg.owner.query(sql, p)).rows[0] as Record<string, string | number>;
    const orgId = Number(
      (
        await q(
          `INSERT INTO organizations (slug,name,plan) VALUES ($1,$1,'starter') RETURNING id`,
          [`ac-${tag}`],
        )
      ).id,
    );
    const mkUser = async (name: string) => {
      const u = await q(
        `INSERT INTO users (org_id,email,full_name,password_hash) VALUES ($1,$2,$3,'x') RETURNING id, uuid, row_version`,
        [orgId, `${name}-${tag}@ac.test`, name],
      );
      await env.pg.owner.query(
        `INSERT INTO user_security (org_id,user_id,email_verified_at) VALUES ($1,$2,now())`,
        [orgId, u.id],
      );
      return { id: Number(u.id), uuid: String(u.uuid) };
    };
    const mkRole = async (name: string, systemKey: string | null, perms: string[]) => {
      const r = await q(
        `INSERT INTO roles (org_id,name,system_key) VALUES ($1,$2,$3) RETURNING id, uuid`,
        [orgId, name, systemKey],
      );
      for (const p of perms)
        await env.pg.owner.query(
          `INSERT INTO role_grants (org_id,role_id,permission_key,effect,record_scope) VALUES ($1,$2,$3,'allow','all')`,
          [orgId, r.id, p],
        );
      return { id: Number(r.id), uuid: String(r.uuid) };
    };
    const owner = await mkUser('owner');
    const ownerRole = await mkRole('Owner', 'admin', [KEY]);
    await env.pg.owner.query(`INSERT INTO user_roles VALUES ($1,$2,$3)`, [
      orgId,
      owner.id,
      ownerRole.id,
    ]);
    const target = await mkUser('target');
    const sales = await mkRole('Sales', null, [KEY]);
    const noAccess = await mkRole('Nothing', null, []);
    await env.pg.owner.query(`INSERT INTO user_roles VALUES ($1,$2,$3)`, [
      orgId,
      target.id,
      sales.id,
    ]);
    const as = <T>(fn: () => Promise<T>) =>
      RequestContextStore.run(
        { requestId: `r-${tag}`, orgId, actorType: 'user', actorId: owner.id, userId: owner.id },
        fn,
      );
    return { orgId, owner, target, sales, noAccess, as };
  }
  const canA = async (w: { orgId: number; target: { id: number } }) =>
    a.rbac.can(await a.rbac.grantsForUser(w.orgId, w.target.id), KEY).allowed;
  const canB = (w: { orgId: number; target: { id: number } }) =>
    b.call<boolean>('rbac.can', w.orgId, w.target.id, KEY);
  const rowVersion = async (table: string, orgId: number, id: number) =>
    Number(
      (
        await env.pg.owner.query(`SELECT row_version FROM ${table} WHERE org_id=$1 AND id=$2`, [
          orgId,
          id,
        ])
      ).rows[0].row_version,
    );

  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
    b = await spawnInstance(env, 'B');
    KEY = String(
      (await env.pg.owner.query(`SELECT key FROM permission_defs ORDER BY key LIMIT 1`)).rows[0]
        .key,
    );
    const passwords = stub({ hash: async () => 'h', verifyOrDummy: async () => true });
    roles = new RolesService(a.db, new RolesRepository(), audit, a.rbac, rules, a.entitlements);
    users = new UsersService(
      a.db,
      new UsersRepository(),
      outbox,
      audit,
      a.rbac,
      passwords,
      rules,
      sessionsStub,
      a.gates,
    );
    members = new MembersService(
      a.db,
      new MembersRepository(),
      outbox,
      a.rbac,
      rules,
      stub({}),
      stub({}),
      passwords,
      sessionsStub,
      a.gates,
      a.entitlements,
    );
  }, 240_000);
  afterAll(async () => {
    b?.kill();
    await a?.close();
    await env?.stop();
  });

  describe('RBAC grant sets: every writer path, read on two processes (stale window 0 s)', () => {
    it('role permissions edited (RolesService.update)', async () => {
      const w = await ws();
      expect(await canA(w)).toBe(true);
      expect(await canB(w)).toBe(true); // both processes have filled the cache
      await w.as(async () =>
        roles.update(w.sales.uuid, {
          grants: [],
          rowVersion: await rowVersion('roles', w.orgId, w.sales.id),
        }),
      );
      expect(await canA(w)).toBe(false);
      expect(await canB(w)).toBe(false);
    });

    it('member given another role (UsersService.update roleIds)', async () => {
      const w = await ws();
      expect(await canA(w)).toBe(true);
      expect(await canB(w)).toBe(true);
      await w.as(async () =>
        users.update(w.target.uuid, {
          roleIds: [w.noAccess.uuid],
          rowVersion: await rowVersion('users', w.orgId, w.target.id),
        }),
      );
      expect(await canA(w)).toBe(false);
      expect(await canB(w)).toBe(false);
    });

    it('member role changed from the Members screen (MembersService.changeRole)', async () => {
      const w = await ws();
      expect(await canA(w)).toBe(true);
      expect(await canB(w)).toBe(true);
      await w.as(async () =>
        members.changeRole(w.target.uuid, {
          roleId: w.noAccess.uuid,
          rowVersion: await rowVersion('users', w.orgId, w.target.id),
        }),
      );
      expect(await canA(w)).toBe(false);
      expect(await canB(w)).toBe(false);
    });

    it('member removed (MembersService.remove): grants gone and the account gate says suspended, on both processes', async () => {
      const w = await ws();
      expect(await canA(w)).toBe(true);
      expect(await canB(w)).toBe(true);
      expect((await a.gates.stateFor(w.orgId, w.target.id)).suspended).toBe(false);
      expect(
        (await b.call<{ suspended: boolean }>('gate.state', w.orgId, w.target.id)).suspended,
      ).toBe(false);
      await w.as(() => members.remove(w.target.uuid));
      expect(await canA(w)).toBe(false);
      expect(await canB(w)).toBe(false);
      expect((await a.gates.stateFor(w.orgId, w.target.id)).suspended).toBe(true);
      expect(
        (await b.call<{ suspended: boolean }>('gate.state', w.orgId, w.target.id)).suspended,
      ).toBe(true);
    });

    it('role deleted (RolesService.remove) raises the version, in Postgres and in Redis', async () => {
      const w = await ws();
      await canA(w);
      const before = Number((await env.admin.get(`rbac:version:${w.orgId}`)) ?? 0);
      await w.as(() => roles.remove(w.noAccess.uuid));
      const db = Number(
        (await env.pg.owner.query(`SELECT roles_version FROM organizations WHERE id=$1`, [w.orgId]))
          .rows[0].roles_version,
      );
      expect(db).toBeGreaterThan(before);
      expect(Number(await env.admin.get(`rbac:version:${w.orgId}`))).toBe(db);
    });
  });

  describe('account gate (30 s copy, dropped by every writer that knows)', () => {
    it('member suspended (UsersService.update status inactive): gate says suspended at once on both processes', async () => {
      const w = await ws();
      expect((await a.gates.stateFor(w.orgId, w.target.id)).suspended).toBe(false);
      expect(
        (await b.call<{ suspended: boolean }>('gate.state', w.orgId, w.target.id)).suspended,
      ).toBe(false);
      await w.as(async () =>
        users.update(w.target.uuid, {
          status: 'inactive',
          rowVersion: await rowVersion('users', w.orgId, w.target.id),
        }),
      );
      expect((await a.gates.stateFor(w.orgId, w.target.id)).suspended).toBe(true);
      expect(
        (await b.call<{ suspended: boolean }>('gate.state', w.orgId, w.target.id)).suspended,
      ).toBe(true);
    });

    it('member re-activated (UsersService.update status active): gate lets them in at once (defect D3: it kept saying suspended for 30 s)', async () => {
      const w = await ws();
      await env.pg.owner.query(`UPDATE users SET status='inactive' WHERE org_id=$1 AND id=$2`, [
        w.orgId,
        w.target.id,
      ]);
      expect((await a.gates.stateFor(w.orgId, w.target.id)).suspended).toBe(true); // cached for 30 s
      await w.as(async () =>
        users.update(w.target.uuid, {
          status: 'active',
          rowVersion: await rowVersion('users', w.orgId, w.target.id),
        }),
      );
      expect((await a.gates.stateFor(w.orgId, w.target.id)).suspended).toBe(false);
      expect(
        (await b.call<{ suspended: boolean }>('gate.state', w.orgId, w.target.id)).suspended,
      ).toBe(false);
    });

    it('a writer that does NOT call invalidate (direct SQL, a CLI, a migration): fresh within the 30 s TTL, measured', async () => {
      const w = await ws();
      expect((await a.gates.stateFor(w.orgId, w.target.id)).passwordChangeRequired).toBe(false);
      await env.pg.owner.query(
        `UPDATE user_security SET force_password_change=true WHERE org_id=$1 AND user_id=$2`,
        [w.orgId, w.target.id],
      );
      const s = await secondsUntil(
        async () => (await a.gates.stateFor(w.orgId, w.target.id)).passwordChangeRequired,
        true,
        40,
        250,
      );
      expect(s).toBeLessThanOrEqual(30.5);
      record('R04 account gate, writer without invalidate', {
        measuredStaleSeconds: s,
        documentedSeconds: 30,
      });
    }, 60_000);

    it('password change / email verified / MFA flip: the writer drops the entry, every process is fresh at once', async () => {
      const w = await ws();
      expect(
        (await b.call<{ passwordChangeRequired: boolean }>('gate.state', w.orgId, w.target.id))
          .passwordChangeRequired,
      ).toBe(false);
      await env.pg.owner.query(
        `UPDATE user_security SET force_password_change=true WHERE org_id=$1 AND user_id=$2`,
        [w.orgId, w.target.id],
      );
      await a.gates.invalidate(w.orgId, w.target.id); // what account/recovery/mfa/login services do after the write
      expect(
        (await b.call<{ passwordChangeRequired: boolean }>('gate.state', w.orgId, w.target.id))
          .passwordChangeRequired,
      ).toBe(true);
    });

    it('policy change (security.policy requires MFA for all): invalidateAll reaches every cached user at once', async () => {
      const w = await ws();
      const w2 = await ws();
      for (const x of [w, w2])
        expect((await a.gates.stateFor(x.orgId, x.target.id)).mfaEnrolmentRequired).toBe(false);
      await a.settings.mergeDocument('security.policy', { requireMfaForAll: true }, null);
      await b.call('settings.set', 'ci66.nudge', 1); // B's snapshot refresh is not needed for A; A wrote it
      await a.gates.invalidateAll();
      for (const x of [w, w2])
        expect((await a.gates.stateFor(x.orgId, x.target.id)).mfaEnrolmentRequired).toBe(true);
      await a.settings.mergeDocument('security.policy', { requireMfaForAll: false }, null);
      await a.gates.invalidateAll();
    });
  });

  describe('workspace suspension verdict (5 s copy)', () => {
    const suspend = (orgId: number, on: boolean) =>
      env.pg.owner.query(`UPDATE organizations SET status=$2 WHERE id=$1`, [
        orgId,
        on ? 'suspended' : 'active',
      ]);

    it('suspended and then restored by the platform inbox: invalidate() makes both processes fresh at once', async () => {
      const w = await ws();
      expect(await a.orgs.isSuspended(w.orgId)).toBe(false);
      expect(await b.call('org.suspended', w.orgId)).toBe(false);
      await suspend(w.orgId, true);
      await a.orgs.invalidate(w.orgId); // PlatformInboxService.syncStatus
      expect(await a.orgs.isSuspended(w.orgId)).toBe(true);
      expect(await b.call('org.suspended', w.orgId)).toBe(true);
      await suspend(w.orgId, false);
      await a.orgs.invalidate(w.orgId);
      expect(await a.orgs.isSuspended(w.orgId)).toBe(false);
      expect(await b.call('org.suspended', w.orgId)).toBe(false);
    });

    it('a writer that does not invalidate (direct SQL): fresh within the 5 s TTL, measured', async () => {
      const w = await ws();
      expect(await a.orgs.isSuspended(w.orgId)).toBe(false);
      await suspend(w.orgId, true);
      const s = await secondsUntil(() => a.orgs.isSuspended(w.orgId), true, 8);
      expect(s).toBeLessThanOrEqual(5.5);
      record('R05 workspace suspension verdict, writer without invalidate', {
        measuredStaleSeconds: s,
        documentedSeconds: 5,
      });
    });

    it('workspace closed (status deleted): the suspension verdict stays false by design; sign-in and refresh read the status itself', async () => {
      const w = await ws();
      await env.pg.owner.query(
        `UPDATE organizations SET status='deleted', deleted_at=now() WHERE id=$1`,
        [w.orgId],
      );
      await a.orgs.invalidate(w.orgId);
      expect(await a.orgs.isSuspended(w.orgId)).toBe(false);
    });
  });

  describe('partner agent flag (R-64-02)', () => {
    it('no API route changes partner_agents.status, so no caller of invalidate() exists to wire (see the ratchet); a direct change is fresh within 30 s, measured', async () => {
      const w = await ws();
      const agent = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO partner_agents (org_id,code,name,email) VALUES ($1,$2,'P',$3) RETURNING id`,
            [w.orgId, randomBytes(3).toString('hex'), `p-${w.orgId}@x.test`],
          )
        ).rows[0].id,
      );
      expect(await a.partner.isActive(w.orgId, agent)).toBe(true);
      await env.pg.owner.query(
        `UPDATE partner_agents SET status='suspended' WHERE org_id=$1 AND id=$2`,
        [w.orgId, agent],
      );
      const s = await secondsUntil(() => a.partner.isActive(w.orgId, agent), false, 40, 250);
      expect(s).toBeLessThanOrEqual(30.5);
      record('R06 partner agent flag, writer without invalidate', {
        measuredStaleSeconds: s,
        documentedSeconds: 30,
      });
    }, 60_000);

    it('a writer that calls invalidate() (the day one exists) is fresh at once on every process', async () => {
      const w = await ws();
      const agent = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO partner_agents (org_id,code,name,email) VALUES ($1,$2,'P',$3) RETURNING id`,
            [w.orgId, randomBytes(3).toString('hex'), `q-${w.orgId}@x.test`],
          )
        ).rows[0].id,
      );
      expect(await b.call('partner.active', w.orgId, agent)).toBe(true);
      await env.pg.owner.query(
        `UPDATE partner_agents SET status='suspended' WHERE org_id=$1 AND id=$2`,
        [w.orgId, agent],
      );
      await a.partner.invalidate(w.orgId, agent);
      expect(await b.call('partner.active', w.orgId, agent)).toBe(false);
    });
  });
});
