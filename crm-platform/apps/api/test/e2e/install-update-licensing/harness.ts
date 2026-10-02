import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { runMigrations } from '@crm/db';

export const SETUP_TOKEN = 'setup-token-for-tests-0123456789abcdef-XYZ';

export interface Harness {
  app: INestApplication;
  /** Owner connection: bypasses RLS, for arranging and inspecting state. */
  owner: Client;
  stop(): Promise<void>;
}

/**
 * A hermetic copy of the API for the setup flow: real Postgres (restricted application role, real migrations),
 * real Redis, the real AppModule. Nothing is seeded: the database starts as a fresh deployment would, with
 * migrations applied and no operator, organization or plan.
 */
export async function startHarness(extraEnv: Record<string, string> = {}): Promise<Harness> {
  const pg: StartedPostgreSqlContainer = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('crm')
    .withUsername('crm')
    .withPassword('crm')
    .start();
  const redis: StartedTestContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  const owner = new Client({ connectionString: pg.getConnectionUri() });
  await owner.connect();
  await owner.query(
    `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await runMigrations(pg.getConnectionUri(), {
    dir: resolve(__dirname, '../../../../../packages/db/migrations'),
    log: () => undefined,
  });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    PORT: '3998',
    APP_URL: 'http://localhost:3998',
    WEB_APP_URL: 'http://localhost:3001',
    APP_NAME: 'Test CRM',
    TRUST_PROXY: 'loopback',
    DATABASE_URL: `postgres://crm_app_user:test@${pg.getHost()}:${pg.getPort()}/crm`,
    MIGRATION_DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    CLERK_SECRET_KEY: 'sk_test_unused',
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SETUP_TOKEN,
    DEMO_MODE: 'false',
    GIT_SHA: 'deadbee',
    BUILD_NUMBER: '7',
    ...extraEnv,
  });

  // Imported after the environment is set: AppModule reads configuration at import.
  const { AppModule } = await import('../../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    'loopback',
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
  await app.init();

  return {
    app,
    owner,
    stop: async () => {
      await app.close();
      await owner.end();
      await redis.stop();
      await pg.stop();
    },
  };
}
