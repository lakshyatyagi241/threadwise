import { resolve } from 'node:path';
import { runMigrations } from '@crm/db';
import { WorkerHost, getQueueToken } from '@nestjs/bullmq';
import { DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Queue } from 'bullmq';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUES } from '../../../src/infra/queue/queues';
import {
  startRuntimeMonitor,
  stopRuntimeMonitor,
} from '../../../src/modules/platform-infrastructure';

/**
 * The job-metrics hook against the real worker: the module graph is initialised (lifecycle hooks run, unlike `compile()` alone, which
 * is all `developer-rest-api-v1/worker-boot.e2e.spec.ts` does), every processor the app registers must carry the listeners, and a real
 * job through a real processor and the real database must show up in the monitor.
 *
 * Postgres and Redis are set up the way `auth-registration-security/harness.ts` does it, without booting the HTTP application: the
 * worker needs the database, not the API, and the API boot is minutes of the run.
 */
describe('job metrics in the booted worker', () => {
  let pg: StartedPostgreSqlContainer | undefined;
  let redis: StartedTestContainer | undefined;
  let owner: Client | undefined;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    owner = new Client({ connectionString: pg.getConnectionUri() });
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
      PORT: '3999',
      APP_URL: 'http://localhost:3999',
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
    });
  }, 600_000);

  afterAll(async () => {
    stopRuntimeMonitor();
    await owner?.end();
    await redis?.stop();
    await pg?.stop();
  }, 120_000);

  it('attaches to every processor and records a real job', async () => {
    const monitor = startRuntimeMonitor('worker', {});
    expect(monitor).toBeDefined();

    // Imported after the environment is set: the module graph reads configuration at import.
    const { WorkerModule } = await import('../../../src/worker.module');
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await moduleRef.init(); // onModuleInit creates the BullMQ workers; onApplicationBootstrap attaches the hook
    try {
      const processors = moduleRef
        .get(DiscoveryService, { strict: false })
        .getProviders()
        .map((p) => p.instance as unknown)
        .filter((i): i is WorkerHost => i instanceof WorkerHost);
      expect(processors.length, 'processors found').toBeGreaterThan(20);
      for (const p of processors) {
        expect(
          p.worker.listenerCount('completed'),
          `${p.constructor.name} completed`,
        ).toBeGreaterThan(0);
        expect(p.worker.listenerCount('failed'), `${p.constructor.name} failed`).toBeGreaterThan(0);
      }

      // The template status sweep reads one table and returns when nothing is stale: a real processor, a real job, no side effects.
      const queue = moduleRef.get<Queue>(getQueueToken(QUEUES.TPL_SWEEP), { strict: false });
      await queue.add('sweep', { slot: 1 }, { jobId: 'el-job-metrics-e2e' });

      const line = (metric: string, extra = '') =>
        new RegExp(`${metric}\\{[^}]*queue="${QUEUES.TPL_SWEEP}"${extra}[^}]*\\} (\\d+)`);
      const deadline = Date.now() + 60_000;
      let out = monitor!.render();
      while (Date.now() < deadline && !line('crm_queue_jobs_total').test(out)) {
        await new Promise((r) => setTimeout(r, 250));
        out = monitor!.render();
      }
      expect(out).toMatch(line('crm_queue_jobs_total', ',outcome="completed"'));
      expect(out).toMatch(line('crm_queue_job_duration_seconds_count'));
      expect(out).toMatch(line('crm_queue_job_wait_seconds_count'));
      expect(out).not.toMatch(line('crm_queue_job_retries_total')); // it ran once
    } finally {
      await moduleRef.close();
    }
  }, 600_000);
});
