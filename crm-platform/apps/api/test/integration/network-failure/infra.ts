import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { runMigrations } from '@crm/db';

/**
 * Real Postgres and Redis for the outage-and-recovery tests.
 *
 * By default each run starts its own containers (like every other integration test). To reuse servers that are already running, set
 * NF_PG_ADMIN_URL (an admin login on the maintenance database, e.g. postgres://crm:crm@localhost:5432/postgres) and NF_REDIS_URL
 * (e.g. redis://localhost:56379/9). Then the run creates a throwaway database `crm_nf2_<random>` (dropped at the end) and touches no
 * other database; Redis is shared, so every BullMQ queue the tests make has a random prefix and is removed afterwards. The tests never
 * stop, restart or reconfigure a server: faults come from the TCP proxy in front of it.
 */
export interface NfInfra {
  pg: { host: string; port: number };
  redis: { host: string; port: number; db: number };
  /** Owner (migration role) connection URL for the throwaway database. */
  ownerUrl: (host?: string, port?: number) => string;
  /** The application role's URL for it. */
  appUrl: (host: string, port: number) => string;
  stop(): Promise<void>;
}

export async function startNfInfra(): Promise<NfInfra> {
  const adminUrl = process.env.NF_PG_ADMIN_URL;
  const redisUrl = process.env.NF_REDIS_URL;
  const migrations = resolve(__dirname, '../../../../../packages/db/migrations');

  if (adminUrl && redisUrl) {
    const dbName = `crm_nf2_${randomBytes(4).toString('hex')}`;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new URL(adminUrl);
    u.pathname = `/${dbName}`;
    const owner = u.toString();
    await runMigrations(owner, { dir: migrations, log: () => undefined });
    const appUser = process.env.NF_PG_APP_USER ?? 'crm_app_user';
    const appPass = process.env.NF_PG_APP_PASSWORD ?? 'crm_app_dev';
    const r = new URL(redisUrl);
    return {
      pg: { host: u.hostname, port: Number(u.port || 5432) },
      redis: {
        host: r.hostname,
        port: Number(r.port || 6379),
        db: Number(r.pathname.replace('/', '')) || 0,
      },
      ownerUrl: (host = u.hostname, port = Number(u.port || 5432)) =>
        `postgres://${u.username}:${u.password}@${host}:${port}/${dbName}`,
      appUrl: (host, port) => `postgres://${appUser}:${appPass}@${host}:${port}/${dbName}`,
      stop: async () => {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.end();
      },
    };
  }

  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const { GenericContainer } = await import('testcontainers');
  const pg = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('crm')
    .withUsername('crm')
    .withPassword('crm')
    .start();
  const redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
  const owner = new Client({ connectionString: pg.getConnectionUri() });
  await owner.connect();
  await owner.query(
    `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await owner.end();
  await runMigrations(pg.getConnectionUri(), { dir: migrations, log: () => undefined });
  return {
    pg: { host: pg.getHost(), port: pg.getPort() },
    redis: { host: redis.getHost(), port: redis.getMappedPort(6379), db: 0 },
    ownerUrl: (host = pg.getHost(), port = pg.getPort()) =>
      `postgres://crm:crm@${host}:${port}/crm`,
    appUrl: (host, port) => `postgres://crm_app_user:test@${host}:${port}/crm`,
    stop: async () => {
      await redis.stop();
      await pg.stop();
    },
  };
}
