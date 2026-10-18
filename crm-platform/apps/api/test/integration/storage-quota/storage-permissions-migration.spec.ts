import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The permission migration of the storage quota (20270105090100) on a database that already has workspaces: every migration EXCEPT the
 * storage ones is applied, workspaces are created, then the storage migrations run on top. `organizations` is under FORCE ROW LEVEL
 * SECURITY, so a statement that touches it before the migration raises the privileged flag silently changes nothing: the existing
 * workspaces would never receive the new keys, and their cached role sets would never be refreshed.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const STORAGE_FILES = /^20270105090[01]00_storage_quota_/;

describe('storage quota permissions migration on existing workspaces', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let tmp: string;
  const orgs: number[] = [];
  let versionsBefore: number[] = [];

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

    tmp = mkdtempSync(join(tmpdir(), 'storage-mig-'));
    mkdirSync(tmp, { recursive: true });
    for (const f of readdirSync(MIGRATIONS)) {
      if (f.endsWith('.sql') && !STORAGE_FILES.test(f))
        copyFileSync(join(MIGRATIONS, f), join(tmp, f));
    }
    await runMigrations(container.getConnectionUri(), { dir: tmp, log: () => undefined });

    for (const slug of ['pre-a', 'pre-b']) {
      const r = await owner.query(
        `INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`,
        [slug],
      );
      orgs.push(Number(r.rows[0].id));
    }
    versionsBefore = (
      await owner.query(`SELECT roles_version FROM organizations WHERE id = ANY($1) ORDER BY id`, [
        orgs,
      ])
    ).rows.map((r) => Number(r.roles_version));

    const res = await runMigrations(container.getConnectionUri(), {
      dir: MIGRATIONS,
      log: () => undefined,
    });
    expect(res.applied.filter((f) => STORAGE_FILES.test(f))).toHaveLength(2);
  }, 600_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('gives the three workspace keys to the admin roles that already existed, and refreshes their cached role sets', async () => {
    for (const org of orgs) {
      const held = await owner.query(
        `SELECT g.permission_key FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
         WHERE g.org_id = $1 AND r.system_key = 'admin' AND g.permission_key LIKE 'storage.%' ORDER BY 1`,
        [org],
      );
      expect(held.rows.map((r) => r.permission_key)).toEqual([
        'storage.files.manage',
        'storage.restore.request',
        'storage.usage.read',
      ]);
    }
    const after = (
      await owner.query(`SELECT roles_version FROM organizations WHERE id = ANY($1) ORDER BY id`, [
        orgs,
      ])
    ).rows.map((r) => Number(r.roles_version));
    after.forEach((v, i) => expect(v).toBeGreaterThan(versionsBefore[i]!));
  });

  it('a workspace created afterwards gets them too, and a plain member does not', async () => {
    const r = await owner.query(
      `INSERT INTO organizations (slug, name) VALUES ('post-c', 'post-c') RETURNING id`,
    );
    const org = Number(r.rows[0].id);
    const byRole = await owner.query(
      `SELECT r.system_key, count(*)::int AS n FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
       WHERE g.org_id = $1 AND g.permission_key LIKE 'storage.%' GROUP BY 1`,
      [org],
    );
    const held = Object.fromEntries(byRole.rows.map((x) => [x.system_key, x.n]));
    expect(held.admin).toBe(3);
    expect(held.agent).toBeUndefined();
    expect(held.viewer).toBeUndefined();
  });

  it('seeds the two platform keys: Super Admin holds both, Admin only the first', async () => {
    const rows = await owner.query(
      `SELECT r.name AS role, p.name::text AS perm FROM platform_role_permissions rp
       JOIN platform_roles r ON r.id = rp.role_id JOIN platform_permissions p ON p.id = rp.permission_id
       WHERE p.name::text LIKE 'platform.workspace.storage%' ORDER BY 1, 2`,
    );
    expect(rows.rows.map((x) => `${x.role}:${x.perm}`)).toEqual([
      'Admin:platform.workspace.storage',
      'Super Admin:platform.workspace.storage',
      'Super Admin:platform.workspace.storage_grant',
    ]);
  });
});
