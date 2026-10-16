import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  wabooMigrationBatchDetailSchema,
  wabooMigrationReadinessSchema,
  wabooMigrationRunSchema,
} from '@crm/contracts';
import { QUEUES } from '../../../src/infra/queue/queues';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { Api, bearer } from '../contacts-attributes-tags/support';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Organization id input, derived client key, scheduling, readiness, and bulk batches end to end.
 * NOTE: written together with the feature but NOT RUN when it was added (the API e2e harness could not start in that checkout).
 */
let h: Harness;
let api: Api;
let superToken = '';

const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
const ops = (method: 'get' | 'post', path: string, token = superToken) =>
  api.http()[method](`/v2/platform/waboo-migration${path}`).set(bearer(token));
const code = (res: { body: { code?: string; errors?: Array<{ code?: string }> } }) =>
  res.body.code ?? res.body.errors?.[0]?.code;
const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();
const greenDry = (client: string, db: string) =>
  h.owner.query(
    `INSERT INTO waboo_migration_runs (source_client, source_db, mode, status, report, finished_at)
     VALUES ($1, $2, 'dry', 'completed', '{"green":true,"verdict":"green","unaccounted":0,"integrityErrors":0,"alarms":0,"summary":""}'::jsonb, now())`,
    [client, db],
  );

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const first = await api
    .http()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api.http().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await api
    .http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  superToken = token;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('organization id and derived client key', () => {
  it('derives the client key from the organization id when none is given', async () => {
    const res = await ops('post', '/runs').send({ organizationId: 'Acme_Org_9' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const run = wabooMigrationRunSchema.parse(res.body);
    expect(run).toMatchObject({
      organizationId: 'Acme_Org_9',
      sourceClient: 'acme_org_9',
      mode: 'dry',
    });
  });

  it('refuses an organization id that is not a database name', async () => {
    for (const organizationId of ['a-b', 'x; drop table users', '', 'a b'])
      expect([400, 422]).toContain((await ops('post', '/runs').send({ organizationId })).status);
  });

  it('refuses a derived client key already used by a different Waboo organization', async () => {
    await greenDry('shared', 'Shared');
    const res = await ops('post', '/runs').send({ organizationId: 'SHARED' });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('WMIG_CLIENT_COLLISION');
  });
});

describe('scheduling', () => {
  it('queues a delayed job for a future run_at and cancel removes it', async () => {
    const res = await ops('post', '/runs').send({
      organizationId: 'sched1',
      runAt: inFuture(3_600_000),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.runAt).toBeTruthy();
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.WAB_MIGRATE));
    const job = await queue.getJob(`wmig-${res.body.id}`);
    expect(await job?.getState()).toBe('delayed');
    expect((await ops('post', `/runs/${res.body.id}/cancel`)).body.status).toBe('cancelled');
    expect(await queue.getJob(`wmig-${res.body.id}`)).toBeUndefined();
  });

  it.each([
    ['in the past', () => inFuture(-60_000)],
    ['more than 90 days ahead', () => inFuture(91 * 86_400_000)],
  ])('refuses a run_at %s', async (_n, at) => {
    const res = await ops('post', '/runs').send({ organizationId: 'sched2', runAt: at() });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('WMIG_SCHEDULE_INVALID');
  });
});

describe('readiness', () => {
  it('reports per organization whether its latest dry run is green and fresh', async () => {
    await greenDry('ready1', 'ready1');
    const res = await ops('post', '/readiness').send({ organizationIds: ['ready1', 'neverran'] });
    expect(res.status).toBe(200);
    const { data } = wabooMigrationReadinessSchema.parse(res.body);
    expect(data.find((d) => d.organizationId === 'ready1')).toMatchObject({
      canLoad: true,
      reason: 'ok',
      verdict: 'green',
    });
    expect(data.find((d) => d.organizationId === 'neverran')).toMatchObject({
      canLoad: false,
      reason: 'no_dry',
    });
  });
});

describe('bulk batches', () => {
  it('queues a dry batch of organizations, one batch job, children listed in order', async () => {
    const res = await ops('post', '/batches').send({
      organizationIds: ['bulkA', 'bulkB', 'bulkC'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const batch = wabooMigrationBatchDetailSchema.parse(res.body);
    expect(batch).toMatchObject({
      status: 'queued',
      mode: 'dry',
      concurrency: 1,
      total: 3,
      stopOnFailure: false,
    });
    expect(batch.items.map((i) => [i.organizationId, i.position, i.status])).toEqual([
      ['bulkA', 1, 'queued'],
      ['bulkB', 2, 'queued'],
      ['bulkC', 3, 'queued'],
    ]);
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.WAB_MIGRATE));
    expect((await queue.getJob(`wmig-batch-${batch.id}`))?.data).toEqual({ batchUuid: batch.id });
    // children are walked by the batch job, never queued on their own
    expect(await queue.getJob(`wmig-${batch.items[0]!.id}`)).toBeUndefined();
    expect((await ops('get', `/batches/${batch.id}`)).body.id).toBe(batch.id);
  });

  it('refuses more than 50 organizations, duplicates and colliding keys', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `many${i}`);
    expect([400, 422]).toContain(
      (await ops('post', '/batches').send({ organizationIds: many })).status,
    );
    const dup = await ops('post', '/batches').send({ organizationIds: ['dupx', 'dupx'] });
    expect(code(dup)).toBe('WMIG_CLIENT_COLLISION');
    const collide = await ops('post', '/batches').send({
      organizationIds: ['CollideX', 'collidex'],
    });
    expect(code(collide)).toBe('WMIG_CLIENT_COLLISION');
  });

  it('a bulk load needs the typed count only: no dry run is needed for any organization', async () => {
    const ids = ['lg1', 'lg2'];
    const noCount = await ops('post', '/batches').send({ organizationIds: ids, mode: 'load' });
    expect(code(noCount)).toBe('WMIG_CONFIRM_MISMATCH');
    const wrong = await ops('post', '/batches').send({
      organizationIds: ids,
      mode: 'load',
      confirmCount: 5,
    });
    expect(code(wrong)).toBe('WMIG_CONFIRM_MISMATCH');
    const ok = await ops('post', '/batches').send({
      organizationIds: ids,
      mode: 'load',
      confirmCount: 2,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.mode).toBe('load');
  });

  it('cancels a queued batch with all its queued children; a second cancel is refused', async () => {
    const created = await ops('post', '/batches').send({
      organizationIds: ['cancA', 'cancB'],
      runAt: inFuture(3_600_000),
    });
    const id = created.body.id as string;
    const done = await ops('post', `/batches/${id}/cancel`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe('cancelled');
    expect(done.body.items.map((i: { status: string }) => i.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(code(await ops('post', `/batches/${id}/cancel`))).toBe('WMIG_NOT_CANCELLABLE');
  });

  it('one active run per client also holds across batches', async () => {
    await ops('post', '/batches').send({ organizationIds: ['actv1'] });
    const again = await ops('post', '/batches').send({ organizationIds: ['actv1'] });
    expect(again.status).toBe(409);
    expect(code(again)).toBe('WMIG_RUN_ACTIVE');
  });

  it('the database refuses a second concurrently running run', async () => {
    await h.owner.query(
      `UPDATE waboo_migration_runs SET status = 'failed' WHERE status = 'running'`,
    );
    await h.owner.query(
      `INSERT INTO waboo_migration_runs (source_client, source_db, status, started_at) VALUES ('one1','one1','running',now())`,
    );
    await expect(
      h.owner.query(
        `INSERT INTO waboo_migration_runs (source_client, source_db, status, started_at) VALUES ('one2','one2','running',now())`,
      ),
    ).rejects.toThrow(/uq_wmig_one_running/);
  });
});
