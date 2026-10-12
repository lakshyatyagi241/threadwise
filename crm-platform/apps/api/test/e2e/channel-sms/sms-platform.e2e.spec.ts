import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import { Api, bearer, startHarness, type Harness } from '../contacts-attributes-tags/support';
import { installFakeSms, planWithSms, type FakeSms } from './support';

/**
 * The operator console's SMS switch (TW-SMS-025): who may change it, the audit row, and that the workspace-facing screens see the
 * change on the next request. Real app, real Postgres, started with the switch in its production default: OFF (no row).
 */
let h: Harness;
let api: Api;
let sms: FakeSms;
let superToken = '';
let supportToken = '';
const http = () => request(h.app.getHttpServer());
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
const setSwitch = (enabled: boolean, token = superToken) =>
  http().put('/v2/platform/sms').set(bearer(token)).send({ enabled });

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  sms = installFakeSms(h);
  const first = await http()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await http().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const sup = await http()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /v2/platform/sms', () => {
  it('reads OFF by default, for any operator', async () => {
    for (const token of [superToken, supportToken]) {
      const res = await http().get('/v2/platform/sms').set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: false });
    }
  });

  it('is operator only: a workspace token and no token get 401', async () => {
    const t = await api.signup('sp-read');
    expect((await http().get('/v2/platform/sms').set(bearer(t.admin))).status).toBe(401);
    expect((await http().get('/v2/platform/sms')).status).toBe(401);
  });
});

describe('PUT /v2/platform/sms', () => {
  it('only a super admin may change it: support gets 403, a workspace admin 401, no token 401', async () => {
    expect((await setSwitch(true, supportToken)).status).toBe(403);
    const t = await api.signup('sp-perm');
    expect((await setSwitch(true, t.admin)).status).toBe(401);
    expect((await http().put('/v2/platform/sms').send({ enabled: true })).status).toBe(401);
    expect((await http().get('/v2/platform/sms').set(bearer(superToken))).body.enabled).toBe(false);
  });

  it('validates the body', async () => {
    expect((await setSwitch('yes' as never)).status).toBe(422);
    const missing = await http().put('/v2/platform/sms').set(bearer(superToken)).send({});
    expect(missing.status).toBe(422);
  });

  it('turning it on and off returns the new state and writes one audit row each, with before and after', async () => {
    await h.owner.query(`DELETE FROM security_events WHERE event = 'platform.sms_updated'`);
    const on = await setSwitch(true);
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toEqual({ enabled: true });
    expect((await http().get('/v2/platform/sms').set(bearer(superToken))).body).toEqual({
      enabled: true,
    });
    expect((await setSwitch(false)).body).toEqual({ enabled: false });
    // idempotent: the same state again still leaves an audit row
    expect((await setSwitch(false)).body).toEqual({ enabled: false });
    const rows = (
      await h.owner.query(
        `SELECT actor_type, payload FROM security_events WHERE event = 'platform.sms_updated' ORDER BY id`,
      )
    ).rows as Array<{
      actor_type: string;
      payload: { before: { enabled: boolean }; after: { enabled: boolean } };
    }>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      actor_type: 'platform_operator',
      payload: { before: { enabled: false }, after: { enabled: true } },
    });
    expect(rows[1]!.payload).toEqual({ before: { enabled: true }, after: { enabled: false } });
    expect(rows[2]!.payload).toEqual({ before: { enabled: false }, after: { enabled: false } });
  });

  it('a refused change writes no audit row', async () => {
    const before = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.sms_updated'`,
    );
    await setSwitch(true, supportToken);
    const after = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.sms_updated'`,
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('what workspaces see', () => {
  it('GET /v2/sms/senders platformEnabled and the composer sender list follow the switch at once', async () => {
    const t = await api.signup('sp-effect');
    await planWithSms(h, t);
    const created = await api
      .http()
      .post('/v2/sms/senders')
      .set(bearer(t.admin))
      .set('idempotency-key', crypto.randomUUID())
      .send({ fromNumber: '+17372508034', accountSid: 'ACabc', authToken: 'tok-1' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    sms.reset();

    expect((await setSwitch(false)).status).toBe(200);
    const list = () => api.http().get('/v2/sms/senders').set(bearer(t.admin));
    const compose = () => api.http().get('/v2/broadcasts/compose?channel=sms').set(bearer(t.admin));
    expect((await list()).body.platformEnabled).toBe(false);
    expect((await compose()).body.senders).toEqual([]);

    await setSwitch(true);
    expect((await list()).body.platformEnabled).toBe(true);
    expect((await compose()).body.senders).toHaveLength(1);

    await setSwitch(false);
    const off = await list();
    expect(off.body.platformEnabled).toBe(false);
    // the sender itself is untouched: the switch only hides entry points
    expect(off.body.data).toHaveLength(1);
    expect((await compose()).body.senders).toEqual([]);
  });
});
