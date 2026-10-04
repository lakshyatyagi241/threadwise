import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
import { DEMO_DOMAIN, seedDemoMembers } from '../../../src/modules/team-chat/cli/demo-members';

/** TW-TCHAT-032: the demo teammate seeder, idempotent, per organization, unable to receive mail or sign in. */
describe('team chat demo members seeder (TW-TCHAT-032)', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let orgA: number;
  let orgB: number;

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
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    await owner.query(`SELECT set_config('app.privileged', 'on', false)`);
    const org = async (slug: string) =>
      Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name, plan) VALUES ($1,$1,'starter') RETURNING id`,
            [slug],
          )
        ).rows[0].id,
      );
    orgA = await org('da');
    orgB = await org('db');
    await owner.query(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'boss@t.test','Boss','x')`,
      [orgA],
    );
  }, 240_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('adds ten teammates (eight agents, two managers) to a workspace with one member, and a second run adds nothing', async () => {
    const first = await seedDemoMembers(owner, orgA);
    expect(first).toEqual({ usersCreated: 10, linksCreated: 10, members: 11 });
    const roles = await owner.query(
      `SELECT r.name, count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id AND u.org_id = ur.org_id
       WHERE ur.org_id = $1 AND u.email LIKE '%@${DEMO_DOMAIN}' GROUP BY r.name ORDER BY r.name`,
      [orgA],
    );
    expect(roles.rows).toEqual([
      { name: 'Agent', n: 8 },
      { name: 'Manager', n: 2 },
    ]);
    const second = await seedDemoMembers(owner, orgA);
    expect(second).toEqual({ usersCreated: 0, linksCreated: 0, members: 11 });
  });

  it('seeds only the organization it is given', async () => {
    const r = await seedDemoMembers(owner, orgB);
    expect(r.members).toBe(10);
    const a = await owner.query(`SELECT count(*)::int AS n FROM users WHERE org_id = $1`, [orgA]);
    expect(a.rows[0].n).toBe(11);
  });

  it('creates verified accounts on a mail-less domain with a password nobody knows', async () => {
    const rows = await owner.query(
      `SELECT u.email, u.password_hash, s.email_verified_at FROM users u
       JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
       WHERE u.org_id = $1 AND u.email LIKE '%@${DEMO_DOMAIN}'`,
      [orgA],
    );
    expect(rows.rows).toHaveLength(10);
    for (const r of rows.rows) {
      expect(r.email.endsWith('.test')).toBe(true);
      expect(r.password_hash).toMatch(/^\$argon2/);
      expect(r.email_verified_at).not.toBeNull();
    }
  });
});
