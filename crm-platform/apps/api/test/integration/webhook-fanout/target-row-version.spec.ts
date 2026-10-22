import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The forwarder's delivery counters and an operator's settings edit share one row. The counters are written every
 * few seconds, so they must not bump row_version: an edit that read the row before a flush would otherwise always
 * fail with ROW_VERSION_CONFLICT. Settings changes still do bump it. Checked against real Postgres, because the
 * trigger is the behaviour under test.
 */
describe('webhook forward target row_version', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();

    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });

    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    await client.query(`SELECT set_config('app.privileged', 'on', false)`);
  }, 180_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertTarget(name: string): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO webhook_forward_targets (name, url) VALUES ($1, 'https://example.com/hook') RETURNING id`,
      [name],
    );
    return res.rows[0]!.id;
  }

  async function version(id: number): Promise<number> {
    const res = await client.query<{ row_version: number }>(
      `SELECT row_version FROM webhook_forward_targets WHERE id = $1`,
      [id],
    );
    return res.rows[0]!.row_version;
  }

  it('a delivery counter flush does not change row_version or updated_at', async () => {
    const id = await insertTarget('counters-only');
    const before = await client.query<{ row_version: number; updated_at: Date }>(
      `SELECT row_version, updated_at FROM webhook_forward_targets WHERE id = $1`,
      [id],
    );

    await client.query(
      `UPDATE webhook_forward_targets SET success_count = success_count + 5, last_status = 200,
         last_success_at = now(), last_error = NULL WHERE id = $1`,
      [id],
    );

    const after = await client.query<{ row_version: number; updated_at: Date }>(
      `SELECT row_version, updated_at FROM webhook_forward_targets WHERE id = $1`,
      [id],
    );
    expect(after.rows[0]!.row_version).toBe(before.rows[0]!.row_version);
    expect(after.rows[0]!.updated_at.getTime()).toBe(before.rows[0]!.updated_at.getTime());
  });

  it('an edit that read the version before a counter flush still matches, and bumps it', async () => {
    const id = await insertTarget('edit-after-flush');
    const read = await version(id);

    await client.query(
      `UPDATE webhook_forward_targets SET failure_count = failure_count + 3, last_status = 401,
         last_error = 'HTTP 401', last_failure_at = now() WHERE id = $1`,
      [id],
    );

    const edit = await client.query(
      `UPDATE webhook_forward_targets SET name = 'edit-after-flush-renamed' WHERE id = $1 AND row_version = $2`,
      [id, read],
    );
    expect(edit.rowCount).toBe(1);
    expect(await version(id)).toBe(read + 1);
  });

  it('a stale settings edit matches zero rows, and a no-op save does not bump the version', async () => {
    const id = await insertTarget('stale-and-noop');
    const read = await version(id);

    await client.query(`UPDATE webhook_forward_targets SET url = 'https://example.com/other' WHERE id = $1`, [id]);
    expect(await version(id)).toBe(read + 1);

    const stale = await client.query(
      `UPDATE webhook_forward_targets SET name = 'stale' WHERE id = $1 AND row_version = $2`,
      [id, read],
    );
    expect(stale.rowCount).toBe(0);

    const current = await version(id);
    await client.query(`UPDATE webhook_forward_targets SET name = name WHERE id = $1`, [id]);
    expect(await version(id)).toBe(current);
  });
});
