import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, UNOFFICIAL_WHATSAPP_FEATURE_KEY } from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { BroadcastDueService } from '../../../src/modules/broadcasts/broadcast-due.service';
import { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import { waKeys } from '../../../src/modules/node-bridge-runtime/runtime/wa-redis';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { rig, worker as buildWorker, type Rig } from './support';

/**
 * The platform switch for the unofficial WhatsApp engine (owner decision 2026-10-05), against the real app, real Postgres and Redis,
 * started with the switch in its production default: OFF. The suites written before the switch start with it ON (see the harness).
 */
let h: Harness;
let api: Api;
let r: Rig;
let superToken = '';
let supportToken = '';
const runtimes: DeviceRuntimeService[] = [];
const http = () => request(h.app.getHttpServer());
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

const setSwitch = async (enabled: boolean) => {
  const res = await http()
    .put('/v2/platform/node-bridge/unofficial')
    .set(bearer(superToken))
    .send({ enabled });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
};

beforeAll(async () => {
  h = await startHarness({ unofficialWhatsapp: false });
  api = new Api(h);
  r = rig(h);
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
  for (const rt of runtimes.splice(0)) await rt.onApplicationShutdown();
  await h?.stop();
});

let seq = 0;
const phone = () => `+91981${String(1000000 + seq++).padStart(7, '0')}`;
const device = async (t: Tenant, status = 'connected') =>
  (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Phone', '+91', $2, $3, true) RETURNING id, uuid`,
      [t.orgId, `98${String(2000000 + seq++).padStart(8, '0')}`, status],
    )
  ).rows[0] as { id: string; uuid: string };
