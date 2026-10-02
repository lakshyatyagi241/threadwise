import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withTenant, type DbClient } from '@crm/db';
import { memberTier } from '../../../src/modules/workspaces-teams-tenancy/member-rules';
import { MembersRepository } from '../../../src/modules/workspaces-teams-tenancy/members.repository';
import { TeamsRepository } from '../../../src/modules/workspaces-teams-tenancy/teams.repository';

/**
 * Migration 20261013090000_wsp_members_teams against real Postgres, in two passes: everything BEFORE it is applied and
 * organizations are arranged the way an installation that predates it looks (a locked Admin preset, no owner recorded, an
 * organization with its own role called Manager), then the migration runs over them. After that the members and teams
 * repositories are exercised as the restricted application role, because a superuser would bypass every policy.
 */
const MIGRATION = '20261013090000_wsp_members_teams.sql';
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const NEW_KEYS = [
  'member.invite',
  'member.role.assign',
  'team.manage',
  'workspace.settings',
  'workspace.export',
];

describe('wsp members and teams: migration, role presets, isolation and the repositories', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let client: DbClient;
  const members = new MembersRepository();
  const teams = new TeamsRepository();

  // organizations that exist before the migration
  let legacy: number; // locked Admin, two admins, no owner recorded, no Manager/Viewer
  let custom: number; // its own roles called Manager and Viewer
  let owned: number; // owner already recorded
  let adminUserOfLegacy: number;
  let customManagerRole: number;
  // a second tenant created after the migration, for the repository tests
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

    // Pass 1: every migration but this one, so the data below looks like an installation that predates it.
    const before = mkdtempSync(join(tmpdir(), 'wsp-mig-'));
    for (const f of readdirSync(MIGRATIONS)) {
      if (f === MIGRATION) continue;
      symlinkSync(join(MIGRATIONS, f), join(before, f));
    }
    await runMigrations(container.getConnectionUri(), { dir: before, log: () => undefined });

    legacy = await org('legacy');
    custom = await org('custom');
    owned = await org('owned');
    for (const o of [legacy, custom, owned]) {
      // The Admin preset is created unlocked so a grant can be added, then locked, as provisioning does.
      const admin = await role(o, 'Admin', 'admin');
      await owner.query(
        `INSERT INTO role_grants (org_id, role_id, permission_key) VALUES ($1,$2,'record.contacts.read')`,
        [o, admin],
      );
      await owner.query(`UPDATE roles SET is_locked = true WHERE id = $1 AND org_id = $2`, [
        admin,
        o,
      ]);
      ids[`admin-${o}`] = admin;
    }
    adminUserOfLegacy = await user(legacy, 'first@legacy.test', 'First');
    await give(legacy, adminUserOfLegacy, ids[`admin-${legacy}`]!);
    const second = await user(legacy, 'second@legacy.test', 'Second');
    await give(legacy, second, ids[`admin-${legacy}`]!);
    await owner.query(`UPDATE users SET created_at = now() + interval '1 day' WHERE id = $1`, [
      second,
    ]);
    const ownedUser = await user(owned, 'o@owned.test', 'Owned');
    await give(owned, ownedUser, ids[`admin-${owned}`]!);
    uuids.ownedUser = (
      await owner.query(`SELECT uuid FROM users WHERE id = $1`, [ownedUser])
    ).rows[0].uuid;
    await owner.query(`UPDATE organizations SET settings = $2::jsonb WHERE id = $1`, [
      owned,
      JSON.stringify({ ownerUserId: '11111111-1111-4111-8111-111111111111' }),
    ]);
    customManagerRole = await role(custom, 'Manager');
    await owner.query(
      `INSERT INTO role_grants (org_id, role_id, permission_key) VALUES ($1,$2,'record.tags.read')`,
      [custom, customManagerRole],
    );
    await role(custom, 'Viewer');
    const versionBefore = Number(
      (await owner.query(`SELECT roles_version FROM organizations WHERE id = $1`, [legacy])).rows[0]
        .roles_version,
    );
    uuids.versionBefore = String(versionBefore);

    // Pass 2: the real directory; only the new migration is pending.
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });

    // Tenants for the repository tests, created through the function a new organization goes through.
    orgA = await org('tenant-a');
    orgB = await org('tenant-b');
    for (const o of [orgA, orgB]) {
      await owner.query(`SELECT wsp_seed_role_presets($1)`, [o]);
      await role(o, 'Agent');
      await role(o, 'Counsellor');
      ids[`admin-${o}`] = await role(o, 'Admin', 'admin');
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
    await add('owner', orgA, 'owner@a.test', 'Zed Owner', 'Admin');
    await add('adminB', orgA, 'bea@a.test', 'Bea Admin', 'Admin');
    await add('adminA', orgA, 'ann@a.test', 'ann Admin', 'Admin');
    await add('manager', orgA, 'mo@a.test', 'Mo Manager', 'Manager');
    await add('agent', orgA, 'riya@a.test', 'Riya Agent', 'Agent');
    await add('custom', orgA, 'sam@a.test', 'Sam Counsellor', 'Counsellor');
    await add('viewer', orgA, 'vi@a.test', 'Vi Viewer', 'Viewer');
    await add('pending', orgA, 'pen@a.test', 'Pen Ding', 'Agent', `invited_at=now()`);
    await add('removed', orgA, 'gone@a.test', 'Gone Person', null, `status='inactive'`);
    await add('norole', orgA, 'none@a.test', 'No Role', null);
    await add('b', orgB, 'bob@b.test', 'Bob B', 'Admin');
    await owner.query(`UPDATE organizations SET settings = $2::jsonb WHERE id = $1`, [
      orgA,
      JSON.stringify({ ownerUserId: uuids.owner }),
    ]);

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
  const grants = async (roleId: number) =>
    (
      await owner.query(
        `SELECT permission_key, effect::text, record_scope::text FROM role_grants WHERE role_id = $1 ORDER BY permission_key`,
        [roleId],
      )
    ).rows as Array<{ permission_key: string; effect: string; record_scope: string }>;

  describe('the migration over an installation that predates it', () => {
    it('registers the five workspace capability keys, none of them scope-aware', async () => {
      const res = await owner.query(
        `SELECT key, category, supports_scope FROM permission_defs WHERE key = ANY($1) ORDER BY key`,
        [NEW_KEYS],
      );
      expect(res.rows.map((r) => r.key).sort()).toEqual([...NEW_KEYS].sort());
      for (const r of res.rows) {
        expect(r.category).toBe('workspace');
        expect(r.supports_scope).toBe(false);
      }
    });

    it('grants the five keys to every existing locked Admin preset and leaves it locked', async () => {
      for (const o of [legacy, custom, owned]) {
        const res = await owner.query(
          `SELECT is_locked, (SELECT count(*)::int FROM role_grants g WHERE g.org_id = r.org_id AND g.role_id = r.id AND g.permission_key = ANY($2)) AS n
           FROM roles r WHERE r.org_id = $1 AND r.system_key = 'admin'`,
          [o, NEW_KEYS],
        );
        expect(res.rows[0]).toEqual({ is_locked: true, n: 5 });
      }
    });

    it('creates the Manager (manager) and Viewer (readonly) presets for every organization, unlocked', async () => {
      for (const o of [legacy, owned]) {
        const res = await owner.query(
          `SELECT name, system_key, is_locked FROM roles WHERE org_id = $1 AND system_key IN ('manager','readonly') ORDER BY system_key`,
          [o],
        );
        expect(res.rows).toEqual([
          { name: 'Manager', system_key: 'manager', is_locked: false },
          { name: 'Viewer', system_key: 'readonly', is_locked: false },
        ]);
      }
    });

    it("adopts an organization's own role called Manager or Viewer (only the key is set) instead of clashing on the name", async () => {
      const res = await owner.query(
        `SELECT name, system_key FROM roles WHERE org_id = $1 AND name IN ('Manager','Viewer') ORDER BY name`,
        [custom],
      );
      expect(res.rows).toEqual([
        { name: 'Manager', system_key: 'manager' },
        { name: 'Viewer', system_key: 'readonly' },
      ]);
      // Its own grants are untouched: one grant, not the preset's.
      expect((await grants(customManagerRole)).map((g) => g.permission_key)).toEqual([
        'record.tags.read',
      ]);
      // The Viewer it already had was an empty role and stays one: rewriting an admin's role would be worse than a label.
      const viewer = await one(`SELECT id FROM roles WHERE org_id = $1 AND name = 'Viewer'`, [
        custom,
      ]);
      expect(await grants(viewer)).toHaveLength(0);
    });

    it('gives the Manager preset record scope all on the Agent set plus delete, the inbox and the dashboards, and no member, team or workspace key', async () => {
      const manager = await one(
        `SELECT id FROM roles WHERE org_id = $1 AND system_key = 'manager'`,
        [legacy],
      );
      const g = await grants(manager);
      const keys = g.map((x) => x.permission_key);
      expect(g.every((x) => x.effect === 'allow' && x.record_scope === 'all')).toBe(true);
      for (const k of [
        'record.contacts.read',
        'record.contacts.update',
        'record.contacts.delete',
        'record.deals.read',
        'record.deals.delete',
        'record.tasks.delete',
        'record.appointments.update',
        'record.invoices.read',
        'record.payments.read',
        'record.sales-docs.send',
        'inbox.conversation.read',
        'inbox.conversation.reply',
        'inbox.conversation.assign',
        'inbox.conversation.resolve',
        'dash.dashboard.read',
        'dash.analytics.read',
      ]) {
        expect(keys, k).toContain(k);
      }
      for (const k of keys) {
        expect(
          k.startsWith('member.') ||
            k === 'team.manage' ||
            k.startsWith('workspace.') ||
            k.startsWith('admin.'),
          k,
        ).toBe(false);
      }
      // Everything the stock Agent preset can do, a Manager can do.
      const agentKeys = [
        'record.contacts.read',
        'record.contacts.create',
        'record.contacts.update',
        'inbox.conversation.read',
        'inbox.conversation.reply',
        'record.deals.read',
        'record.deals.create',
        'record.deals.update',
        'record.pipelines.read',
        'record.tasks.read',
        'record.tasks.create',
        'record.tasks.update',
        'record.segments.read',
        'record.segments.create',
        'record.sales-docs.read',
        'record.invoices.read',
        'record.payments.read',
        'record.tax-rates.read',
        'record.booking-types.read',
        'record.appointments.read',
        'record.appointments.create',
      ];
      for (const k of agentKeys) expect(keys, k).toContain(k);
    });

    it('gives the Viewer preset every record read key and the inbox read key, scope all, and nothing that writes', async () => {
      const viewer = await one(
        `SELECT id FROM roles WHERE org_id = $1 AND system_key = 'readonly'`,
        [legacy],
      );
      const keys = (await grants(viewer)).map((x) => x.permission_key);
      const expected = (
        await owner.query(
          `SELECT key FROM permission_defs WHERE key LIKE 'record.%.read' OR key = 'inbox.conversation.read' ORDER BY key`,
        )
      ).rows.map((r) => r.key);
      expect(keys).toEqual(expected);
      expect(keys.length).toBeGreaterThan(10);
      expect(
        (await grants(viewer)).every((x) => x.effect === 'allow' && x.record_scope === 'all'),
      ).toBe(true);
    });

    it('is idempotent: running the preset function again changes nothing', async () => {
      const count = async () =>
        Number(
          (
            await owner.query(
              `SELECT (SELECT count(*) FROM roles) + (SELECT count(*) FROM role_grants) AS n`,
            )
          ).rows[0].n,
        );
      const before = await count();
      for (const o of [legacy, custom, owned])
        await owner.query(`SELECT wsp_seed_role_presets($1)`, [o]);
      expect(await count()).toBe(before);
    });

    it('records the earliest Admin as owner where none was recorded, and leaves a recorded owner alone', async () => {
      const read = async (o: number) =>
        (
          await owner.query(
            `SELECT settings ->> 'ownerUserId' AS owner FROM organizations WHERE id = $1`,
            [o],
          )
        ).rows[0].owner;
      const firstUuid = (
        await owner.query(`SELECT uuid FROM users WHERE id = $1`, [adminUserOfLegacy])
      ).rows[0].uuid;
      expect(await read(legacy)).toBe(firstUuid);
      expect(await read(owned)).toBe('11111111-1111-4111-8111-111111111111');
      expect(await read(custom)).toBeNull();
    });

    it('widens the one-time token kinds to include invite and still refuses unknown kinds', async () => {
      const u = adminUserOfLegacy;
      await owner.query(
        `INSERT INTO user_tokens (org_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'invite','h1', now() + interval '1 day')`,
        [legacy, u],
      );
      await expect(
        owner.query(
          `INSERT INTO user_tokens (org_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'bogus','h2', now() + interval '1 day')`,
          [legacy, u],
        ),
      ).rejects.toThrow(/chk_user_tokens_kind/);
    });

    it('bumps the roles version so cached grant sets are rebuilt', async () => {
      const now = Number(
        (await owner.query(`SELECT roles_version FROM organizations WHERE id = $1`, [legacy]))
          .rows[0].roles_version,
      );
      expect(now).toBeGreaterThan(Number(uuids.versionBefore));
    });
  });

  describe('the members repository (restricted role, tenant transaction)', () => {
    it('lists everyone but the removed, owner first, then admin, manager, agent, custom, viewer, each by name', async () => {
      const page = await inA<Awaited<ReturnType<MembersRepository['list']>>>(async (tx) =>
        members.list(tx, orgA, uuids.owner!, { limit: 50 }),
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
          members.list(tx, orgA, uuids.owner!, { limit: 2, cursor }),
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
      const list = (f: Parameters<MembersRepository['list']>[3]) =>
        inA<Awaited<ReturnType<MembersRepository['list']>>>(async (tx) =>
          members.list(tx, orgA, uuids.owner!, f),
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
        const page = await members.list(tx, orgA, uuids.owner!, { limit: 50 });
        const roles = await members.rolesForUsers(
          tx,
          orgA,
          page.rows.map((r) => r.id),
        );
        for (const row of page.rows) {
          const mine = roles
            .filter((r) => r.userId === row.id)
            .map((r) => ({ systemKey: r.systemKey, name: r.roleName }));
          expect(memberTier(row.tier === 'owner', mine), row.fullName).toBe(row.tier);
        }
      });
    });

    it('counts members per tier, pending separately, and seats as everyone not removed', async () => {
      await inA(async (tx) => {
        const { byTier, pending } = await members.tierCounts(tx, orgA, uuids.owner!);
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
        const all = await members.list(tx, orgA, uuids.owner!, { limit: 200 });
        expect(all.rows.some((r) => r.email.endsWith('@b.test'))).toBe(false);
        expect(await members.byUuid(tx, orgA, uuids.owner!, uuids.b!)).toBeUndefined();
        expect(await members.userByEmail(tx, orgA, 'bob@b.test')).toBeUndefined();
        expect(await members.byId(tx, orgA, uuids.owner!, ids.b!)).toBeUndefined();
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
        const v = (await members.byId(tx, orgA, uuids.owner!, ids.manager!))!.rowVersion;
        expect(await members.touchWithVersion(tx, orgA, ids.manager!, v + 5)).toBe(false);
        expect(await members.touchWithVersion(tx, orgA, ids.manager!, v)).toBe(true);
        expect((await members.byId(tx, orgA, uuids.owner!, ids.manager!))!.rowVersion).toBe(v + 1);
      });
    });
  });

  describe('the teams repository and tenant isolation', () => {
    it("keeps a kept member's lead flag and capacity when the member list is replaced, and drops the rest", async () => {
      const team = await one(
        `INSERT INTO teams (org_id, name, slug) VALUES ($1,'Sales','sales-1') RETURNING id`,
        [orgA],
      );
      await owner.query(
        `INSERT INTO team_members (org_id, team_id, user_id, is_lead, capacity) VALUES ($1,$2,$3,true,7),($1,$2,$4,false,20)`,
        [orgA, team, ids.agent, ids.viewer],
      );
      await inA(async (tx) => {
        await teams.syncMembers(tx, orgA, team, [ids.agent!, ids.manager!]);
        const rows = await teams.members(tx, orgA, [team]);
        expect(rows.map((r) => [r.fullName, r.isLead, r.capacity])).toEqual([
          ['Mo Manager', false, 20],
          ['Riya Agent', true, 7],
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
