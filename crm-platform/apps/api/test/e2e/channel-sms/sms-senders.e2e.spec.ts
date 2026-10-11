import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { installFakeSms, planWithSms, switchSmsOn, type FakeSms } from './support';

/** Connecting and managing SMS senders (TW-SMS-001 to 008, 025), against a real Postgres and a fake provider. */
let h: Harness;
let api: Api;
let sms: FakeSms;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  sms = installFakeSms(h);
  await switchSmsOn(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => sms.reset());

const tenant = async (label: string, opts: Parameters<typeof planWithSms>[2] = {}) => {
  const t = await api.signup(label);
  await planWithSms(h, t, opts);
  return t;
};
const post = (token: string, path: string, body?: object) =>
  api.http().post(path).set(bearer(token)).set('idempotency-key', randomUUID()).send(body);
const connect = (t: Tenant, body: object) =>
  post(t.admin, '/v2/sms/senders', {
    fromNumber: '+17372508034',
    accountSid: 'ACabc',
    authToken: 'tok-1',
    ...body,
  });
const list = (t: Tenant) => api.http().get('/v2/sms/senders').set(bearer(t.admin));
const rows = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT * FROM wa_provider_configs WHERE org_id = $1 AND provider = 'sms' ORDER BY id`,
      [t.orgId],
    )
  ).rows;
const sealed = (row: { credentials_json: string }) =>
  JSON.parse(h.app.get(CryptoService).decrypt(row.credentials_json)) as Record<string, string>;

describe('TW-SMS-002: connect a sender', () => {
  it('verifies with the provider, then stores a connected sender with encrypted keys and never returns a secret', async () => {
    const t = await tenant('s1');
    const res = await connect(t, { ratePerSegment: '0.0075', currency: 'usd' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      provider: 'twilio',
      label: 'SMS · Twilio',
      fromNumber: '+17372508034',
      alphanumeric: false,
      active: true,
      ratePerSegment: '0.0075',
      currency: 'USD',
      senderId: '',
      dltTemplateId: '',
      lastError: null,
      deliveryReportUrl: null,
      rowVersion: 1,
    });
    expect(res.body.senderKey).toBe(`sms:${res.body.id}`);
    expect(JSON.stringify(res.body)).not.toContain('tok-1');

    expect(sms.verifyCalls).toHaveLength(1);
    expect(sms.verifyCalls[0]).toMatchObject({
      provider: 'twilio',
      accountSid: 'ACabc',
      authToken: 'tok-1',
    });

    const [row] = await rows(t);
    expect(row).toMatchObject({
      status: 'connected',
      phone_number: '+17372508034',
      display_label: 'SMS · Twilio',
      is_primary: false,
    });
    expect(row.credentials_json).toMatch(/^v1:/);
    expect(row.credentials_json).not.toContain('tok-1');
    expect(sealed(row)).toEqual({
      account_sid: 'ACabc',
      auth_token: 'tok-1',
      from_number: '+17372508034',
    });
    expect(row.meta_json).toMatchObject({
      sms_provider: 'twilio',
      currency: 'USD',
      rate_per_segment: '0.0075',
    });

    expect(await api.auditCount(t.orgId, 'sms_senders', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'sms.sender.connected'))[0]).toMatchObject({
      provider: 'twilio',
      reconnected: false,
    });
  });

  it('the same From again updates the sender (new rate, one row); "1737..." and "+1737..." are two senders', async () => {
    const t = await tenant('s2');
    const first = await connect(t, { ratePerSegment: '0.01' });
    const again = await connect(t, { ratePerSegment: '0.02', authToken: 'tok-2' });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.ratePerSegment).toBe('0.02');
    expect(await rows(t)).toHaveLength(1);
    expect(sealed((await rows(t))[0]).auth_token).toBe('tok-2');
    expect(await api.auditCount(t.orgId, 'sms_senders', 'update')).toBe(1);
    expect((await api.events(t.orgId, 'sms.sender.connected')).at(-1)).toMatchObject({
      reconnected: true,
    });

    const other = await connect(t, { fromNumber: '17372508034' });
    expect(other.body.id).not.toBe(first.body.id);
    expect(await rows(t)).toHaveLength(2);
  });

  it('a re-submit of a deactivated sender connects it again', async () => {
    const t = await tenant('s2b');
    const first = await connect(t, {});
    await h.owner.query(
      `UPDATE wa_provider_configs SET status = 'disconnected' WHERE org_id = $1`,
      [t.orgId],
    );
    const again = await connect(t, {});
    expect(again.body).toMatchObject({ id: first.body.id, active: true });
  });

  it('keys the provider refuses save nothing and say why on the account field', async () => {
    const t = await tenant('s3');
    sms.verify = { ok: false, error: 'Twilio rejected those credentials: Authenticate' };
    const res = await connect(t, {});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SMS_CREDENTIALS_REJECTED');
    expect(res.body.detail ?? res.body.message).toContain('Twilio rejected those credentials');
    expect(JSON.stringify(res.body)).toContain('accountSid');
    expect(await rows(t)).toHaveLength(0);
    expect(await api.auditCount(t.orgId, 'sms_senders', 'insert')).toBe(0);
    expect(await api.events(t.orgId, 'sms.sender.connected')).toHaveLength(0);
  });

  it("blank Twilio keys reuse the workspace's WhatsApp Twilio keys, each field on its own", async () => {
    const t = await tenant('s4');
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, credentials_json)
       VALUES ($1, 'twilio', 'connected', '+14155238886', $2)`,
      [
        t.orgId,
        h.app.get(CryptoService).encrypt(
          JSON.stringify({
            account_sid: 'ACwhats',
            auth_token: 'whatstok',
            from_number: '+14155238886',
          }),
        ),
      ],
    );
    const res = await post(t.admin, '/v2/sms/senders', { fromNumber: '+17372508034' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(sms.verifyCalls[0]).toMatchObject({ accountSid: 'ACwhats', authToken: 'whatstok' });
    expect(sealed((await rows(t))[0])).toMatchObject({
      account_sid: 'ACwhats',
      auth_token: 'whatstok',
    });

    const mixed = await post(t.admin, '/v2/sms/senders', {
      fromNumber: '+17372508099',
      authToken: 'typed',
    });
    expect(mixed.status).toBe(201);
    expect(sms.verifyCalls[1]).toMatchObject({ accountSid: 'ACwhats', authToken: 'typed' });
  });

  it('MSG91: a key typed in the SID field is stored as the token (one place), with DLT fields and its own delivery-report address', async () => {
    const t = await tenant('s5');
    const res = await post(t.admin, '/v2/sms/senders', {
      provider: 'msg91',
      fromNumber: 'THRDWS',
      accountSid: 'KEY-IN-THE-WRONG-FIELD',
      senderId: 'THRDWS',
      dltTemplateId: 'TPL-1',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      provider: 'msg91',
      label: 'SMS · MSG91',
      alphanumeric: true,
      senderId: 'THRDWS',
      dltTemplateId: 'TPL-1',
    });
    expect(res.body.deliveryReportUrl).toMatch(/^https:\/\/.+\/v2\/sms\/status\/[A-Za-z0-9]{32}$/);
    expect(sms.verifyCalls[0]).toMatchObject({
      provider: 'msg91',
      accountSid: '',
      authToken: 'KEY-IN-THE-WRONG-FIELD',
    });
    const [row] = await rows(t);
    expect(sealed(row)).toMatchObject({ account_sid: '', auth_token: 'KEY-IN-THE-WRONG-FIELD' });
    expect(res.body.deliveryReportUrl.split('/').pop()).toBe(row.meta_json.dlr_secret);

    // The secret survives a re-submit, so the address pasted in the MSG91 panel keeps working.
    const again = await post(t.admin, '/v2/sms/senders', {
      provider: 'msg91',
      fromNumber: 'THRDWS',
      authToken: 'k2',
    });
    expect(again.body.deliveryReportUrl).toBe(res.body.deliveryReportUrl);
    expect(again.body).toMatchObject({ senderId: '', dltTemplateId: '' });
  });

  it('validates the input with the same words as Reference', async () => {
    const t = await tenant('s6');
    const bad = await post(t.admin, '/v2/sms/senders', { fromNumber: '+1', provider: 'telegram' });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('The selected sms provider is invalid.');
    expect((await post(t.admin, '/v2/sms/senders', { fromNumber: '' })).status).toBe(422);
    expect((await connect(t, { senderId: 'x'.repeat(17) })).status).toBe(422);
    expect((await connect(t, { ratePerSegment: '-1' })).status).toBe(422);
    expect(sms.verifyCalls).toHaveLength(0);
    expect(await rows(t)).toHaveLength(0);
  });

  it("the plan's device cap counts WhatsApp numbers and SMS senders together, for a NEW sender only", async () => {
    const t = await tenant('s7', { limits: { devices: 2 } });
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number) VALUES ($1, 'waba', 'connected', '919800000001')`,
      [t.orgId],
    );
    expect((await connect(t, {})).status).toBe(201);
    const over = await connect(t, { fromNumber: '+17372509999' });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(JSON.stringify(over.body)).toContain("You've reached your plan's limit of 2 devices.");
    expect(await rows(t)).toHaveLength(1);
    // Updating the one it has needs no new place.
    expect((await connect(t, { ratePerSegment: '0.5' })).status).toBe(201);
  });
});

describe('TW-SMS-001: the list', () => {
  it('lists senders oldest first with the platform switch and the delivery-report address, never a key', async () => {
    const t = await tenant('l1');
    await connect(t, { fromNumber: '+17372500001' });
    await post(t.admin, '/v2/sms/senders', {
      provider: 'msg91',
      fromNumber: 'THRDWS',
      authToken: 'k',
    });
    const res = await list(t);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { fromNumber: string }) => s.fromNumber)).toEqual([
      '+17372500001',
      'THRDWS',
    ]);
    expect(res.body.platformEnabled).toBe(true);
    expect(res.body.deliveryReportUrl).toMatch(/^https:\/\/.+\/v2\/sms\/status$/);
    expect(JSON.stringify(res.body)).not.toMatch(/tok-1|"k"|credentials/);
  });

  it('is empty for a workspace with no sender, and the switch reads off when the platform turns it off', async () => {
    const t = await tenant('l2');
    expect((await list(t)).body.data).toEqual([]);
    await switchSmsOn(h, false);
    expect((await list(t)).body.platformEnabled).toBe(false);
    await switchSmsOn(h, true);
  });
});

describe('TW-SMS-006: activate or deactivate', () => {
  it('switches a sender off and on, keeps the keys, and bumps the row version', async () => {
    const t = await tenant('t1');
    const s = (await connect(t, {})).body;
    const off = await api
      .as(t.admin)
      .patch(`/v2/sms/senders/${s.id}`)
      .set('idempotency-key', randomUUID())
      .send({ active: false, rowVersion: s.rowVersion });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body).toMatchObject({ active: false, rowVersion: s.rowVersion + 1 });
    const [row] = await rows(t);
    expect(row.status).toBe('disconnected');
    expect(sealed(row).auth_token).toBe('tok-1');
    expect((await api.events(t.orgId, 'sms.sender.toggled'))[0]).toMatchObject({
      uuid: s.id,
      active: false,
    });
    expect(await api.auditCount(t.orgId, 'sms_senders', 'update')).toBe(1);

    const on = await api
      .as(t.admin)
      .patch(`/v2/sms/senders/${s.id}`)
      .set('idempotency-key', randomUUID())
      .send({ active: true, rowVersion: off.body.rowVersion });
    expect(on.body.active).toBe(true);
  });

  it('a stale row version is 409 ROW_VERSION_CONFLICT and changes nothing; a repeat of the same state writes nothing', async () => {
    const t = await tenant('t2');
    const s = (await connect(t, {})).body;
    const stale = await api
      .as(t.admin)
      .patch(`/v2/sms/senders/${s.id}`)
      .set('idempotency-key', randomUUID())
      .send({ active: false, rowVersion: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await rows(t))[0].status).toBe('connected');

    const same = await api
      .as(t.admin)
      .patch(`/v2/sms/senders/${s.id}`)
      .set('idempotency-key', randomUUID())
      .send({ active: true, rowVersion: s.rowVersion });
    expect(same.status).toBe(200);
    expect(await api.events(t.orgId, 'sms.sender.toggled')).toHaveLength(0);
  });

  it('another workspace\'s sender is "not found", and nothing changes', async () => {
    const a = await tenant('t3a');
    const b = await tenant('t3b');
    const s = (await connect(a, {})).body;
    const res = await api
      .as(b.admin)
      .patch(`/v2/sms/senders/${s.id}`)
      .set('idempotency-key', randomUUID())
      .send({ active: false, rowVersion: 1 });
    expect(res.status).toBe(404);
    expect((await rows(a))[0].status).toBe('connected');
    expect((await list(b)).body.data).toEqual([]);
  });
});

describe('TW-SMS-007: remove', () => {
  it('deletes the sender and its keys, with an audit row and an event', async () => {
    const t = await tenant('d1');
    const s = (await connect(t, {})).body;
    const res = await api.as(t.admin).delete(`/v2/sms/senders/${s.id}`);
    expect(res.status).toBe(204);
    expect(await rows(t)).toHaveLength(0);
    expect(await api.auditCount(t.orgId, 'sms_senders', 'delete')).toBe(1);
    expect((await api.events(t.orgId, 'sms.sender.removed'))[0]).toMatchObject({ uuid: s.id });
  });

  it("an unknown id, or another workspace's, answers the same and changes nothing", async () => {
    const a = await tenant('d2a');
    const b = await tenant('d2b');
    const s = (await connect(a, {})).body;
    expect((await api.as(b.admin).delete(`/v2/sms/senders/${s.id}`)).status).toBe(204);
    expect((await api.as(b.admin).delete(`/v2/sms/senders/${randomUUID()}`)).status).toBe(204);
    expect(await rows(a)).toHaveLength(1);
    expect(await api.events(b.orgId, 'sms.sender.removed')).toHaveLength(0);
    expect((await api.as(b.admin).delete('/v2/sms/senders/not-a-uuid')).status).toBe(400);
  });
});

describe('TW-SMS-008: check a number', () => {
  it('uses the first connected Twilio sender, answers with a sentence, and caches a verdict per workspace', async () => {
    const t = await tenant('k1');
    await connect(t, {});
    const first = await post(t.admin, '/v2/sms/lookup', { number: '+1 (415) 555-1234' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({
      digits: '14155551234',
      kind: 'mobile',
      carrier: 'Airtel',
      message: 'Mobile — can receive SMS. Carrier: Airtel.',
    });
    expect(sms.lookupCalls).toHaveLength(1);
    expect(sms.lookupCalls[0]!.creds).toMatchObject({ provider: 'twilio', authToken: 'tok-1' });

    const second = await post(t.admin, '/v2/sms/lookup', { number: '14155551234' });
    expect(second.body).toEqual(first.body);
    expect(sms.lookupCalls).toHaveLength(1);

    // Another workspace asks its own provider: Reference shared one cache across every workspace.
    const other = await tenant('k1b');
    await connect(other, {});
    await post(other.admin, '/v2/sms/lookup', { number: '14155551234' });
    expect(sms.lookupCalls).toHaveLength(2);
  });

  it('with no connected Twilio sender it says so, and an MSG91-only workspace cannot check', async () => {
    const t = await tenant('k2');
    const none = await post(t.admin, '/v2/sms/lookup', { number: '+14155551234' });
    expect(none.body).toMatchObject({
      kind: 'unknown',
      message: 'Connect a Twilio SMS number first.',
    });
    await post(t.admin, '/v2/sms/senders', {
      provider: 'msg91',
      fromNumber: 'THRDWS',
      authToken: 'k',
    });
    const msg91Only = await post(t.admin, '/v2/sms/lookup', { number: '+14155551234' });
    expect(msg91Only.body.message).toBe('Connect a Twilio SMS number first.');
    expect(sms.lookupCalls).toHaveLength(0);
  });

  it('a provider failure is not cached, and non-digit input says it is not a number', async () => {
    const t = await tenant('k3');
    await connect(t, {});
    sms.lookup = {
      ok: false,
      digits: '',
      kind: 'unknown',
      carrier: null,
      message: 'Could not reach the lookup service.',
    };
    await post(t.admin, '/v2/sms/lookup', { number: '+14155559999' });
    await post(t.admin, '/v2/sms/lookup', { number: '+14155559999' });
    expect(sms.lookupCalls).toHaveLength(2);
    const junk = await post(t.admin, '/v2/sms/lookup', { number: 'call me maybe' });
    expect(junk.body.message).toBe('That is not a phone number.');
    expect(sms.lookupCalls).toHaveLength(2);
  });
});

describe('TW-SMS-025: the plan gate and permissions', () => {
  it('a workspace whose plan has no SMS is refused 422 PLAN_FEATURE_LOCKED on every route, reads included; nothing is saved', async () => {
    const t = await tenant('g1', { sms: false });
    const l = await list(t);
    expect(l.status).toBe(422);
    expect(l.body.code).toBe('PLAN_FEATURE_LOCKED');
    const c = await connect(t, {});
    expect(c.status).toBe(422);
    expect(c.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect((await post(t.admin, '/v2/sms/lookup', { number: '+14155551234' })).status).toBe(422);
    expect(await rows(t)).toHaveLength(0);
    expect(sms.verifyCalls).toHaveLength(0);
  });

  it('the plan is checked before the body is validated', async () => {
    const t = await tenant('g2', { sms: false });
    const res = await post(t.admin, '/v2/sms/senders', { provider: 'nope' });
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
  });

  it('read lets a member see and check; only manage connects, switches and removes; none sees nothing', async () => {
    const t = await tenant('g3');
    const s = (await connect(t, {})).body;
    const reader = await api.member(t, 'reader', [['sms.senders.read']]);
    const none = await api.member(t, 'nobody', [['record.contacts.read']]);

    expect((await api.as(reader.token).get('/v2/sms/senders')).status).toBe(200);
    expect(
      (await api.as(reader.token).post('/v2/sms/lookup').send({ number: '+14155551234' })).status,
    ).toBe(200);
    expect(
      (
        await api
          .as(reader.token)
          .post('/v2/sms/senders')
          .set('idempotency-key', randomUUID())
          .send({ fromNumber: '+1', authToken: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api
          .as(reader.token)
          .patch(`/v2/sms/senders/${s.id}`)
          .set('idempotency-key', randomUUID())
          .send({ active: false, rowVersion: 1 })
      ).status,
    ).toBe(403);
    expect((await api.as(reader.token).delete(`/v2/sms/senders/${s.id}`)).status).toBe(403);

    expect((await api.as(none.token).get('/v2/sms/senders')).status).toBe(403);
    expect(
      (await api.as(none.token).post('/v2/sms/lookup').send({ number: '+14155551234' })).status,
    ).toBe(403);
    expect((await api.http().get('/v2/sms/senders')).status).toBe(401);
    expect(await rows(t)).toHaveLength(1);
  });

  it('the admin preset holds both keys, so a new workspace can use the channel at once', async () => {
    const t = await tenant('g4');
    const keys = (
      await h.owner.query(
        `SELECT permission_key FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
         WHERE g.org_id = $1 AND r.system_key = 'admin' AND g.permission_key LIKE 'sms.%' ORDER BY 1`,
        [t.orgId],
      )
    ).rows.map((r) => r.permission_key);
    expect(keys).toEqual(['sms.senders.manage', 'sms.senders.read']);
  });
});

describe('the table', () => {
  it('has row-level security forced and one SMS sender per From value', async () => {
    const t = await tenant('r1');
    await connect(t, {});
    const rls = await h.owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'wa_provider_configs'`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    await expect(
      h.owner.query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number) VALUES ($1, 'sms', 'connected', '+17372508034')`,
        [t.orgId],
      ),
    ).rejects.toThrow(/uq_wa_provider_configs_sms_from/);
    // The same value on another provider is not an SMS sender and is not blocked.
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number) VALUES ($1, 'twilio', 'connected', '+17372508034')`,
      [t.orgId],
    );
  });
});
