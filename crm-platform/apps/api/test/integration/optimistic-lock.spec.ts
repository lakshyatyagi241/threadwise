import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * Optimistic locking and the identity uniqueness invariant, against real
 * Postgres concurrency. Mocks cannot test either — both are properties of the
 * database, not of the code.
 */
describe('write invariants', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  let orgId: number;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();

    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../packages/db/migrations'),
      log: () => undefined,
    });

    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    await client.query(`SELECT set_config('app.privileged', 'on', false)`);

    const org = await client.query<{ id: number }>(
      `INSERT INTO organizations (slug, name, plan) VALUES ('lock-test','Lock Test','starter') RETURNING id`,
    );
    orgId = org.rows[0]!.id;
  }, 180_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('increments row_version on every update via the trigger', async () => {
    const inserted = await client.query<{ id: number; row_version: number }>(
      `INSERT INTO contacts (org_id, name, email) VALUES ($1,'Ver','v@example.com')
       RETURNING id, row_version`,
      [orgId],
    );
    const { id, row_version } = inserted.rows[0]!;
    expect(row_version).toBe(1);

    const updated = await client.query<{ row_version: number }>(
      `UPDATE contacts SET name = 'Ver 2' WHERE org_id = $1 AND id = $2 RETURNING row_version`,
      [orgId, id],
    );
    expect(updated.rows[0]!.row_version).toBe(2);
  });

  it('matches zero rows when the expected row_version is stale', async () => {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO contacts (org_id, name, email) VALUES ($1,'Stale','s@example.com') RETURNING id`,
      [orgId],
    );
    const id = inserted.rows[0]!.id;

    // First writer wins.
    await client.query(
      `UPDATE contacts SET name = 'First' WHERE org_id = $1 AND id = $2 AND row_version = 1`,
      [orgId, id],
    );

    // Second writer read version 1 before the first committed. Zero rows is
    // what the service turns into 409 ROW_VERSION_CONFLICT.
    const second = await client.query(
      `UPDATE contacts SET name = 'Second' WHERE org_id = $1 AND id = $2 AND row_version = 1`,
      [orgId, id],
    );
    expect(second.rowCount).toBe(0);
  });

  it('normalises email and phone into the dedup columns on write', async () => {
    const row = await client.query<{ normalized_email: string; normalized_phone: string }>(
      `INSERT INTO contacts (org_id, name, email, phone)
       VALUES ($1,'Norm','MiXeD.CaSe@Example.COM','+91 98765 43210')
       RETURNING normalized_email, normalized_phone`,
      [orgId],
    );

    expect(row.rows[0]!.normalized_email).toBe('mixed.case@example.com');
    expect(row.rows[0]!.normalized_phone).toBe('+919876543210');
  });

  it('allows one contact per identity value, and refuses a second', async () => {
    const contact = await client.query<{ id: number }>(
      `INSERT INTO contacts (org_id, name, email) VALUES ($1,'Ident','i@example.com') RETURNING id`,
      [orgId],
    );
    const other = await client.query<{ id: number }>(
      `INSERT INTO contacts (org_id, name, email) VALUES ($1,'Other','o@example.com') RETURNING id`,
      [orgId],
    );

    await client.query(
      `INSERT INTO contact_identities (org_id, contact_id, kind, value) VALUES ($1,$2,'email','shared@example.com')`,
      [orgId, contact.rows[0]!.id],
    );

    // This is the auto-merge backbone: one identity, one contact. If this ever
    // succeeds, the same person can end up with two forked timelines.
    await expect(
      client.query(
        `INSERT INTO contact_identities (org_id, contact_id, kind, value) VALUES ($1,$2,'email','shared@example.com')`,
        [orgId, other.rows[0]!.id],
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('refuses to modify the grants of a locked role', async () => {
    const role = await client.query<{ id: number }>(
      `INSERT INTO roles (org_id, name, system_key, is_locked) VALUES ($1,'Admin','admin',true) RETURNING id`,
      [orgId],
    );

    // The Admin preset is immutable in the DATABASE, not merely hidden in the
    // UI — an org that could edit it could lock itself out of its own tenant.
    await expect(
      client.query(
        `INSERT INTO role_grants (org_id, role_id, permission_key) VALUES ($1,$2,'admin.user.manage')`,
        [orgId, role.rows[0]!.id],
      ),
    ).rejects.toThrow(/role is locked/i);
  });
});
