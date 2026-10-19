import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withTenant, type DbClient } from '@crm/db';
import { tierOfRole } from '../../../src/modules/workspaces-teams-tenancy/member-rules';
import { MembersRepository } from '../../../src/modules/workspaces-teams-tenancy/members.repository';
import { TeamsRepository } from '../../../src/modules/workspaces-teams-tenancy/teams.repository';

/**
 * Migration 20261013110000_wsp_members_teams against real Postgres, on top of the RBAC workspace presets it depends on: the
 * whole chain is applied, organizations are provisioned the way sign-up does (`provision_workspace_presets`), and the members and
 * teams repositories are exercised as the restricted application role, because a superuser would bypass every policy.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
/** The keys the member and team screens use are RBAC's; WSP registers none of its own. */
const RBAC_KEYS = ['org.member.invite', 'org.member.role_assign', 'inbox.team.manage'];

describe('wsp members and teams: migration, role presets, isolation and the repositories', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let client: DbClient;
  const members = new MembersRepository();
  const teams = new TeamsRepository();

  let orgA: number;
  let orgB: number;
  const ids: Record<string, number> = {};
  const uuids: Record<string, string> = {};

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  async function org(slug: string): Promise<number> {
    return one(
      `INSERT INTO organizations (slug, name, plan) VALUES ($1,$1,'starter') RETURNING id`,
      [slug],
    );
  }
  async function role(
    orgId: number,
    name: string,
    systemKey: string | null = null,
  ): Promise<number> {
    return one(`INSERT INTO roles (org_id, name, system_key) VALUES ($1,$2,$3) RETURNING id`, [
      orgId,
      name,
      systemKey,
    ]);
  }
  async function user(orgId: number, email: string, name: string, extra = ''): Promise<number> {
    return one(
      `INSERT INTO users (org_id, email, full_name, password_hash ${extra ? ', ' + extra.split('=')[0] : ''})
       VALUES ($1,$2,$3,'x' ${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING id`,
      [orgId, email, name],
    );
  }
  const give = (orgId: number, userId: number, roleId: number) =>
    owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
      orgId,
      userId,
      roleId,
    ]);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });

    // Tenants for the repository tests, created through the function a new organization goes through.
    orgA = await org('tenant-a');
    orgB = await org('tenant-b');
    for (const o of [orgA, orgB]) {
      await owner.query(`SELECT provision_workspace_presets($1)`, [o]);
      await role(o, 'Counsellor');
    }
    const roleOf = async (o: number, name: string) =>
      Number(
        (await owner.query(`SELECT id FROM roles WHERE org_id = $1 AND name = $2`, [o, name]))
          .rows[0].id,
      );

    const add = async (
      key: string,
      o: number,
      email: string,
      name: string,
      roleName: string | null,
      extra = '',
    ) => {
      ids[key] = await user(o, email, name, extra);
      uuids[key] = (
        await owner.query(`SELECT uuid FROM users WHERE id = $1`, [ids[key]])
      ).rows[0].uuid;
      if (roleName) await give(o, ids[key]!, await roleOf(o, roleName));
    };
    await add('owner', orgA, 'owner@a.test', 'Zed Owner', 'Owner');
    await add('adminB', orgA, 'bea@a.test', 'Bea Admin', 'Admin');
    await add('adminA', orgA, 'ann@a.test', 'ann Admin', 'Admin');
    await add('manager', orgA, 'mo@a.test', 'Mo Manager', 'Manager');
    await add('agent', orgA, 'riya@a.test', 'Riya Agent', 'Agent');
    await add('custom', orgA, 'sam@a.test', 'Sam Counsellor', 'Counsellor');
    await add('viewer', orgA, 'vi@a.test', 'Vi Viewer', 'Viewer');
    await add('pending', orgA, 'pen@a.test', 'Pen Ding', 'Agent', `invited_at=now()`);
    await add('removed', orgA, 'gone@a.test', 'Gone Person', null, `status='inactive'`);
    await add('norole', orgA, 'none@a.test', 'No Role', null);
    await add('b', orgB, 'bob@b.test', 'Bob B', 'Owner');

    const appUrl = `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`;
    app = new Client({ connectionString: appUrl });
    await app.connect();
    client = createDbClient({ url: appUrl, poolMax: 4 });
  }, 240_000);

  afterAll(async () => {
    await client?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  const inA = <T>(fn: Parameters<typeof withTenant>[2]) =>
    withTenant(client.db, { orgId: orgA }, fn) as Promise<T>;

  describe('the migration on top of the RBAC presets', () => {
    it('widens the one-time token kinds to include invite and still refuses unknown kinds', async () => {
      const u = ids.owner!;
      await owner.query(
        `INSERT INTO user_tokens (org_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'invite','h1', now() + interval '1 day')`,
        [orgA, u],
      );
      await expect(
        owner.query(
          `INSERT INTO user_tokens (org_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'bogus','h2', now() + interval '1 day')`,
          [orgA, u],
        ),
      ).rejects.toThrow(/chk_user_tokens_kind/);
    });

    it('uses the RBAC keys and registers none of its own', async () => {
      const res = await owner.query(`SELECT key FROM permission_defs WHERE key = ANY($1)`, [
        RBAC_KEYS,
      ]);
      expect(res.rows.map((r) => r.key).sort()).toEqual([...RBAC_KEYS].sort());
      const stale = await owner.query(`SELECT key FROM permission_defs WHERE key = ANY($1)`, [
        [
          'member.invite',
          'member.role.assign',
          'team.manage',
          'workspace.settings',
          'workspace.export',
        ],
      ]);
      expect(stale.rowCount).toBe(0);
      const fn = await owner.query(`SELECT 1 FROM pg_proc WHERE proname = 'wsp_seed_role_presets'`);
      expect(fn.rowCount).toBe(0);
    });

    it('finds the five presets on a provisioned organization: Owner is system_key admin, the rest by their own key', async () => {
      const res = await owner.query(
        `SELECT name, system_key, is_locked FROM roles WHERE org_id = $1 AND system_key IS NOT NULL ORDER BY name`,
        [orgA],
      );
      expect(res.rows).toEqual([
        { name: 'Admin', system_key: 'workspace_admin', is_locked: false },
        { name: 'Agent', system_key: 'agent', is_locked: false },
        { name: 'Manager', system_key: 'manager', is_locked: false },
        { name: 'Owner', system_key: 'admin', is_locked: true },
        { name: 'Viewer', system_key: 'viewer', is_locked: false },
      ]);
      // Each preset reads as the tier its name says; the custom role does not.
      for (const r of res.rows) {
        expect(tierOfRole({ systemKey: r.system_key }), r.name).toBe(r.name.toLowerCase());
      }
    });

    it('grants the member and team keys to the Owner and Admin presets only', async () => {
      const holders = async (key: string) =>
        (
          await owner.query(
            `SELECT r.name FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
             WHERE g.org_id = $1 AND g.permission_key = $2 AND g.effect = 'allow' ORDER BY r.name`,
            [orgA, key],
          )
        ).rows.map((x) => x.name);
      for (const key of RBAC_KEYS) expect(await holders(key), key).toEqual(['Admin', 'Owner']);
    });

    it('keeps an Owner: the last one cannot be removed from the role, a second one makes it possible', async () => {
      const ownerRole = await one(
        `SELECT id FROM roles WHERE org_id = $1 AND system_key = 'admin'`,
        [orgB],
      );
      await expect(
        owner.query(`DELETE FROM user_roles WHERE org_id = $1 AND role_id = $2`, [orgB, ownerRole]),
      ).rejects.toThrow(/at least one Owner/);
      const second = await user(orgB, 'second@b.test', 'Second Owner');
      await give(orgB, second, ownerRole);
      await owner.query(`DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2`, [orgB, ids.b]);
      await give(orgB, ids.b!, ownerRole);
      await owner.query(`DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2`, [
        orgB,
        second,
      ]);
      await owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [second]);
    });
  });

  describe('the members repository (restricted role, tenant transaction)', () => {
    it('lists everyone but the removed, owner first, then admin, manager, agent, custom, viewer, each by name', async () => {
      const page = await inA<Awaited<ReturnType<MembersRepository['list']>>>(async (tx) =>
        members.list(tx, orgA, { limit: 50 }),
      );
      expect(page.rows.map((r) => [r.fullName, r.tier])).toEqual([
        ['Zed Owner', 'owner'],
        ['ann Admin', 'admin'],
        ['Bea Admin', 'admin'],
        ['Mo Manager', 'manager'],
        ['Pen Ding', 'agent'],
        ['Riya Agent', 'agent'],
        ['No Role', 'custom'],
        ['Sam Counsellor', 'custom'],
        ['Vi Viewer', 'viewer'],
      ]);
      expect(page.hasMore).toBe(false);
    });

    it('pages with a cursor without skipping or repeating a member', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await inA<Awaited<ReturnType<MembersRepository['list']>>>(async (tx) =>
          members.list(tx, orgA, { limit: 2, cursor }),
        );
        seen.push(...page.rows.map((r) => r.fullName));
        if (!page.hasMore) break;
        cursor = page.nextCursor!;
      }
      expect(seen).toEqual([
        'Zed Owner',
        'ann Admin',
        'Bea Admin',
        'Mo Manager',
        'Pen Ding',
        'Riya Agent',
        'No Role',
        'Sam Counsellor',
        'Vi Viewer',
      ]);
    });

    it('filters by tier and by a name or email fragment, case-insensitively, treating % and _ literally', async () => {
      const list = (f: Parameters<MembersRepository['list']>[2]) =>
        inA<Awaited<ReturnType<MembersRepository['list']>>>(async (tx) =>
          members.list(tx, orgA, f),
        );
      expect((await list({ limit: 50, tier: 'agent' })).rows.map((r) => r.fullName)).toEqual([
        'Pen Ding',
        'Riya Agent',
      ]);
      expect((await list({ limit: 50, q: 'RIYA' })).rows.map((r) => r.fullName)).toEqual([
        'Riya Agent',
      ]);
      expect((await list({ limit: 50, q: 'bea@a' })).rows.map((r) => r.fullName)).toEqual([
        'Bea Admin',
      ]);
      expect((await list({ limit: 50, q: '%' })).rows).toHaveLength(0);
      expect((await list({ limit: 50, q: 'gone' })).rows).toHaveLength(0);
    });

    it("computes the same tier in SQL (list order) as the rules do from the member's roles", async () => {
      await inA(async (tx) => {
        const page = await members.list(tx, orgA, { limit: 50 });
        const roles = await members.rolesForUsers(
          tx,
          orgA,
          page.rows.map((r) => r.id),
        );
        for (const row of page.rows) {
          const mine = roles
            .filter((r) => r.userId === row.id)
            .map((r) => tierOfRole({ systemKey: r.systemKey }));
          // The highest tier among the roles, by the rank order the list sorts by.
          const order = ['viewer', 'custom', 'agent', 'manager', 'admin', 'owner'];
          const best = mine.sort((x, y) => order.indexOf(y) - order.indexOf(x))[0] ?? 'custom';
          expect(best, row.fullName).toBe(row.tier);
        }
      });
    });

    it('counts members per tier, pending separately, and seats as everyone not removed', async () => {
      await inA(async (tx) => {
        const { byTier, pending } = await members.tierCounts(tx, orgA);
        expect(Object.fromEntries(byTier)).toEqual({
          owner: 1,
          admin: 2,
          manager: 1,
          agent: 2,
          custom: 2,
          viewer: 1,
        });
        expect(pending).toBe(1);
        expect(await members.seatsUsed(tx, orgA)).toBe(9);
      });
    });

    it("never shows another organization's members, by list or by uuid", async () => {
      await inA(async (tx) => {
        const all = await members.list(tx, orgA, { limit: 200 });
        expect(all.rows.some((r) => r.email.endsWith('@b.test'))).toBe(false);
        expect(await members.byUuid(tx, orgA, uuids.b!)).toBeUndefined();
        expect(await members.userByEmail(tx, orgA, 'bob@b.test')).toBeUndefined();
        expect(await members.byId(tx, orgA, ids.b!)).toBeUndefined();
      });
    });

    it('removes access in one step: inactive, no roles, no team places, no live tokens', async () => {
      const t = await one(
        `INSERT INTO teams (org_id, name, slug) VALUES ($1,'Gone team','gone-team') RETURNING id`,
        [orgA],
      );
      await owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
        orgA,
        t,
        ids.custom,
      ]);
      await owner.query(
        `INSERT INTO user_tokens (org_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'invite','live-1', now() + interval '1 day')`,
        [orgA, ids.custom],
      );
      await inA(async (tx) => {
        await members.deactivate(tx, orgA, ids.custom!);
        await members.cancelLiveTokens(tx, orgA, ids.custom!);
      });
      const row = (await owner.query(`SELECT status FROM users WHERE id = $1`, [ids.custom]))
        .rows[0];
      expect(row.status).toBe('inactive');
      expect(
        (await owner.query(`SELECT 1 FROM user_roles WHERE user_id = $1`, [ids.custom])).rowCount,
      ).toBe(0);
      expect(
        (await owner.query(`SELECT 1 FROM team_members WHERE user_id = $1`, [ids.custom])).rowCount,
      ).toBe(0);
      expect(
        (
          await owner.query(
            `SELECT 1 FROM user_tokens WHERE user_id = $1 AND consumed_at IS NULL`,
            [ids.custom],
          )
        ).rowCount,
      ).toBe(0);
    });

    it('touches a row only while the version still matches', async () => {
      await inA(async (tx) => {
        const v = (await members.byId(tx, orgA, ids.manager!))!.rowVersion;
        expect(await members.touchWithVersion(tx, orgA, ids.manager!, v + 5)).toBe(false);
        expect(await members.touchWithVersion(tx, orgA, ids.manager!, v)).toBe(true);
        expect((await members.byId(tx, orgA, ids.manager!))!.rowVersion).toBe(v + 1);
      });
    });
  });

  describe('the teams repository and tenant isolation', () => {
    it("keeps a kept member's role and capacity when the member list is replaced, and drops the rest", async () => {
      const team = await one(
        `INSERT INTO teams (org_id, name, slug) VALUES ($1,'Sales','sales-1') RETURNING id`,
        [orgA],
      );
      await owner.query(
        `INSERT INTO team_members (org_id, team_id, user_id, role, capacity) VALUES ($1,$2,$3,'lead',7),($1,$2,$4,'member',20)`,
        [orgA, team, ids.agent, ids.viewer],
      );
      await inA(async (tx) => {
        await teams.syncMembers(tx, orgA, team, [ids.agent!, ids.manager!]);
        const rows = await teams.members(tx, orgA, [team]);
        expect(rows.map((r) => [r.fullName, r.role, r.capacity])).toEqual([
          ['Mo Manager', 'member', 20],
          ['Riya Agent', 'lead', 7],
        ]);
        await teams.syncMembers(tx, orgA, team, []);
        expect(await teams.members(tx, orgA, [team])).toHaveLength(0);
      });
    });

    it('resolves only active members of this organization and only devices of this organization', async () => {
      const deviceA = await one(
        `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1,'A line','+911') RETURNING id`,
        [orgA],
      );
      const deviceB = await one(
        `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1,'B line','+912') RETURNING id`,
        [orgB],
      );
      const du = async (id: number) =>
        (await owner.query(`SELECT uuid FROM devices WHERE id = $1`, [id])).rows[0].uuid as string;
      await inA(async (tx) => {
        const users = await teams.activeUserIds(tx, orgA, [
          uuids.agent!,
          uuids.b!,
          uuids.removed!,
          uuids.pending!,
        ]);
        expect([...users.keys()].sort()).toEqual([uuids.agent!, uuids.pending!].sort());
        const devices = await teams.existingDeviceUuids(tx, orgA, [
          await du(deviceA),
          await du(deviceB),
        ]);
        expect([...devices]).toEqual([await du(deviceA)]);
      });
    });

    it('pages teams with a cursor in either order and finds them by name fragment', async () => {
      await owner.query(`DELETE FROM teams WHERE org_id = $1`, [orgA]);
      for (const n of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
        await owner.query(`INSERT INTO teams (org_id, name, slug) VALUES ($1,$2,$3)`, [
          orgA,
          n,
          n.toLowerCase(),
        ]);
      }
      await inA(async (tx) => {
        const first = await teams.list(tx, orgA, { limit: 2, order: 'asc' });
        expect(first.map((t) => t.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
        const next = await teams.list(tx, orgA, {
          limit: 2,
          order: 'asc',
          cursor: Buffer.from(`${first[1]!.createdAtIso}|${first[1]!.id}`).toString('base64url'),
        });
        expect(next.map((t) => t.name)).toEqual(['Gamma', 'Delta']);
        expect(
          (await teams.list(tx, orgA, { limit: 10, order: 'desc', q: 'AMM' })).map((t) => t.name),
        ).toEqual(['Gamma']);
      });
    });

    it('enforces one team name per organization but lets two organizations share it', async () => {
      await owner.query(
        `INSERT INTO teams (org_id, name, slug) VALUES ($1,'Support','support-1')`,
        [orgA],
      );
      await expect(
        owner.query(`INSERT INTO teams (org_id, name, slug) VALUES ($1,'Support','support-2')`, [
          orgA,
        ]),
      ).rejects.toThrow(/teams_org_id_name_key/);
      await owner.query(
        `INSERT INTO teams (org_id, name, slug) VALUES ($1,'Support','support-1')`,
        [orgB],
      );
    });

    it('refuses a team place for a user of another organization (composite foreign key)', async () => {
      const team = await one(
        `INSERT INTO teams (org_id, name, slug) VALUES ($1,'Cross','cross-1') RETURNING id`,
        [orgA],
      );
      await expect(
        owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
          orgA,
          team,
          ids.b,
        ]),
      ).rejects.toThrow(/team_members_org_id_user_id_fkey/);
    });

    it("lets the restricted role see only its own tenant's teams, members, roles and tokens, and write nothing across", async () => {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgB)]);
        expect((await app.query(`SELECT 1 FROM teams WHERE org_id = $1`, [orgA])).rowCount).toBe(0);
        expect((await app.query(`SELECT 1 FROM users WHERE org_id = $1`, [orgA])).rowCount).toBe(0);
        expect((await app.query(`SELECT 1 FROM roles WHERE org_id = $1`, [orgA])).rowCount).toBe(0);
        expect(
          (await app.query(`SELECT 1 FROM user_tokens WHERE org_id = $1`, [orgA])).rowCount,
        ).toBe(0);
        await expect(
          app.query(`INSERT INTO teams (org_id, name, slug) VALUES ($1,'Smuggled','smuggled')`, [
            orgA,
          ]),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });
});
