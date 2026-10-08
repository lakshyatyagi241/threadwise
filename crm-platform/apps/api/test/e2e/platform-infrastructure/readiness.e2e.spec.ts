import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readInfraEnv } from '../../../src/config/domains/platform-infrastructure.env';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  OUTBOX_SAMPLE_KEY,
  WORKERS_KEY,
} from '../../../src/modules/platform-infrastructure/observability/worker-heartbeat';
import { WorkerHeartbeatService } from '../../../src/modules/platform-infrastructure/observability/worker-heartbeat.service';
import { startHarness, type Harness } from '../auth-registration-security/harness';

/**
 * Readiness with a real database (TW-INFRA-015): the worker's outbox sample runs the real query as the restricted worker
 * role would, and /ready reports it without ever letting it change the status code. The deploy gate and the container
 * healthcheck read only that status code.
 */
let h: Harness;
const ready = () => request(h.app.getHttpServer()).get('/ready');

beforeAll(async () => {
  h = await startHarness();
  await h.redis.del(WORKERS_KEY, OUTBOX_SAMPLE_KEY);
}, 180_000);

afterAll(async () => {
  await h?.redis.del(WORKERS_KEY, OUTBOX_SAMPLE_KEY);
  await h?.stop();
});

const insert = (status: string, availableAtSql: string) =>
  h.owner.query(
    `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload, status, available_at)
     VALUES (1, 'test', 1, 'test.created', '{}'::jsonb, $1, ${availableAtSql})`,
    [status],
  );

describe('/ready', () => {
  it('is 200 with workers down and the outbox unknown before any worker has beaten (a deploy in progress)', async () => {
    const res = await ready();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.workers).toEqual({ status: 'down', count: 0 });
    expect(res.body.checks.outbox).toEqual({ status: 'unknown' });
  });

  it('reports a lagging outbox and a live worker, and is still 200', async () => {
    await insert('pending', `now() - interval '120 seconds'`); // due two minutes ago
    await insert('pending', `now() - interval '30 seconds'`); // due, newer
    await insert('pending', `now() + interval '1 hour'`); // backing off: not due, must not count
    await insert('done', `now() - interval '300 seconds'`); // finished: must not count
    await insert('dead', `now() - interval '300 seconds'`); // given up: not part of the lag

    const heartbeat = new WorkerHeartbeatService(
      h.app.get(DatabaseService),
      h.redis,
      readInfraEnv({}),
    );
    await heartbeat.beat();

    const res = await ready();
    expect(res.status).toBe(200);
    expect(res.body.checks.workers).toEqual({ status: 'up', count: 1 });
    expect(res.body.checks.outbox).toMatchObject({ status: 'lagging', ready: 2 });
    expect(res.body.checks.outbox.lagSeconds).toBeGreaterThanOrEqual(119);
    expect(res.body.checks.outbox.lagSeconds).toBeLessThan(130);
  });

  it('goes back to ok once the due events are gone', async () => {
    await h.owner.query(
      `UPDATE event_outbox SET status = 'done' WHERE status = 'pending' AND available_at <= now()`,
    );
    await new WorkerHeartbeatService(h.app.get(DatabaseService), h.redis, readInfraEnv({})).beat();
    const res = await ready();
    expect(res.status).toBe(200);
    expect(res.body.checks.outbox).toMatchObject({ status: 'ok', ready: 0, lagSeconds: 0 });
  });

  it('keeps the probes clear of anything secret', async () => {
    const res = await ready();
    expect(JSON.stringify(res.body)).not.toMatch(/postgres:\/\/|redis:\/\/|password|secret/i);
  });
});