const template = async (t: Tenant) =>
  (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
       VALUES ($1, $2, 'Hello', 'standard', 'approved') RETURNING uuid`,
      [t.orgId, `t${randomUUID().slice(0, 8)}`],
    )
  ).rows[0].uuid as string;
const people = async (t: Tenant, n: number) =>
  api.seedContacts(
    t,
    Array.from({ length: n }, (_, i) => ({ name: `P${seq}-${i}`, phone: phone() })),
  );
const count = async (sql: string, args: unknown[]) =>
  Number((await h.owner.query(sql, args)).rows[0].n);

describe('the admin API', () => {
  it('reads OFF by default and shows the flag in the node-bridge settings payload', async () => {
    const res = await http().get('/v2/platform/node-bridge').set(bearer(superToken));
    expect(res.status).toBe(200);
    expect(res.body.unofficialEnabled).toBe(false);
  });

  it('only a super admin may change it: support gets 403, a workspace token and no token get 401', async () => {
    const body = { enabled: true };
    const support = await http()
      .put('/v2/platform/node-bridge/unofficial')
      .set(bearer(supportToken))
      .send(body);
    expect(support.status).toBe(403);
    const t = await api.signup('us-perm');
    const tenant = await http()
      .put('/v2/platform/node-bridge/unofficial')
      .set(bearer(t.admin))
      .send(body);
    // A workspace token is not an operator session at all: the operator guard answers 401.
    expect(tenant.status).toBe(401);
    expect((await http().put('/v2/platform/node-bridge/unofficial').send(body)).status).toBe(401);
    const still = await http().get('/v2/platform/node-bridge').set(bearer(superToken));
    expect(still.body.unofficialEnabled).toBe(false);
  });

  it('validates the body', async () => {
    const res = await http()
      .put('/v2/platform/node-bridge/unofficial')
      .set(bearer(superToken))
      .send({ enabled: 'yes' });
    expect(res.status).toBe(422);
  });

  it('turning it on and off returns the new state and writes an audit row with before and after', async () => {
    await h.owner.query(
      `DELETE FROM security_events WHERE event = 'platform.whatsapp_unofficial.updated'`,
    );
    expect((await setSwitch(true)).body).toEqual({ unofficialEnabled: true });
    const read = await http().get('/v2/platform/node-bridge').set(bearer(superToken));
    expect(read.body.unofficialEnabled).toBe(true);
    expect((await setSwitch(false)).body).toEqual({ unofficialEnabled: false });
    const rows = (
      await h.owner.query(
        `SELECT actor_type, payload FROM security_events WHERE event = 'platform.whatsapp_unofficial.updated' ORDER BY id`,
      )
    ).rows as Array<{
      actor_type: string;
      payload: { before: { enabled: boolean }; after: { enabled: boolean } };
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      actor_type: 'platform_operator',
      payload: { before: { enabled: false }, after: { enabled: true } },
    });
    expect(rows[1]!.payload).toEqual({ before: { enabled: true }, after: { enabled: false } });
  });
});

describe('entitlements', () => {
  it('carry unofficial_whatsapp only while the switch is on', async () => {
    const t = await api.signup('us-ent');
    const keys = async () =>
      (await http().get('/v2/billing/entitlements').set(bearer(t.admin))).body.features as string[];
    expect(await keys()).not.toContain(UNOFFICIAL_WHATSAPP_FEATURE_KEY);
    await setSwitch(true);
    expect(await keys()).toContain(UNOFFICIAL_WHATSAPP_FEATURE_KEY);
    await setSwitch(false);
    expect(await keys()).not.toContain(UNOFFICIAL_WHATSAPP_FEATURE_KEY);
  });
});

describe('creating work that targets a personal number', () => {
  it('a broadcast naming a baileys sender is refused with WA_UNOFFICIAL_DISABLED while off, accepted while on', async () => {
    const t = await api.signup('us-bc');
    const tpl = await template(t);
    const dev = await device(t);
    const contacts = await people(t, 2);
    const create = () =>
      api
        .as(t.admin)
        .post('/v2/broadcasts')
        .set('idempotency-key', randomUUID())
        .send({
          name: 'Launch',
          templateId: tpl,
          contactIds: contacts,
          senderKeys: [`baileys:${dev.uuid}`],
          scheduleType: 'now',
        });
    const refused = await create();
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe(ERROR_CODES.WA_UNOFFICIAL_DISABLED);
    expect(
      await count(`SELECT count(*)::int AS n FROM broadcasts WHERE org_id = $1`, [t.orgId]),
    ).toBe(0);

    await setSwitch(true);
    const accepted = await create();
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    await setSwitch(false);
  });

  it('a campaign and a scheduled message naming a baileys sender are refused the same way', async () => {
    const t = await api.signup('us-cs');
    const dev = await device(t);
    const contacts = await people(t, 2);
    const campaign = await api
      .as(t.admin)
      .post('/v2/campaigns')
      .set('idempotency-key', randomUUID())
      .send({
        name: 'Offer',
        type: 'text',
        customMessage: 'Hello',
        scheduleType: 'now',
        contactIds: contacts,
        senderKey: `baileys:${dev.uuid}`,
      });
    expect(campaign.status, JSON.stringify(campaign.body)).toBe(422);
    expect(campaign.body.code).toBe(ERROR_CODES.WA_UNOFFICIAL_DISABLED);

    const scheduled = await api
      .as(t.admin)
      .post('/v2/scheduled')
      .set('idempotency-key', randomUUID())
      .send({
        name: 'Later',
        scheduleType: 'once',
        sendDate: '2031-03-10',
        sendTime: '10:30',
        timezone: 'UTC',
        senders: [`baileys:${dev.uuid}`],
        messageType: 'plain',
        message: 'Hello',
        recipientType: 'number',
        numbers: [phone()],
      });
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(422);
    expect(scheduled.body.code).toBe(ERROR_CODES.WA_UNOFFICIAL_DISABLED);
  });

  it('the broadcast composer offers no personal-number sender while off', async () => {
    const t = await api.signup('us-comp');
    await device(t);
    const hasDevice = (body: { senders: Array<{ engine: string }> }) =>
      body.senders.some((s) => s.engine === 'baileys');
    const off = await api.as(t.admin).get('/v2/broadcasts/compose');
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(hasDevice(off.body)).toBe(false);
    await setSwitch(true);
    expect(hasDevice((await api.as(t.admin).get('/v2/broadcasts/compose')).body)).toBe(true);
    await setSwitch(false);
  });
});

describe('rows that already exist', () => {
  it('a due broadcast on baileys is not queued while off and is queued once on; nothing is deleted or failed', async () => {
    const t = await api.signup('us-due');
    const tpl = await template(t);
    const dev = await device(t);
    const contacts = await people(t, 1);
    await setSwitch(true);
    const made = await api
      .as(t.admin)
      .post('/v2/broadcasts')
      .set('idempotency-key', randomUUID())
      .send({
        name: 'Parked',
        templateId: tpl,
        contactIds: contacts,
        senderKeys: [`baileys:${dev.uuid}`],
        scheduleType: 'now',
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    await setSwitch(false);

    const added: number[] = [];
    const due = new BroadcastDueService(
      h.app.get(DatabaseService),
      {
        add: async (_name: string, data: { broadcastId: number }) =>
          void added.push(data.broadcastId),
      } as never,
      h.app.get(UNOFFICIAL_WHATSAPP_GATE),
    );
    const id = Number(
      (await h.owner.query(`SELECT id FROM broadcasts WHERE org_id = $1`, [t.orgId])).rows[0].id,
    );
    await due.enqueueDue();
    expect(added).not.toContain(id);
    const parked = (
      await h.owner.query(`SELECT status, node_schedule_id FROM broadcasts WHERE id = $1`, [id])
    ).rows[0];
    expect(parked.status).toBe('processing');
    expect(parked.node_schedule_id).toBeNull();

    await setSwitch(true);
    await due.enqueueDue();
    expect(added).toContain(id);
    await setSwitch(false);
  });

  it('the channel list hides whatsapp_qr channels while off; the row and the device stay', async () => {
    const t = await api.signup('us-chan');
    const dev = await device(t);
    await h.owner.query(
      `INSERT INTO channels (org_id, kind, name, external_id, status) VALUES ($1, 'whatsapp_qr', 'Phone', $2, 'connected')`,
      [t.orgId, dev.uuid],
    );
    const kinds = async () =>
      ((await api.as(t.admin).get('/v2/channels')).body.data as Array<{ kind: string }>).map(
        (c) => c.kind,
      );
    expect(await kinds()).not.toContain('whatsapp_qr');
    await setSwitch(true);
    expect(await kinds()).toContain('whatsapp_qr');
    await setSwitch(false);
    expect(await count(`SELECT count(*)::int AS n FROM devices WHERE org_id = $1`, [t.orgId])).toBe(
      1,
    );
    expect(
      await count(`SELECT count(*)::int AS n FROM channels WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
  });

  it('the dashboard devices card is empty and flagged unofficialDisabled while off', async () => {
    const t = await api.signup('us-dash');
    await device(t);
    const off = await api.as(t.admin).get('/v2/dashboard/widgets');
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.devices).toMatchObject({
      total: 0,
      online: 0,
      rows: [],
      unofficialDisabled: true,
    });
    await setSwitch(true);
    const on = await api.as(t.admin).get('/v2/dashboard/widgets');
    expect(on.body.devices.total).toBe(1);
    expect(on.body.devices.unofficialDisabled).toBeFalsy();
    await setSwitch(false);
  });
});

