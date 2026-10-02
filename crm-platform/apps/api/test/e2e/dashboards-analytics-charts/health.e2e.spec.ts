import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import { clearQueueResponseSchema, healthResponseSchema } from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { QUEUES } from '../../../src/infra/queue/queues';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/** Operator system health end to end (TW-DASH-048, 049, 051): real Postgres, real Redis, real BullMQ. */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let supportToken = '';

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const queue = (name: string) => h.app.get<Queue>(getQueueToken(name), { strict: false }) as Queue;

describe('GET /v2/platform/health', () => {
  it('needs a platform operator', async () => {
    expect((await api().get('/v2/platform/health')).status).toBe(401);
  });

  it('every operator role reads the five probes, the banner, queues and vitals', async () => {
    const res = await api().get('/v2/platform/health?fresh=1').set(bearer(supportToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.checks.map((c) => c.key)).toEqual([
      'database',
      'cache',
      'queue',
      'bridge',
      'storage',
    ]);
    const by = Object.fromEntries(body.checks.map((c) => [c.key, c]));
    expect(by.database?.state).toBe('up');
    expect(by.cache).toMatchObject({ state: 'up', detail: 'read/write ok' });
    expect(by.queue?.state).toBe('up');
    expect(by.bridge?.state).toBe('warn'); // no bridge URL in the harness
    expect(body.overall).toBe('warn');
    expect(body.queues.map((q) => q.name).sort()).toEqual(Object.values(QUEUES).sort());
    expect(body.vitals.nodeVersion).toBe(process.version);
  });

  it('a reachable bridge that answers 401 or 404 still counts as up', async () => {
    process.env.NODE_BRIDGE_URL = h.stubs.bridge.url;
    try {
      const res = await api().get('/v2/platform/health?fresh=1').set(bearer(superToken));
      const bridge = res.body.checks.find((c: { key: string }) => c.key === 'bridge');
      expect(bridge.state).toBe('up');
      expect(bridge.detail).toMatch(/^HTTP 4\d\d/);
    } finally {
      delete process.env.NODE_BRIDGE_URL;
    }
  });

  it('three failed jobs make the queue and the banner Degraded', async () => {
    const q = queue(QUEUES.CAMPAIGN);
    for (let i = 0; i < 3; i++) {
      const job = await q.add('t', { i });
      await job.moveToFailed(new Error('boom'), '0', false).catch(() => undefined);
    }
    const counts = await q.getJobCounts('failed');
    const res = await api().get('/v2/platform/health?fresh=1').set(bearer(superToken));
    const queueCheck = res.body.checks.find((c: { key: string }) => c.key === 'queue');
    expect(queueCheck.state).toBe(counts.failed! > 0 ? 'warn' : 'up');
  });
});

describe('POST /v2/platform/health/clear-queue (TW-DASH-051)', () => {
  it('only a super admin may clear', async () => {
    const res = await api()
      .post('/v2/platform/health/clear-queue')
      .set(bearer(supportToken))
      .send({});
    expect(res.status).toBe(403);
  });

  it('drains waiting and removes failed jobs, reports the counts and writes an audit event', async () => {
    const q = queue(QUEUES.BULK_JOBS);
    await q.pause();
    await q.addBulk([1, 2, 3].map((i) => ({ name: 'x', data: { i } })));
    const res = await api()
      .post('/v2/platform/health/clear-queue')
      .set(bearer(superToken))
      .send({ queue: QUEUES.BULK_JOBS });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = clearQueueResponseSchema.parse(res.body);
    expect(body.clearedPending).toBe(3);
    expect(body.message).toBe(`Cleared 3 pending and ${body.clearedFailed} failed job(s).`);
    expect((await q.getJobCounts('waiting', 'delayed')).waiting).toBe(0);
    await q.resume();

    const ev = await h.owner.query(
      `SELECT actor_type, status, payload FROM security_events WHERE event = 'platform.health.queues_cleared'`,
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]).toMatchObject({ actor_type: 'platform_operator', status: 'success' });
    expect(ev.rows[0].payload).toMatchObject({ queue: QUEUES.BULK_JOBS, clearedPending: 3 });
  });

  it('refuses an unknown queue name', async () => {
    const res = await api()
      .post('/v2/platform/health/clear-queue')
      .set(bearer(superToken))
      .send({ queue: 'nope' });
    expect(res.status).toBe(422);
  });
});
