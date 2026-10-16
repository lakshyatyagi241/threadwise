import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { TenantDirectory } from '../../../src/modules/auth/platform/tenant-directory';
import { PlanCatalogService } from '../../../src/modules/plans-subscriptions-trials/plan-catalog.service';
import { PlanStore } from '../../../src/modules/plans-subscriptions-trials/plan-store';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';

/**
 * TenantDirectory.identityExists against a real Postgres, as the restricted
 * application role (a superuser would bypass RLS/policy and make the
 * privileged-gateway assertions vacuous — see auth-schema.spec.ts).
 */
describe('TenantDirectory.identityExists', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let dbClient: DbClient;
  let directory: TenantDirectory;

  const q = (c: Client, text: string, params: unknown[] = []) => c.query(text, params);

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

    // Seed one organization with two existing users: one identifiable by email
    // only, one identifiable by phone only (with a different email), so each
    // branch of identityExists is proven independently of the other.
    const org = await q(
      owner,
      `INSERT INTO organizations (slug, name) VALUES ('org-identity','Org Identity') RETURNING id`,
    );
    const orgId = Number(org.rows[0].id);
    await q(
      owner,
      `INSERT INTO users (org_id, email, full_name) VALUES ($1,'taken@example.test','Taken By Email')`,
      [orgId],
    );
    const phoneUser = await q(
      owner,
      `INSERT INTO users (org_id, email, full_name) VALUES ($1,'phone-owner@example.test','Taken By Phone') RETURNING id`,
      [orgId],
    );
    await q(
      owner,
      `INSERT INTO user_profiles (org_id, user_id, phone_e164) VALUES ($1,$2,'+15555550199')`,
      [orgId, Number(phoneUser.rows[0].id)],
    );

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();

    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    const db = {
      primary: dbClient.db,
      privileged: (fn: Parameters<DatabaseService['privileged']>[0]) =>
        withPrivileged(dbClient.db, fn),
      txAs: (
        tenant: Parameters<DatabaseService['txAs']>[0],
        fn: Parameters<DatabaseService['txAs']>[1],
      ) => withTenant(dbClient.db, tenant, fn),
    } as unknown as DatabaseService;
    directory = new TenantDirectory(
      db,
      new PlanEntitlementService(db, new PlanCatalogService(db), new PlanStore(db)),
    );
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('is false for a brand-new email and phone', async () => {
    const exists = await directory.identityExists('nobody@example.test', '+15555550100');
    expect(exists).toBe(false);
  });

  it('is true when the email already has a users row (checked with no phone given)', async () => {
    const exists = await directory.identityExists('taken@example.test', null);
    expect(exists).toBe(true);
  });

  it('is true when the phone already has a users row, even with a different, unused email', async () => {
    const exists = await directory.identityExists('new-email@example.test', '+15555550199');
    expect(exists).toBe(true);
  });
});
