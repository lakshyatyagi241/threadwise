import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wabooMigrationRunSchema, wabooMigrationRunsResponseSchema } from '@crm/contracts';
import { QUEUES } from '../../../src/infra/queue/queues';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { Api, bearer } from '../contacts-attributes-tags/support';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/** The Waboo migration panel API end to end: super admin only, the load gate, one active run per client, cancel, no ids or secrets. */
let h: Harness;
let api: Api;
let superToken = '';
let supportToken = '';

const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
const ops = (method: 'get' | 'post', path: string, token = superToken) =>
  api.http()[method](`/v2/platform/waboo-migration${path}`).set(bearer(token));

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const first = await api
    .http()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api.http().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api
    .http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const support = await api
    .http()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = support.body.tokens.accessToken as string;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string; errors?: Array<{ code?: string }> } }) =>
  res.body.code ?? res.body.errors?.[0]?.code;

describe('waboo migration runs', () => {
  it('is for super admins only, reads included', async () => {
    expect((await ops('get', '/runs', supportToken)).status).toBe(403);
    expect((await api.http().get('/v2/platform/waboo-migration/runs')).status).toBe(401);
  });

  it('queues a dry run by default; the job carries only the run id; the response has no internal ids', async () => {
    const res = await ops('post', '/runs').send({ sourceClient: 'acme', sourceDb: 'waboo_acme' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const run = wabooMigrationRunSchema.parse(res.body);
    expect(run).toMatchObject({ mode: 'dry', status: 'queued', steps: [], report: null });
    expect(Object.keys(res.body)).not.toContain('orgId');

    const queue = h.app.get<Queue>(getQueueToken(QUEUES.WAB_MIGRATE));
    const job = await queue.getJob(`wmig-${run.id}`);
    expect(job?.data).toEqual({ runUuid: run.id });

    const stored = await h.owner.query(
      `SELECT mode, status, source_db FROM waboo_migration_runs WHERE uuid = $1`,
      [run.id],
    );
    expect(stored.rows[0]).toEqual({ mode: 'dry', status: 'queued', source_db: 'waboo_acme' });

    const events = await h.owner.query(
      `SELECT event FROM security_events WHERE event = 'platform.waboo_migration.created'`,
    );
    expect(events.rowCount).toBeGreaterThan(0);

    const list = wabooMigrationRunsResponseSchema.parse((await ops('get', '/runs')).body);
    expect(list.data.map((r) => r.id)).toContain(run.id);
    expect((await ops('get', `/runs/${run.id}`)).body.id).toBe(run.id);
  });

  it('allows one active run per client', async () => {
    const body = { sourceClient: 'solo', sourceDb: 'waboo_solo' };
    expect((await ops('post', '/runs').send(body)).status).toBe(201);
    const again = await ops('post', '/runs').send(body);
    expect(again.status).toBe(409);
    expect(code(again)).toBe('WMIG_RUN_ACTIVE');
  });

  it.each([
    { sourceClient: 'Bad Client', sourceDb: 'x' },
    { sourceClient: 'ok', sourceDb: 'x; drop table users' },
    { sourceClient: 'ok', sourceDb: 'db-with-dash' },
  ])('refuses %j before anything is queued', async (body) => {
    const res = await ops('post', '/runs').send(body);
    expect([400, 422]).toContain(res.status);
  });

  it('gates a load on the typed client key and a green dry run from the last 24 hours', async () => {
    const body = { sourceClient: 'gated', sourceDb: 'waboo_gated', mode: 'load' };

    const noConfirm = await ops('post', '/runs').send(body);
    expect(noConfirm.status).toBe(422);
    expect(code(noConfirm)).toBe('WMIG_CONFIRM_MISMATCH');

    const noDry = await ops('post', '/runs').send({ ...body, confirmClient: 'gated' });
    expect(noDry.status).toBe(422);
    expect(code(noDry)).toBe('WMIG_DRY_RUN_REQUIRED');

    // A dry run that finished red does not unlock a load.
    await h.owner.query(
      `INSERT INTO waboo_migration_runs (source_client, source_db, mode, status, report, finished_at)
       VALUES ('gated', 'waboo_gated', 'dry', 'completed', '{"green":false}'::jsonb, now())`,
    );
    expect(code(await ops('post', '/runs').send({ ...body, confirmClient: 'gated' }))).toBe(
      'WMIG_DRY_RUN_REQUIRED',
    );

    // A green one does, but only if it is recent and the confirmation matches.
    await h.owner.query(
      `INSERT INTO waboo_migration_runs (source_client, source_db, mode, status, report, finished_at)
       VALUES ('gated', 'waboo_gated', 'dry', 'completed', '{"green":true}'::jsonb, now())`,
    );
    expect(code(await ops('post', '/runs').send({ ...body, confirmClient: 'other' }))).toBe(
      'WMIG_CONFIRM_MISMATCH',
    );
    const ok = await ops('post', '/runs').send({ ...body, confirmClient: 'gated' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.mode).toBe('load');
  });

  it('cancels a queued run once; a running or finished run cannot be cancelled', async () => {
    const created = await ops('post', '/runs').send({ sourceClient: 'cancelme', sourceDb: 'db1' });
    const id = created.body.id as string;

    const cancelled = await ops('post', `/runs/${id}/cancel`);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    const again = await ops('post', `/runs/${id}/cancel`);
    expect(again.status).toBe(409);
    expect(code(again)).toBe('WMIG_NOT_CANCELLABLE');

    await h.owner.query(
      `INSERT INTO waboo_migration_runs (source_client, source_db, mode, status, started_at)
       VALUES ('busy', 'db2', 'dry', 'running', now())`,
    );
    const busy = await h.owner.query(
      `SELECT uuid FROM waboo_migration_runs WHERE source_client = 'busy'`,
    );
    const running = await ops('post', `/runs/${busy.rows[0].uuid}/cancel`);
    expect(running.status).toBe(409);
    expect(code(running)).toBe('WMIG_NOT_CANCELLABLE');
  });
});
