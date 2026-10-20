import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
import {
  OwningTeamBackfillService,
  OWNING_TEAM_TABLES,
} from '../../../src/modules/workspaces-teams-tenancy/owning-team-backfill.jobs';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import {
  formatReport,
  runReport,
} from '../../../src/modules/team-inbox-conversations/cli/unassigned-visibility-report';

/**
 * BL-382 (teams T2) migrations against real Postgres, applied on top of a database that already holds workspaces, roles, teams, records:
 * the chain BEFORE them is applied first, rows are created the way the old schema allowed, then 20270225* run and are read back.
 *
 *   - `record_scope` gains `team_and_below`
 *   - `inbox.conversation.read_unassigned` reaches exactly the roles that read conversations at scope `team`, nobody else, and bumps the
 *     roles version (a person who saw the unassigned queue before still does)
 *   - `owning_team_id`: the trigger stamps on insert and on owner change, clears with the owner, leaves a person without a primary team
 *     unstamped; the back-fill stamps what predates the column without moving updated_at or row_version; deleting a team clears the column
 *     and keeps the record; a team of another workspace is refused by the composite foreign key
 *
 * With TEST_PG_ADMIN_URL (an owner-role URL of the shared dev server) the spec creates and drops its own database there; without it a
 * container is started.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const FIRST_T2 = '20270225090000';

describe('teams T2 migrations: scope value, unassigned permission, owning team', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let dropDb: (() => Promise<void>) | undefined;
  let owner: Client;
  let before: string;
  const ids: Record<string, number> = {};

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  beforeAll(async () => {
    const admin = process.env.TEST_PG_ADMIN_URL;
    let uri: string;
    if (admin) {
      const name = `it_t2_${randomBytes(5).toString('hex')}`;
      const a = new Client({ connectionString: admin });
      await a.connect();
      await a.query(`CREATE DATABASE ${name}`);
      await a.end();
      const u = new URL(admin);
      u.pathname = `/${name}`;
      uri = u.toString();
      dropDb = async () => {
        const d = new Client({ connectionString: admin });
        await d.connect();
        await d.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await d.end();
      };
    } else {
      container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
        .withDatabase('crm')
        .withUsername('crm')
        .withPassword('crm')
        .start();
      uri = container.getConnectionUri();
    }
    owner = new Client({ connectionString: uri });
    await owner.connect();

    // The chain up to the migration before T2.
    before = mkdtempSync(join(tmpdir(), 'teams-t2-before-'));
    for (const f of readdirSync(MIGRATIONS)) {
      if (f.endsWith('.sql') && f.slice(0, 14) < FIRST_T2)
        cpSync(join(MIGRATIONS, f), join(before, f));
    }
    await runMigrations(uri, { dir: before, log: () => undefined });
    await owner.query(`SELECT set_config('app.privileged', 'on', false)`);

    // Old-shaped data: two workspaces.
    const org = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('t2a','t2a','starter') RETURNING id`,
    );
    const org2 = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('t2b','t2b','starter') RETURNING id`,
    );
    ids.org = org;
    ids.org2 = org2;
    await owner.query(`SELECT provision_workspace_presets($1)`, [org]);
    await owner.query(`SELECT provision_workspace_presets($1)`, [org2]);
    const user = (o: number, key: string) =>
      one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,$3,'x') RETURNING id`,
        [o, `${key}@t2.test`, key],
      ).then((id) => (ids[key] = id));
    for (const k of ['solo', 'multi', 'nobody', 'mover']) await user(org, k);
    await user(org2, 'other');
    const team = (o: number, key: string) =>
      one(`INSERT INTO teams (org_id, name, slug) VALUES ($1,$2,$2) RETURNING id`, [o, key]).then(
        (id) => (ids[key] = id),
      );
    await team(org, 'tA');
    await team(org, 'tB');
    await team(org, 'tC');
    await team(org2, 'tX');
    const member = (o: number, t: string, u: string, primary = false) =>
      owner.query(
        `INSERT INTO team_members (org_id, team_id, user_id, is_primary) VALUES ($1,$2,$3,$4)`,
        [o, ids[t], ids[u], primary],
      );
    await member(org, 'tA', 'solo', true);
    await member(org, 'tB', 'multi'); // two teams, no primary
    await member(org, 'tC', 'multi');
    await member(org, 'tB', 'mover', true);

    // Roles: read conversations at team (custom + Viewer preset), at own, at all; a role with only a reply grant at team.
    const role = async (name: string, grants: Array<[string, string]>) => {
      const r = await one(`INSERT INTO roles (org_id, name) VALUES ($1,$2) RETURNING id`, [
        org,
        name,
      ]);
      for (const [k, s] of grants) {
        await owner.query(
          `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,$3,'allow',$4)`,
          [org, r, k, s],
        );
      }
      ids[name] = r;
    };
    await role('Team reader', [['inbox.conversation.read', 'team']]);
    await role('Own reader', [['inbox.conversation.read', 'own']]);
    await role('All reader', [['inbox.conversation.read', 'all']]);
    await role('Reply only', [['inbox.conversation.reply', 'team']]);
    ids.versionBefore = Number(
      (await owner.query(`SELECT roles_version FROM organizations WHERE id = $1`, [org])).rows[0]
        .roles_version,
    );

    // Records that exist before the column does (the back-fill covers them).
    ids.oldContact = await one(
      `INSERT INTO contacts (org_id, name, owner_id) VALUES ($1,'old',$2) RETURNING id`,
      [org, ids.solo],
    );
    ids.oldMultiContact = await one(
      `INSERT INTO contacts (org_id, name, owner_id) VALUES ($1,'oldm',$2) RETURNING id`,
      [org, ids.multi],
    );
    ids.oldOrphanContact = await one(
      `INSERT INTO contacts (org_id, name) VALUES ($1,'orphan') RETURNING id`,
      [org],
    );
    ids.versionOfOld = Number(
      (await owner.query(`SELECT row_version FROM contacts WHERE id = $1`, [ids.oldContact]))
        .rows[0].row_version,
    );

    await runMigrations(uri, { dir: MIGRATIONS, log: () => undefined });
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
    await dropDb?.();
    if (before) rmSync(before, { recursive: true, force: true });
  });

  it('adds the team_and_below value to record_scope without touching the old ones', async () => {
    const labels = (
      await owner.query(
        `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'record_scope'::regtype ORDER BY enumsortorder`,
      )
    ).rows.map((r) => r.enumlabel);
    expect(labels).toEqual(expect.arrayContaining(['all', 'team', 'own', 'team_and_below']));
    expect(labels).toHaveLength(4);
  });

  it('grants read_unassigned to the roles that read at scope team, and only to them', async () => {
    const holders = async (roleName: string) =>
      Number(
        (
          await owner.query(
            `SELECT count(*) AS n FROM role_grants WHERE org_id = $1 AND role_id = $2 AND permission_key = 'inbox.conversation.read_unassigned' AND effect = 'allow'`,
            [ids.org, ids[roleName]],
          )
        ).rows[0].n,
      );
    expect(await holders('Team reader')).toBe(1);
    expect(await holders('Own reader')).toBe(0);
    expect(await holders('All reader')).toBe(0);
    expect(await holders('Reply only')).toBe(0);
    // The Viewer preset reads at team in both workspaces and keeps the queue.
    const viewers = (
      await owner.query(
        `SELECT r.org_id FROM roles r JOIN role_grants g ON g.org_id = r.org_id AND g.role_id = r.id
         WHERE r.system_key = 'viewer' AND g.permission_key = 'inbox.conversation.read_unassigned'`,
      )
    ).rows.map((r) => Number(r.org_id));
    expect(viewers.sort()).toEqual([ids.org, ids.org2].sort());
  });

  it('registers the permission as a switch and as a baseline of the Viewer preset for new workspaces', async () => {
    const def = (
      await owner.query(
        `SELECT supports_scope, category FROM permission_defs WHERE key = 'inbox.conversation.read_unassigned'`,
      )
    ).rows[0];
    expect(def).toEqual({ supports_scope: false, category: 'inbox' });
    const base = (
      await owner.query(
        `SELECT preset_key FROM workspace_preset_baseline WHERE permission_key = 'inbox.conversation.read_unassigned'`,
      )
    ).rows.map((r) => r.preset_key);
    expect(base).toEqual(['viewer']);
    // A workspace provisioned now gets it on its Viewer.
    const org3 = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('t2c','t2c','starter') RETURNING id`,
    );
    await owner.query(`SELECT provision_workspace_presets($1)`, [org3]);
    const n = Number(
      (
        await owner.query(
          `SELECT count(*) AS n FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
           WHERE g.org_id = $1 AND r.system_key = 'viewer' AND g.permission_key = 'inbox.conversation.read_unassigned'`,
          [org3],
        )
      ).rows[0].n,
    );
    expect(n).toBe(1);
  });

  it('bumps the roles version so cached grants are reloaded', async () => {
    const after = Number(
      (await owner.query(`SELECT roles_version FROM organizations WHERE id = $1`, [ids.org]))
        .rows[0].roles_version,
    );
    expect(after).toBeGreaterThan(ids.versionBefore!);
  });

  describe('the operator report of roles whose visible conversations would change', () => {
    it('is empty right after the migration: it changed nobody, every team reader keeps the unassigned queue', async () => {
      const report = await runReport(owner, 't2a');
      expect(report).toEqual([]);
      expect(formatReport(report)).toMatch(/No workspace has a role/);
    });

    it('lists a team reader that an administrator narrowed afterwards, with its members and the open queue', async () => {
      const narrow = await one(
        `INSERT INTO roles (org_id, name) VALUES ($1,'Narrow team reader') RETURNING id`,
        [ids.org],
      );
      await owner.query(
        `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,'inbox.conversation.read','allow','team_and_below')`,
        [ids.org, narrow],
      );
      await owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
        ids.org,
        ids.solo,
        narrow,
      ]);
      const report = await runReport(owner, 't2a');
      expect(report).toHaveLength(1);
      expect(report[0]!.roles).toEqual([
        expect.objectContaining({
          role: 'Narrow team reader',
          readScope: 'team_and_below',
          members: 1,
        }),
      ]);
      expect(formatReport(report)).toContain('Narrow team reader');
      // Another workspace is not mixed in.
      expect(await runReport(owner, 't2b')).toEqual([]);
    });
  });

  describe('owning_team_id', () => {
    const owning = async (table: string, id: number) =>
      (await owner.query(`SELECT owning_team_id FROM ${table} WHERE id = $1`, [id])).rows[0]
        .owning_team_id;
    const asNumber = (v: unknown) => (v === null ? null : Number(v));

    it('leaves existing rows alone (the back-fill does that, not the migration)', async () => {
      expect(await owning('contacts', ids.oldContact!)).toBeNull();
    });

    it('stamps the owner primary team on insert, on every table, and nothing for a person with no primary team or no owner', async () => {
      const c = await one(
        `INSERT INTO contacts (org_id, name, owner_id) VALUES ($1,'c1',$2) RETURNING id`,
        [ids.org, ids.solo],
      );
      expect(asNumber(await owning('contacts', c))).toBe(ids.tA);
      const cm = await one(
        `INSERT INTO contacts (org_id, name, owner_id) VALUES ($1,'c2',$2) RETURNING id`,
        [ids.org, ids.multi],
      );
      expect(await owning('contacts', cm)).toBeNull();
      const cn = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'c3') RETURNING id`, [
        ids.org,
      ]);
      expect(await owning('contacts', cn)).toBeNull();
      const co = await one(
        `INSERT INTO companies (org_id, name, owner_id) VALUES ($1,'co1',$2) RETURNING id`,
        [ids.org, ids.solo],
      );
      expect(asNumber(await owning('companies', co))).toBe(ids.tA);
      const pipeline = await one(
        `INSERT INTO pipelines (org_id, name) VALUES ($1,'t2 pipeline') RETURNING id`,
        [ids.org],
      );
      const stage = await one(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name) VALUES ($1,$2,'t2 stage') RETURNING id`,
        [ids.org, pipeline],
      );
      const d = await one(
        `INSERT INTO deals (org_id, title, owner_user_id, pipeline_id, stage_id) VALUES ($1,'d1',$2,$3,$4) RETURNING id`,
        [ids.org, ids.mover, pipeline, stage],
      );
      expect(asNumber(await owning('deals', d))).toBe(ids.tB);
      await owner.query(`UPDATE deals SET owner_user_id = $2 WHERE id = $1`, [d, ids.solo]);
      expect(asNumber(await owning('deals', d))).toBe(ids.tA);
      const t = await one(
        `INSERT INTO tasks (org_id, title, assignee_id) VALUES ($1,'t1',$2) RETURNING id`,
        [ids.org, ids.mover],
      );
      expect(asNumber(await owning('tasks', t))).toBe(ids.tB);
    });

    it('re-stamps when the owner changes and clears when the owner is cleared', async () => {
      const c = await one(
        `INSERT INTO contacts (org_id, name, owner_id) VALUES ($1,'move',$2) RETURNING id`,
        [ids.org, ids.solo],
      );
      expect(asNumber(await owning('contacts', c))).toBe(ids.tA);
      await owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [c, ids.mover]);
      expect(asNumber(await owning('contacts', c))).toBe(ids.tB);
      await owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [c, ids.multi]);
      expect(await owning('contacts', c)).toBeNull();
      await owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [c, ids.solo]);
      expect(asNumber(await owning('contacts', c))).toBe(ids.tA);
      await owner.query(`UPDATE contacts SET owner_id = NULL WHERE id = $1`, [c]);
      expect(await owning('contacts', c)).toBeNull();
    });

    it('does not follow a later change of the owner primary team (stamped when the owner was set)', async () => {
      const c = await one(
        `INSERT INTO contacts (org_id, name, owner_id) VALUES ($1,'stable',$2) RETURNING id`,
        [ids.org, ids.mover],
      );
      await owner.query(
        `UPDATE team_members SET is_primary = false WHERE org_id = $1 AND user_id = $2 AND team_id = $3`,
        [ids.org, ids.mover, ids.tB],
      );
      await owner.query(`UPDATE contacts SET name = 'stable2' WHERE id = $1`, [c]);
      expect(asNumber(await owning('contacts', c))).toBe(ids.tB);
      await owner.query(
        `UPDATE team_members SET is_primary = true WHERE org_id = $1 AND user_id = $2 AND team_id = $3`,
        [ids.org, ids.mover, ids.tB],
      );
    });

    it('back-fills what predates the column in batches, without moving updated_at or row_version, and leaves a person with no primary team unstamped', async () => {
      const before = (
        await owner.query(`SELECT updated_at, row_version FROM contacts WHERE id = $1`, [
          ids.oldContact,
        ])
      ).rows[0];
      const db = drizzle(owner);
      const service = new OwningTeamBackfillService({
        // The real DatabaseService.privileged runs the callback in ONE transaction; the session setting the job makes is local to it.
        privileged: async (fn: (tx: unknown) => Promise<unknown>) => {
          await owner.query('BEGIN');
          try {
            const result = await fn(db);
            await owner.query('COMMIT');
            return result;
          } catch (err) {
            await owner.query('ROLLBACK');
            throw err;
          }
        },
      } as unknown as DatabaseService);
      // A batch of 1 forces the cursor to walk the table.
      const report = await service.run('contacts', 0, 0, Number.POSITIVE_INFINITY, 1);
      expect(report.next).toBeNull();
      expect(report.stamped).toBeGreaterThanOrEqual(1);
      expect(asNumber(await owning('contacts', ids.oldContact!))).toBe(ids.tA);
      expect(await owning('contacts', ids.oldMultiContact!)).toBeNull();
      expect(await owning('contacts', ids.oldOrphanContact!)).toBeNull();
      const after = (
        await owner.query(`SELECT updated_at, row_version FROM contacts WHERE id = $1`, [
          ids.oldContact,
        ])
      ).rows[0];
      expect(after.row_version).toBe(before.row_version);
      expect(new Date(after.updated_at).getTime()).toBe(new Date(before.updated_at).getTime());
      // A second pass finds nothing new to stamp.
      expect((await service.run('contacts')).stamped).toBe(0);
      for (const { table } of OWNING_TEAM_TABLES) {
        expect((await service.run(table)).next).toBeNull();
      }
    });

    it('deleting the team clears the column and keeps the record in its workspace', async () => {
      const c = await one(
        `INSERT INTO contacts (org_id, name, owner_id) VALUES ($1,'kept',$2) RETURNING id`,
        [ids.org, ids.solo],
      );
      const t = await one(
        `INSERT INTO teams (org_id, name, slug) VALUES ($1,'gone','gone') RETURNING id`,
        [ids.org],
      );
      await owner.query(`UPDATE contacts SET owning_team_id = $2 WHERE id = $1`, [c, t]);
      await owner.query(`DELETE FROM teams WHERE org_id = $1 AND id = $2`, [ids.org, t]);
      const row = (
        await owner.query(`SELECT org_id, owning_team_id FROM contacts WHERE id = $1`, [c])
      ).rows[0];
      expect(row.owning_team_id).toBeNull();
      expect(Number(row.org_id)).toBe(ids.org);
    });

    it('refuses a team of another workspace (composite foreign key)', async () => {
      const c = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'xorg') RETURNING id`, [
        ids.org,
      ]);
      await expect(
        owner.query(`UPDATE contacts SET owning_team_id = $2 WHERE id = $1`, [c, ids.tX]),
      ).rejects.toThrow(/fk_contacts_owning_team_id|foreign key/);
    });

    it('keeps the foreign keys validated and the indexes valid', async () => {
      const fks = (
        await owner.query(
          `SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE 'fk\\_%\\_owning\\_team\\_id' ORDER BY conname`,
        )
      ).rows;
      expect(fks).toHaveLength(4);
      expect(fks.every((r) => r.convalidated === true)).toBe(true);
      const idx = (
        await owner.query(
          `SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname LIKE 'idx\\_%\\_owning\\_team'`,
        )
      ).rows;
      expect(idx).toHaveLength(4);
      expect(idx.every((r) => r.indisvalid === true)).toBe(true);
    });

    it('the retired deals.owner_team_id column is untouched', async () => {
      const col = (
        await owner.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'owner_team_id'`,
        )
      ).rows;
      expect(col).toHaveLength(1);
    });
  });
});