describe('the worker', () => {
  it('opens no socket and takes no lease while off; restores the saved session once on; lets go when off again', async () => {
    const t = await api.signup('us-wrk');
    const dev = await device(t, 'disconnected');
    const deviceId = Number(dev.id);
    await r.store.write(
      t.orgId,
      deviceId,
      Array.from({ length: 4 }, (_, i): [string, string] => [
        i === 0 ? 'creds' : `pre-key-${i}`,
        '{"a":1}',
      ]),
    );
    const { rt, factory } = await buildWorker(h, r);
    runtimes.push(rt);

    await rt.pass();
    await rt.restore();
    expect(rt.ownedCount).toBe(0);
    expect(factory.sockets).toHaveLength(0);
    expect(await r.redis.exists(waKeys.lease(t.orgId, deviceId))).toBe(0);
    expect(await rt.adopt(t.orgId, deviceId)).toBe('missing');

    await setSwitch(true);
    await rt.restore();
    expect(rt.ownedCount).toBeGreaterThanOrEqual(1);
    expect(rt.isOwned(t.orgId, deviceId)).toBe(true);

    await setSwitch(false);
    await rt.pass(); // every socket is closed and every lease given back
    expect(rt.isOwned(t.orgId, deviceId)).toBe(false);
    expect(await r.redis.exists(waKeys.lease(t.orgId, deviceId))).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM device_auth_state WHERE device_id = $1`, [
        deviceId,
      ]),
    ).toBe(4);
  });

  it('the bridge callback is inert while off', async () => {
    process.env.NODE_WEBHOOK_TOKEN = 'bridge-token';
    h.app.get(PlatformSettingsService).invalidate();
    const res = await http()
      .get('/api/whatsapp-message-settings')
      .set('x-node-token', 'bridge-token');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ success: false, disabled: true });
    delete process.env.NODE_WEBHOOK_TOKEN;
  });
});
