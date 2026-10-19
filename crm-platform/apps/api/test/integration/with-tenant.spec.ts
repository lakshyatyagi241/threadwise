import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withTenant, type DbClient } from '@crm/db';

/**
 * `withTenant` sets the tenant settings in ONE statement. The unit test pins the statement; this proves, against a real Postgres and
 * the restricted application role, that the one statement still isolates tenants, stays transaction-local and carries the user and
 * act-as settings the audit triggers read.
 */
describe('withTenant against a real database', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  let orgA: number;
  let orgB: number;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    // Docker Desktop's port forwarding can reset the very first connection after the container reports ready.
    for (let attempt = 1; ; attempt++) {
      owner = new Client({ connectionString: container.getConnectionUri() });
      try {
        await owner.connect();
        break;
      } catch (err) {
        await owner.end().catch(() => undefined);
        if (attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../packages/db/migrations'),
      log: () => undefined,
    });
    const a = await owner.query<{ id: number }>(
      `INSERT INTO organizations (slug, name, plan) VALUES ('wt-a','Org A','starter') RETURNING id`,
    );
    const b = await owner.query<{ id: number }>(
      `INSERT INTO organizations (slug, name, plan) VALUES ('wt-b','Org B','starter') RETURNING id`,
    );
    orgA = Number(a.rows[0]!.id);
    orgB = Number(b.rows[0]!.id);
    await owner.query(
      `INSERT INTO contacts (org_id, name, email, phone) VALUES ($1,'A Person','a@example.com','+911111111111')`,
      [orgA],
    );
    await owner.query(
      `INSERT INTO contacts (org_id, name, email, phone) VALUES ($1,'B Person','b@example.com','+922222222222')`,
      [orgB],
    );
    app = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 2,
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await container?.stop();
  });

  const names = async (orgId: number) =>
    withTenant(app.db, { orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`select name from contacts order by name`);
      return (res.rows as Array<{ name: string }>).map((r) => r.name);
    });

  it('shows each tenant only its own rows', async () => {
    expect(await names(orgA)).toEqual(['A Person']);
    expect(await names(orgB)).toEqual(['B Person']);
  });

  it('refuses to write into another tenant', async () => {
    const err = (await withTenant(app.db, { orgId: orgA }, async (tx) =>
      tx.execute(sql`insert into contacts (org_id, name) values (${orgB}, 'Smuggled')`),
    ).catch((e: unknown) => e)) as { message?: string; cause?: { message?: string } };
    // drizzle wraps the database error: the policy's own message is on the cause.
    expect(`${err.message} ${err.cause?.message}`).toMatch(/row-level security/i);
  });

  it('makes the org and user settings visible to the first statement of the callback', async () => {
    const seen = await withTenant(app.db, { orgId: orgA, userId: 5 }, async (tx) => {
      const res = await tx.execute(
        sql`select current_setting('app.org_id', true) as org, current_setting('app.user_id', true) as usr`,
      );
      return res.rows[0] as { org: string; usr: string };
    });
    expect(seen).toEqual({ org: String(orgA), usr: '5' });
  });

  it('sets an empty user when there is none', async () => {
    const seen = await withTenant(app.db, { orgId: orgA, userId: null }, async (tx) => {
      const res = await tx.execute(sql`select current_setting('app.user_id', true) as usr`);
      return (res.rows[0] as { usr: string }).usr;
    });
    expect(seen).toBe('');
  });

  it('carries the act-as settings in the same transaction', async () => {
    const seen = await withTenant(
      app.db,
      {
        orgId: orgA,
        userId: 5,
        impersonation: {
          operatorUuid: '00000000-0000-4000-8000-0000000000aa',
          sessionUuid: '00000000-0000-4000-8000-0000000000bb',
        },
      },
      async (tx) => {
        const res = await tx.execute(
          sql`select current_setting('app.impersonator_id', true) as op, current_setting('app.impersonation_id', true) as sess`,
        );
        return res.rows[0] as { op: string; sess: string };
      },
    );
    expect(seen).toEqual({
      op: '00000000-0000-4000-8000-0000000000aa',
      sess: '00000000-0000-4000-8000-0000000000bb',
    });
  });

  it('never leaks a setting to the next user of the pooled connection', async () => {
    await withTenant(app.db, { orgId: orgA, userId: 5 }, async () => undefined);
    // The pool has two connections; ask on enough fresh checkouts to cover both.
    for (let i = 0; i < 4; i++) {
      const res = await app.db.execute(
        sql`select current_setting('app.org_id', true) as org, current_setting('app.user_id', true) as usr`,
      );
      const row = res.rows[0] as { org: string | null; usr: string | null };
      expect(row.org ?? '').toBe('');
      expect(row.usr ?? '').toBe('');
    }
  });

  it('fails closed outside withTenant: no settings, no rows', async () => {
    const res = await app.db.execute(sql`select count(*)::int as n from contacts`);
    expect((res.rows[0] as { n: number }).n).toBe(0);
  });
});
