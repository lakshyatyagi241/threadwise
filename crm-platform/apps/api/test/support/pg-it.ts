import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { runMigrations } from '@crm/db';

export const MIGRATIONS_DIR = resolve(__dirname, '../../../../packages/db/migrations');

export interface TestPg {
  /** A connection as the schema owner, with the privileged flag on so row-level security does not hide seed rows. */
  owner: Client;
  stop(): Promise<void>;
}

/**
 * A migrated Postgres for an integration test. By default a throwaway container (what CI does). With TEST_PG_ADMIN_URL set (an
 * owner-role URL of a server you may create databases on) it creates and drops its own database there instead, for machines where
 * starting a container is not wanted.
 */
export async function startTestPg(): Promise<TestPg> {
  const admin = process.env.TEST_PG_ADMIN_URL;
  let container: StartedPostgreSqlContainer | undefined;
  let uri: string;
  let dropDb: (() => Promise<void>) | undefined;
  if (admin) {
    const name = `it_${randomBytes(5).toString('hex')}`;
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
  const owner = new Client({ connectionString: uri });
  await owner.connect();
  await runMigrations(uri, { dir: MIGRATIONS_DIR, log: () => undefined });
  await owner.query(`SELECT set_config('app.privileged', 'on', false)`);
  return {
    owner,
    async stop() {
      await owner.end().catch(() => undefined);
      if (container) await container.stop();
      if (dropDb) await dropDb();
    },
  };
}
