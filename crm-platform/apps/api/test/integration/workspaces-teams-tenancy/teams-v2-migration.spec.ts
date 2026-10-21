import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * Teams v2 migrations (20270210090000_teams_v2_schema, 20270210090100_teams_v2_permissions) against real Postgres, applied on top of
 * a database that already holds teams, members and roles: the chain BEFORE them is applied first, rows are created the way the old
 * schema allowed (`team_members.is_lead`, no primary team, `inbox.team.manage` on a custom role), then the two migrations run and
 * the backfills are read back. Forced RLS and the composite foreign keys must survive.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const FIRST_TEAMS_V2 = '20270210090000';

describe('teams v2 migrations: backfills, guards and the permission rollout', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let before: string;
  const ids: Record<string, number> = {};

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

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

    // The chain up to the migration before Teams v2.
    before = mkdtempSync(join(tmpdir(), 'teams-v2-before-'));
    for (const f of readdirSync(MIGRATIONS)) {
      if (f.endsWith('.sql') && f.slice(0, 14) < FIRST_TEAMS_V2)
        cpSync(join(MIGRATIONS, f), join(before, f));
    }
    await runMigrations(container.getConnectionUri(), { dir: before, log: () => undefined });

    // Old-shaped data.
    const org = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('t2v','t2v','starter') RETURNING id`,
    );
    ids.org = org;
    await owner.query(`SELECT provision_workspace_presets($1)`, [org]);
    const user = (key: string) =>
      one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,$3,'x') RETURNING id`,
        [org, `${key}@t2v.test`, key],
      ).then((id) => (ids[key] = id));
    for (const k of ['solo', 'multi', 'nobody', 'co1', 'co2']) await user(k);
    const team = (key: string, name: string) =>
      one(`INSERT INTO teams (org_id, name, slug) VALUES ($1,$2,$2) RETURNING id`, [
        org,
        name,
      ]).then((id) => (ids[key] = id));
    await team('tA', 'A');
    await team('tB', 'B');
    await team('tC', 'C');
    const member = (t: string, u: string, lead = false) =>
      owner.query(
        `INSERT INTO team_members (org_id, team_id, user_id, is_lead) VALUES ($1,$2,$3,$4)`,
        [org, ids[t], ids[u], lead],
      );
    await member('tA', 'solo', true); // exactly one flagged lead: becomes the manager; solo has one team: primary
    await member('tB', 'multi'); // two teams: no primary
    await member('tC', 'multi');
    await member('tB', 'co1', true); // two flagged leads on B: no single manager
    await member('tB', 'co2', true);

    const custom = async (name: string, keys: string[]) => {
      const r = await one(`INSERT INTO roles (org_id, name) VALUES ($1,$2) RETURNING id`, [
        org,
        name,
      ]);
      for (const k of keys) {
        await owner.query(
          `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,$3,'allow','all')`,
          [org, r, k],
        );
      }
      ids[name] = r;
    };
    await custom('Legacy teams', ['inbox.team.manage']);
    await custom('Some access', ['record.contacts.read']);
    await custom('Empty', []);
    ids.versionBefore = Number(
      (await owner.query(`SELECT roles_version FROM organizations WHERE id = $1`, [org])).rows[0]
        .roles_version,
    );

    // Now Teams v2.
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
    if (before) rmSync(before, { recursive: true, force: true });
  });

  it('turns the lead flag into a role, picks the single flagged lead as manager, and keeps is_lead in sync', async () => {
    const roles = (
      await owner.query(`SELECT team_id, user_id, role FROM team_members WHERE org_id = $1`, [
        ids.org,
      ])
    ).rows.map((r) => `${r.team_id}:${r.user_id}:${r.role}`);
    expect(roles).toContain(`${ids.tA}:${ids.solo}:lead`);
    expect(roles).toContain(`${ids.tB}:${ids.multi}:member`);
    expect(roles).toContain(`${ids.tB}:${ids.co1}:lead`);
    const teams = (
      await owner.query(`SELECT id, lead_user_id FROM teams WHERE org_id = $1 ORDER BY id`, [
        ids.org,
      ])
    ).rows;
    expect(Number(teams.find((t) => Number(t.id) === ids.tA)!.lead_user_id)).toBe(ids.solo);
    expect(teams.find((t) => Number(t.id) === ids.tB)!.lead_user_id).toBeNull();
    // is_lead stays for the live slot (blue-green) and follows the role through a trigger.
    await owner.query(
      `UPDATE team_members SET is_lead = true WHERE org_id = $1 AND team_id = $2 AND user_id = $3`,
      [ids.org, ids.tC, ids.multi],
    );
    let r = (
      await owner.query(
        `SELECT role, is_lead FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [ids.tC, ids.multi],
      )
    ).rows[0];
    expect([r.role, r.is_lead]).toEqual(['lead', true]);
    await owner.query(
      `UPDATE team_members SET role = 'member' WHERE org_id = $1 AND team_id = $2 AND user_id = $3`,
      [ids.org, ids.tC, ids.multi],
    );
    r = (
      await owner.query(
        `SELECT role, is_lead FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [ids.tC, ids.multi],
      )
    ).rows[0];
    expect([r.role, r.is_lead]).toEqual(['member', false]);
  });

  it('gives a person on exactly one team that team as primary and a person on several none; the index allows one', async () => {
    const prim = (
      await owner.query(
        `SELECT user_id, team_id FROM team_members WHERE org_id = $1 AND is_primary`,
        [ids.org],
      )
    ).rows;
    const byUser = new Map(prim.map((r) => [Number(r.user_id), Number(r.team_id)]));
    expect(byUser.get(ids.solo)).toBe(ids.tA);
    expect(byUser.has(ids.multi!)).toBe(false);
    // co1 and co2 are each on B only.
    expect(byUser.get(ids.co1)).toBe(ids.tB);
    await owner.query(
      `UPDATE team_members SET is_primary = true WHERE org_id = $1 AND user_id = $2 AND team_id = $3`,
      [ids.org, ids.multi, ids.tB],
    );
    await expect(
      owner.query(
        `UPDATE team_members SET is_primary = true WHERE org_id = $1 AND user_id = $2 AND team_id = $3`,
        [ids.org, ids.multi, ids.tC],
      ),
    ).rejects.toMatchObject({ constraint: 'uq_team_members_one_primary' });
  });

  it('leaves every existing team receiving conversations and records, scope boundary on, no parent', async () => {
    const rows = (
      await owner.query(
        `SELECT receives_conversations, receives_records, is_scope_boundary, parent_team_id FROM teams WHERE org_id = $1`,
        [ids.org],
      )
    ).rows;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toEqual({
        receives_conversations: true,
        receives_records: true,
        is_scope_boundary: true,
        parent_team_id: null,
      });
    }
  });

  it('refuses a cycle and a cross-workspace parent, moves children up when a parent is deleted, and keeps rows RLS-forced', async () => {
    await owner.query(`UPDATE teams SET parent_team_id = $2 WHERE id = $1`, [ids.tB, ids.tA]);
    await owner.query(`UPDATE teams SET parent_team_id = $2 WHERE id = $1`, [ids.tC, ids.tB]);
    await expect(
      owner.query(`UPDATE teams SET parent_team_id = $2 WHERE id = $1`, [ids.tA, ids.tC]),
    ).rejects.toMatchObject({
      constraint: 'chk_teams_parent_cycle',
    });
    await expect(
      owner.query(`UPDATE teams SET parent_team_id = id WHERE id = $1`, [ids.tA]),
    ).rejects.toMatchObject({
      constraint: 'chk_teams_parent_cycle',
    });
    const other = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('t2v-other','t2v-other','starter') RETURNING id`,
    );
    const foreign = await one(
      `INSERT INTO teams (org_id, name, slug) VALUES ($1,'F','f') RETURNING id`,
      [other],
    );
    await expect(
      owner.query(`UPDATE teams SET parent_team_id = $2 WHERE id = $1`, [ids.tA, foreign]),
    ).rejects.toMatchObject({ code: '23503' });

    await owner.query(`DELETE FROM teams WHERE id = $1`, [ids.tB]);
    const c = (await owner.query(`SELECT parent_team_id FROM teams WHERE id = $1`, [ids.tC]))
      .rows[0];
    expect(Number(c.parent_team_id)).toBe(ids.tA);

    const rls = (
      await owner.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('teams','team_members')`,
      )
    ).rows;
    for (const r of rls)
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });

  it('team_members policy hides the rows of an inactive user from the tenant role and still shows them to the owner', async () => {
    const app = new Client({
      connectionString: container.getConnectionUri().replace(/\/\/[^@]*@/, '//crm_app_user:test@'),
    });
    await app.connect();
    try {
      const visible = async () => {
        await app.query('BEGIN');
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(ids.org)]);
        const r = await app.query(
          `SELECT count(*)::int AS n FROM team_members WHERE user_id = $1`,
          [ids.solo],
        );
        await app.query('ROLLBACK');
        return r.rows[0].n as number;
      };
      expect(await visible()).toBe(1);
      await owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [ids.solo]);
      expect(await visible()).toBe(0);
      expect(
        Number(
          (await owner.query(`SELECT count(*) n FROM team_members WHERE user_id = $1`, [ids.solo]))
            .rows[0].n,
        ),
      ).toBe(1);
      await owner.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ids.solo]);
      expect(await visible()).toBe(1);
    } finally {
      await app.end();
    }
  });

  it('registers team.read and team.manage, rolls them out to the presets and to custom roles, and bumps the roles version', async () => {
    const defs = (
      await owner.query(
        `SELECT key, category, supports_scope FROM permission_defs WHERE key IN ('team.read','team.manage') ORDER BY key`,
      )
    ).rows;
    expect(defs).toEqual([
      { key: 'team.manage', category: 'team', supports_scope: false },
      { key: 'team.read', category: 'team', supports_scope: false },
    ]);
    const holders = async (key: string) =>
      (
        await owner.query(
          `SELECT r.name FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
           WHERE g.org_id = $1 AND g.permission_key = $2 ORDER BY r.name`,
          [ids.org, key],
        )
      ).rows.map((r) => r.name);
    expect(await holders('team.manage')).toEqual(['Admin', 'Legacy teams', 'Manager', 'Owner']);
    expect(await holders('team.read')).toEqual([
      'Admin',
      'Agent',
      'Legacy teams',
      'Manager',
      'Owner',
      'Some access',
    ]);
    const v = Number(
      (await owner.query(`SELECT roles_version FROM organizations WHERE id = $1`, [ids.org]))
        .rows[0].roles_version,
    );
    expect(v).toBeGreaterThan(ids.versionBefore!);
  });
});
