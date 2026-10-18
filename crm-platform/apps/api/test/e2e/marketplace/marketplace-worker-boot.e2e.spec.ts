import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The worker process with the Marketplace in it. The worker is not the HTTP app: it is a Nest application context built from the modules
 * of `worker.ts` plus `WorkersModule`, and a module that compiles in the API can still fail to resolve a provider there (no global HTTP
 * guard, no controllers). This builds that same context against a throwaway database and Redis and checks the marketplace's processor and
 * sweep are there, so a change to the module graph cannot take the background jobs of every domain down unnoticed.
 */
let pg: StartedPostgreSqlContainer;
let redis: StartedTestContainer;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('crm')
    .withUsername('crm')
    .withPassword('crm')
    .start();
  redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
  const { Client } = await import('pg');
  const owner = new Client({ connectionString: pg.getConnectionUri() });
  await owner.connect();
  await owner.query(
    `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await owner.end();
  await runMigrations(pg.getConnectionUri(), {
    dir: resolve(__dirname, '../../../../../packages/db/migrations'),
    log: () => undefined,
  });
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    APP_URL: 'http://localhost:3999',
    WEB_APP_URL: 'http://localhost:3001',
    DATABASE_URL: `postgres://crm_app_user:test@${pg.getHost()}:${pg.getPort()}/crm`,
    MIGRATION_DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    CLERK_SECRET_KEY: 'sk_test_unused',
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
}, 300_000);

afterAll(async () => {
  await redis?.stop();
  await pg?.stop();
});

describe('the worker process', () => {
  it('builds with the marketplace module, and the pull processor and the sweep are registered', async () => {
    const { AppConfigModule } = await import('../../../src/config/config.module');
    const { DbModule } = await import('../../../src/infra/db/db.module');
    const { RedisModule } = await import('../../../src/infra/redis/redis.module');
    const { QueueModule } = await import('../../../src/infra/queue/queue.module');
    const { ProvidersModule } = await import('../../../src/infra/providers/providers.module');
    const { KernelModule } = await import('../../../src/kernel/kernel.module');
    const { SendGuardModule } = await import('../../../src/modules/auth');
    const { RealtimeEmitterModule } = await import('../../../src/realtime');
    const { WorkersModule } = await import('../../../src/workers/workers.module');
    // Global, and imported by `worker.module.ts`: ApiKeyGuard (a provider of the flows module) needs it.
    const { ApiKeyAccessModule } =
      await import('../../../src/modules/public-api/api-key-access.module');
    const { PullProcessor, PullSweepService } =
      await import('../../../src/modules/marketplace/pull.worker');
    const { PullRunService } = await import('../../../src/modules/marketplace/pull-run.service');

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        DbModule,
        RedisModule,
        QueueModule,
        ProvidersModule,
        SendGuardModule,
        KernelModule,
        RealtimeEmitterModule,
        ApiKeyAccessModule,
        WorkersModule,
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    try {
      await app.init();
      expect(app.get(PullProcessor, { strict: false })).toBeDefined();
      expect(app.get(PullSweepService, { strict: false })).toBeDefined();
      expect(app.get(PullRunService, { strict: false })).toBeDefined();
      // Nothing is due in an empty database: the sweep runs and queues nothing.
      expect(await app.get(PullSweepService, { strict: false }).run()).toBe(0);
    } finally {
      await app.close();
    }
  }, 240_000);
});
