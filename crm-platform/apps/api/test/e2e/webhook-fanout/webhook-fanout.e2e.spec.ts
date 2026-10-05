import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webhookTargetItemSchema, webhookTargetsResponseSchema } from '@crm/contracts';
import { QUEUES } from '../../../src/infra/queue/queues';
import { WebhookFanoutService } from '../../../src/modules/webhook-fanout';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { Api, bearer } from '../contacts-attributes-tags/support';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/** The webhook forward targets end to end: operator-only CRUD, address safety, secrecy of the header, and the enqueue side. */
let h: Harness;
let api: Api;
let superToken = '';
let supportToken = '';

const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
const ops = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token = superToken) =>
  api.http()[method](`/v2/platform/webhook-targets${path}`).set(bearer(token));

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

describe('webhook forward targets', () => {
  it('is for super admins only, reads included', async () => {
    expect((await ops('get', '', supportToken)).status).toBe(403);
    expect((await api.http().get('/v2/platform/webhook-targets')).status).toBe(401);
  });

  it('creates, hides the header value, edits with the row version, and deletes', async () => {
    const created = await ops('post', '').send({
      name: 'Geta',
      url: 'https://8.8.8.8/hook',
      authHeaderName: 'X-Secret',
      authHeaderValue: 'super-secret-value-1234',
      fieldFilter: ['messages'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const item = webhookTargetItemSchema.parse(created.body);
    expect(item.hasAuthHeader).toBe(true);
    expect(item.authHeaderLast4).toBe('1234');
    expect(JSON.stringify(created.body)).not.toContain('super-secret-value');
    const stored = await h.owner.query(
      `SELECT auth_header_value FROM webhook_forward_targets WHERE uuid = $1`,
      [item.id],
    );
    expect(stored.rows[0].auth_header_value).not.toContain('super-secret');

    const dup = await ops('post', '').send({ name: 'Geta', url: 'https://8.8.4.4/x' });
    expect(dup.status).toBe(409);

    const edited = await ops('patch', `/${item.id}`).send({
      rowVersion: item.rowVersion,
      isActive: false,
      fieldFilter: [],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.isActive).toBe(false);
    expect(edited.body.fieldFilter).toEqual([]);
    expect(edited.body.hasAuthHeader).toBe(true);

    const stale = await ops('patch', `/${item.id}`).send({
      rowVersion: item.rowVersion,
      name: 'x',
    });
    expect(stale.status).toBe(409);

    const list = webhookTargetsResponseSchema.parse((await ops('get', '')).body);
    expect(list.data.map((t) => t.name)).toContain('Geta');

    expect((await ops('delete', `/${item.id}`)).status).toBe(204);
    expect((await ops('delete', `/${item.id}`)).status).toBe(404);
  });

  it.each([
    'http://8.8.8.8/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest',
    'https://localhost/hook',
    'https://user:pw@8.8.8.8/hook',
  ])('refuses %s as a target', async (url) => {
    const res = await ops('post', '').send({ name: `bad-${randomUUID()}`, url });
    expect(res.status).toBe(422);
    expect(res.body.code ?? res.body.errors?.[0]?.code).toBeDefined();
  });

  it('enqueues one job per matching active target and none for a switched-off one', async () => {
    const mk = async (name: string, extra: Record<string, unknown> = {}) =>
      webhookTargetItemSchema.parse(
        (await ops('post', '').send({ name, url: 'https://8.8.8.8/h', ...extra })).body,
      );
    const all = await mk('all-fields');
    await mk('messages-only', { fieldFilter: ['messages'] });
    await mk('templates-only', { fieldFilter: ['message_template_status_update'] });
    const off = await mk('off', { isActive: false });

    const fanout = h.app.get(WebhookFanoutService);
    fanout.invalidate();
    const body = Buffer.from(
      JSON.stringify({ object: 'whatsapp_business_account', n: randomUUID() }),
    );
    const queued = await fanout.forward({
      rawBody: body,
      signatureHeader: 'sha256=abc',
      contentType: 'application/json',
      fields: ['messages'],
    });
    expect(queued).toBe(2);

    const queue = h.app.get<Queue>(getQueueToken(QUEUES.WEBHOOK_FORWARD));
    const pending = async () =>
      (await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized'], 0, 100)).filter(
        (j) => j.data.body === body.toString('base64'),
      );
    const mine = await pending();
    expect(mine.length).toBe(2);
    expect(mine.every((j) => j.data.signatureHeader === 'sha256=abc')).toBe(true);
    expect(off.isActive).toBe(false);
    expect(all.fieldFilter).toEqual([]);

    // The same bytes again are absorbed (a Meta retry), not queued twice.
    await fanout.forward({ rawBody: body, fields: ['messages'] });
    expect((await pending()).length).toBe(2);
  });
});
