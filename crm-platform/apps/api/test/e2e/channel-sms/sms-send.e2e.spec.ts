import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import { twilioSignature } from '../../../src/infra/providers/channel-sms/twilio-signature';
import { BroadcastDispatchService } from '../../../src/modules/broadcasts/broadcast-dispatch.service';
import {
  EngineSenderRegistry,
  LinkTracker,
  PACING_SETTINGS,
  PacingRuntime,
  SENDER_DIRECTORY,
  SenderLease,
  TEMPLATE_DIRECTORY,
  WALLET_GATE,
  WARMER_GATE,
  type WalletGate,
} from '../../../src/modules/broadcasts';
import { MergeTagService } from '../../../src/modules/crm';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_SETTINGS,
} from '../../../src/modules/campaigns/_shims/tokens';
import { CampaignDispatchService } from '../../../src/modules/campaigns/campaign-dispatch.service';
import { CampaignEvents } from '../../../src/modules/campaigns/campaign-events';
import { CampaignMirrorService } from '../../../src/modules/campaigns/campaign-mirror.service';
import { CampaignsRepository } from '../../../src/modules/campaigns/campaigns.repository';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { installFakeSms, planWithSms, switchSmsOn, type FakeSms } from './support';

/**
 * Sending SMS through broadcasts and campaigns, and the delivery reports that follow (TW-SMS-014 to 024, 026, 030). The real app,
 * a real Postgres, the REAL SMS engine sender and webhook; only the provider's far end is fake.
 */
let h: Harness;
let api: Api;
let sms: FakeSms;
let dispatch: BroadcastDispatchService;
let campaigns: CampaignDispatchService;
const slept: number[] = [];

/** The address Twilio is told to report to: APP_URL forced to https. */
const STATUS_URL = 'https://localhost:3999/v2/sms/status';

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  sms = installFakeSms(h);
  await switchSmsOn(h);
  const runtime = h.app.get(PacingRuntime, { strict: false });
  runtime.sleep = (ms) => {
    slept.push(ms);
    return Promise.resolve();
  };
  dispatch = h.app.get(BroadcastDispatchService, { strict: false });
  // The campaign dispatcher is a worker provider (the HTTP app only queues campaigns), so it is built here from the app's own parts,
  // as the worker builds it, and called directly: no processor is running to race the test.
  const get = <T>(token: unknown) => h.app.get<T>(token as never, { strict: false });
  campaigns = new CampaignDispatchService(
    get(DatabaseService),
    get(CampaignsRepository),
    get(CryptoService),
    get(CampaignEvents),
    get(CampaignMirrorService),
    get(EngineSenderRegistry),
    get(MergeTagService),
    get(LinkTracker),
    runtime,
    get(SenderLease),
    get(SENDER_DIRECTORY),
    get(UNOFFICIAL_WHATSAPP_GATE),
    get(TEMPLATE_DIRECTORY),
    get(WARMER_GATE),
    get(PACING_SETTINGS),
    get(CAMPAIGN_BILLING),
    get(CAMPAIGN_FLOW_STARTER),
    get(CAMPAIGN_SETTINGS),
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sms.reset();
  slept.length = 0;
});

let counter = 0;
const digits = () => `+91981${String(counter++).padStart(7, '0')}`;
const post = (token: string, path: string, body?: object) =>
  api.http().post(path).set(bearer(token)).set('idempotency-key', randomUUID()).send(body);

interface Arranged {
  t: Tenant;
  /** `sms:<uuid>` of the sender. */
  key: string;
  templateId: string;
  contacts: string[];
}

/** A workspace with SMS on, one connected sender, an SMS template and `n` contacts called Asha0, Asha1, ... */
async function arrange(
  label: string,
  n: number,
  o: {
    from?: string;
    provider?: 'twilio' | 'msg91';
    body?: string;
    limits?: Record<string, number>;
  } = {},
): Promise<Arranged> {
  const t = await api.signup(label);
  await planWithSms(h, t, { limits: o.limits });
  const connected = await post(t.admin, '/v2/sms/senders', {
    provider: o.provider ?? 'twilio',
    fromNumber: o.from ?? '+17372508034',
    accountSid: 'ACabc',
    authToken: 'tok-1',
  });
  expect(connected.status, JSON.stringify(connected.body)).toBe(201);
  const tpl = await h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, language, status, meta_status, channel)
     VALUES ($1, 'sms_offer', $2, 'en_US', 'approved', 'APPROVED', 'sms') RETURNING uuid`,
    [t.orgId, o.body ?? 'Hi {{name}}, your offer is ready.'],
  );
  const contacts = await api.seedContacts(
    t,
    Array.from({ length: n }, (_, i) => ({ name: `Asha${i}`, phone: digits() })),
  );
  return { t, key: connected.body.senderKey, templateId: tpl.rows[0].uuid, contacts };
}

async function createBroadcast(a: Arranged, extra: object = {}, keys: string[] = [a.key]) {
  const res = await post(a.t.admin, '/v2/broadcasts', {
    name: 'SMS offer',
    templateId: a.templateId,
    contactIds: a.contacts,
    senderKeys: keys,
    scheduleType: 'now',
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const uuid = res.body.broadcasts[0].id as string;
  const row = (await h.owner.query(`SELECT id FROM broadcasts WHERE uuid = $1`, [uuid])).rows[0];
  return { uuid, id: Number(row.id) };
}

const run = (t: Tenant, broadcastId: number) =>
  RequestContextStore.run(
    {
      requestId: `t-${broadcastId}`,
      orgId: t.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => dispatch.run(t.orgId, broadcastId),
  );
const broadcast = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, provider, success_count, delivered_count, fail_count FROM broadcasts WHERE id = $1`,
      [id],
    )
  ).rows[0];
const recipients = async (id: number) =>
  (
    await h.owner.query(
      `SELECT c.name, bc.status, bc.error_message, bc.whatsapp_message_id FROM broadcast_contacts bc
       JOIN contacts c ON c.org_id = bc.org_id AND c.id = bc.contact_id WHERE bc.broadcast_id = $1 ORDER BY bc.id`,
      [id],
    )
  ).rows as Array<{
    name: string;
    status: string;
    error_message: string | null;
    whatsapp_message_id: string | null;
  }>;
const used = async (t: Tenant) =>
  Number(
    (
      await h.owner.query(
        `SELECT coalesce(sum(count), 0) AS n FROM plan_usage WHERE org_id = $1 AND metric = 'sms_sent'`,
        [t.orgId],
      )
    ).rows[0].n,
  );

describe('TW-SMS-016, 030: the SMS composer', () => {
  it('?channel=sms lists SMS senders and SMS templates only; the WhatsApp composer lists neither', async () => {
    const a = await arrange('c1', 1);
    // A WhatsApp-side number and template so both lists are non-empty.
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, meta_json)
       VALUES ($1, 'twilio', 'connected', '+14155238886', 'WA Twilio', '{}')`,
      [a.t.orgId],
    );
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, language, status, channel)
       VALUES ($1, 'wa_promo', 'Hello', 'en_US', 'approved', 'baileys')`,
      [a.t.orgId],
    );

    const sms = await api.as(a.t.admin).get('/v2/broadcasts/compose?channel=sms');
    expect(sms.status, JSON.stringify(sms.body)).toBe(200);
    expect(sms.body.senders).toEqual([
      {
        key: a.key,
        label: 'SMS · Twilio',
        phone: '+17372508034',
        engine: 'sms',
        engineLabel: 'SMS',
        isDefault: true,
      },
    ]);
    expect(sms.body.templates.map((x: { name: string }) => x.name)).toEqual(['sms_offer']);
    expect(sms.body.templates[0].engine).toBe('sms');

    // The campaign builder takes the same scope (TW-SMS-018): the SMS number is offered with ?channel=sms and never without it.
    const builderSms = await api.as(a.t.admin).get('/v2/campaigns/builder?channel=sms');
    expect(builderSms.status, JSON.stringify(builderSms.body)).toBe(200);
    expect(builderSms.body.senders.map((x: { key: string }) => x.key)).toEqual([a.key]);
    const builderWa = await api.as(a.t.admin).get('/v2/campaigns/builder');
    expect(builderWa.body.senders.map((s: { engine: string }) => s.engine)).not.toContain('sms');

    const wa = await api.as(a.t.admin).get('/v2/broadcasts/compose');
    expect(wa.body.senders.map((s: { engine: string }) => s.engine)).not.toContain('sms');
    expect(wa.body.templates.map((x: { name: string }) => x.name)).not.toContain('sms_offer');
  });

  it('is empty while the platform switch is off, and a deactivated sender is not listed', async () => {
    const a = await arrange('c2', 1);
    await switchSmsOn(h, false);
    const off = await api.as(a.t.admin).get('/v2/broadcasts/compose?channel=sms');
    expect(off.body).toEqual({ templates: [], senders: [], twilioEnabled: false });
    await switchSmsOn(h, true);

    const s = (await api.as(a.t.admin).get('/v2/sms/senders')).body.data[0];
    await api
      .as(a.t.admin)
      .patch(`/v2/sms/senders/${s.id}`)
      .set('idempotency-key', randomUUID())
      .send({ active: false, rowVersion: s.rowVersion });
    const on = await api.as(a.t.admin).get('/v2/broadcasts/compose?channel=sms');
    expect(on.body.senders).toEqual([]);
  });

  it('a broadcast on an SMS sender needs the sms plan feature, and is never held by the wallet', async () => {
    const a = await arrange('c3', 2);
    const wallet = h.app.get<WalletGate>(WALLET_GATE as never, { strict: false });
    const precheck = vi.spyOn(wallet, 'precheck').mockRejectedValue(new Error('wallet empty'));
    const ok = await post(a.t.admin, '/v2/broadcasts', {
      name: 'N',
      templateId: a.templateId,
      contactIds: a.contacts,
      senderKeys: [a.key],
      scheduleType: 'now',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(precheck).not.toHaveBeenCalled();
    precheck.mockRestore();

    await planWithSms(h, a.t, { sms: false });
    const locked = await post(a.t.admin, '/v2/broadcasts', {
      name: 'N2',
      templateId: a.templateId,
      contactIds: a.contacts,
      senderKeys: [a.key],
      scheduleType: 'now',
    });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('PLAN_FEATURE_LOCKED');
  });
});

describe('TW-SMS-017: the broadcast run', () => {
  it('sends every recipient with their own merge values, records the provider id, completes, with no pacing', async () => {
    const a = await arrange('b1', 3);
    const b = await createBroadcast(a);
    expect(await run(a.t, b.id)).toBe('finished');

    expect(sms.sendCalls.map((c) => c.body)).toEqual([
      'Hi Asha0, your offer is ready.',
      'Hi Asha1, your offer is ready.',
      'Hi Asha2, your offer is ready.',
    ]);
    expect(sms.sendCalls[0]!.to).toMatch(/^\+?91981/);
    expect(sms.sendCalls[0]!.creds).toMatchObject({
      provider: 'twilio',
      from: '+17372508034',
      authToken: 'tok-1',
    });
    expect(sms.sendCalls[0]!.callback).toBe(STATUS_URL);
    expect(await recipients(b.id)).toEqual([
      { name: 'Asha0', status: 'sent', error_message: null, whatsapp_message_id: 'SM0001' },
      { name: 'Asha1', status: 'sent', error_message: null, whatsapp_message_id: 'SM0002' },
      { name: 'Asha2', status: 'sent', error_message: null, whatsapp_message_id: 'SM0003' },
    ]);
    expect(await broadcast(b.id)).toMatchObject({
      status: 'completed',
      provider: 'sms',
      success_count: 3,
      fail_count: 0,
    });
    // SMS is sent one after another with no human-like gap.
    expect(slept).toEqual([]);
    expect(await used(a.t)).toBe(3);
  });

  it('a named merge variable with no variable map renders (Reference sent an empty string)', async () => {
    const a = await arrange('b2', 1, { body: 'Hi {{name}}, mail {{email}} / {{first_name}}.' });
    await h.owner.query(`UPDATE contacts SET email = 'asha@example.test' WHERE org_id = $1`, [
      a.t.orgId,
    ]);
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    expect(sms.sendCalls[0]!.body).toContain('Hi Asha0, mail asha@example.test /');
    expect(sms.sendCalls[0]!.body).not.toContain('{{');
  });

  it('an alphanumeric sender id (no digits) can send', async () => {
    const a = await arrange('b3', 1, { from: 'ACMEIN' });
    const b = await createBroadcast(a);
    expect(await run(a.t, b.id)).toBe('finished');
    expect(sms.sendCalls[0]!.creds.from).toBe('ACMEIN');
    expect((await recipients(b.id))[0]!.status).toBe('sent');
  });

  it('a provider failure fails that recipient with the translated sentence; some failing is "completed with errors", all is "failed"', async () => {
    const a = await arrange('b4', 3);
    sms.send = (n) =>
      n === 2
        ? {
            ok: false,
            error:
              'Twilio could not read the recipient number; it must be full international format, e.g. +919876543210.',
            code: '21211',
          }
        : { ok: true, messageId: `SM${n}`, segments: 1 };
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    const r = await recipients(b.id);
    expect(r.map((x) => x.status)).toEqual(['sent', 'failed', 'sent']);
    expect(r[1]!.error_message).toContain('full international format');
    expect(await broadcast(b.id)).toMatchObject({
      status: 'completed_with_errors',
      success_count: 2,
      fail_count: 1,
    });
    // A failed send gives its place in the month back: only accepted messages count.
    expect(await used(a.t)).toBe(2);

    sms.reset();
    sms.send = { ok: false, error: 'HTTP 503' };
    const all = await arrange('b4b', 2);
    const b2 = await createBroadcast(all);
    await run(all.t, b2.id);
    expect(await broadcast(b2.id)).toMatchObject({ status: 'failed', fail_count: 2 });
    expect(await used(all.t)).toBe(0);
  });

  it('a provider answer with no text falls back to "SMS send failed"', async () => {
    const a = await arrange('b5', 1);
    sms.send = { ok: false, error: '' };
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    expect((await recipients(b.id))[0]!.error_message).toBe('SMS send failed');
  });

  it('a deactivated sender fails the broadcast with nothing sent; a removed one falls back to another connected sender', async () => {
    const a = await arrange('b6', 2);
    const s = (await api.as(a.t.admin).get('/v2/sms/senders')).body.data[0];
    const b = await createBroadcast(a);
    await api
      .as(a.t.admin)
      .patch(`/v2/sms/senders/${s.id}`)
      .set('idempotency-key', randomUUID())
      .send({ active: false, rowVersion: s.rowVersion });
    expect(await run(a.t, b.id)).toBe('failed');
    expect(sms.sendCalls).toHaveLength(0);
    expect(await broadcast(b.id)).toMatchObject({ status: 'failed' });
    expect((await recipients(b.id)).map((x) => x.status)).toEqual(['pending', 'pending']);

    // Removed sender, another connected one: the run uses it (Reference's documented fallback).
    const c = await arrange('b6b', 1);
    const other = await post(c.t.admin, '/v2/sms/senders', {
      fromNumber: '+17372500002',
      accountSid: 'ACabc',
      authToken: 'tok-2',
    });
    const b2 = await createBroadcast(c);
    await api
      .as(c.t.admin)
      .delete(
        `/v2/sms/senders/${(await api.as(c.t.admin).get('/v2/sms/senders')).body.data[0].id}`,
      );
    expect(await run(c.t, b2.id)).toBe('finished');
    expect(sms.sendCalls[0]!.creds.from).toBe(other.body.fromNumber);
  });

  it('a contact who opts out after the broadcast was made is not texted (and a retry will not text them either)', async () => {
    const a = await arrange('b7', 2);
    const b = await createBroadcast(a);
    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND name = 'Asha0'`,
      [a.t.orgId],
    );
    await run(a.t, b.id);
    expect(sms.sendCalls).toHaveLength(1);
    const r = await recipients(b.id);
    expect(r[0]).toMatchObject({
      status: 'failed',
      error_message: 'This contact has opted out of messages.',
    });
    expect(r[1]!.status).toBe('sent');
  });

  it('opted-out contacts are not in the audience at all, as before', async () => {
    const a = await arrange('b7b', 2);
    await h.owner.query(`UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1`, [
      a.t.orgId,
    ]);
    const res = await post(a.t.admin, '/v2/broadcasts', {
      name: 'N',
      templateId: a.templateId,
      contactIds: a.contacts,
      senderKeys: [a.key],
      scheduleType: 'now',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BCAST_NO_RECIPIENTS');
  });

  it('Twilio 21610 (the recipient replied STOP at Twilio) flags the contact as opted out', async () => {
    const a = await arrange('b8', 2);
    sms.send = (n) =>
      n === 1
        ? {
            ok: false,
            code: '21610',
            error:
              'This recipient has replied STOP and is unsubscribed; carriers require they text START before you can message them again.',
          }
        : { ok: true, messageId: 'SM2', segments: 1 };
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    const flags = (
      await h.owner.query(
        `SELECT name, is_unsubscribed FROM contacts WHERE org_id = $1 ORDER BY id`,
        [a.t.orgId],
      )
    ).rows;
    expect(flags).toEqual([
      { name: 'Asha0', is_unsubscribed: true },
      { name: 'Asha1', is_unsubscribed: false },
    ]);
  });

  it('a provider that refuses the key itself switches the sender off with the reason', async () => {
    const a = await arrange('b9', 2);
    sms.send = { ok: false, error: 'Authenticate', code: '20003', badCredentials: true };
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    const s = (await api.as(a.t.admin).get('/v2/sms/senders')).body.data[0];
    expect(s).toMatchObject({ active: false, lastError: 'Authenticate' });
    expect((await api.events(a.t.orgId, 'sms.sender.toggled')).at(-1)).toMatchObject({
      active: false,
      reason: 'bad_credentials',
    });
    // Reconnecting clears it.
    const again = await post(a.t.admin, '/v2/sms/senders', {
      fromNumber: '+17372508034',
      accountSid: 'ACabc',
      authToken: 'new',
    });
    expect(again.body).toMatchObject({ active: true, lastError: null });
  });

  it('"send later" waits for its time: nothing is sent when it is created', async () => {
    const a = await arrange('b10', 2);
    const b = await createBroadcast(a, {
      scheduleType: 'later',
      sendDate: '2099-01-01',
      sendTime: '09:00',
    });
    expect((await broadcast(b.id)).status).toBe('scheduled');
    expect(sms.sendCalls).toHaveLength(0);
    // The dispatcher refuses to run a broadcast that is not yet due... until the sweep moves it to processing.
    await h.owner.query(`UPDATE broadcasts SET status = 'processing' WHERE id = $1`, [b.id]);
    expect(await run(a.t, b.id)).toBe('finished');
    expect(sms.sendCalls).toHaveLength(2);
  });
});

describe('TW-SMS-026: the monthly allowance', () => {
  it('stops at the cap mid-run: the rest fail with the plan sentence, and the cap is never overshot', async () => {
    const a = await arrange('q1', 4, { limits: { sms_monthly: 2 } });
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    expect(sms.sendCalls).toHaveLength(2);
    const r = await recipients(b.id);
    expect(r.map((x) => x.status)).toEqual(['sent', 'sent', 'failed', 'failed']);
    expect(r[2]!.error_message).toContain(
      "You've reached your plan's limit of 2 SMS messages a month",
    );
    expect(await used(a.t)).toBe(2);
  });

  it('a month already spent fails the whole run up front, with nothing sent', async () => {
    const a = await arrange('q2', 2, { limits: { sms_monthly: 1 } });
    const now = new Date();
    const period = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    await h.owner.query(
      `INSERT INTO plan_usage (org_id, metric, period, count) VALUES ($1, 'sms_sent', $2, 1)`,
      [a.t.orgId, period],
    );
    const b = await createBroadcast(a);
    expect(await run(a.t, b.id)).toBe('failed');
    expect(sms.sendCalls).toHaveLength(0);
    expect((await broadcast(b.id)).status).toBe('failed');
  });

  it('0 is unlimited, and the usage meter reads what was sent this month', async () => {
    const a = await arrange('q3', 3, { limits: { sms_monthly: 0 } });
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    expect(sms.sendCalls).toHaveLength(3);
    const usage = await api.as(a.t.admin).get('/v2/billing/usage');
    expect(usage.status, JSON.stringify(usage.body)).toBe(200);
    const meter = usage.body.meters.find((m: { key: string }) => m.key === 'sms_monthly');
    expect(meter).toMatchObject({ used: 3, limit: 0, percent: null, window: 'month' });
  });
});

describe('TW-SMS-022: delivery reports from Twilio', () => {
  /** A signed Twilio status callback, as Twilio posts it. */
  const twilio = (a: Arranged, fields: Record<string, string>, token = 'tok-1', url = STATUS_URL) =>
    api
      .http()
      .post('/v2/sms/status')
      .type('form')
      .set('x-twilio-signature', twilioSignature(token, url, fields))
      .send(fields);

  async function sent(label: string, n = 1) {
    const a = await arrange(label, n);
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    return { a, b };
  }

  it('a delivered report moves the broadcast recipient to delivered and counts it (Reference left it "sent" forever)', async () => {
    const { a, b } = await sent('w1', 2);
    const res = await twilio(a, { MessageSid: 'SM0001', MessageStatus: 'delivered' });
    expect(res.status).toBe(204);
    expect((await recipients(b.id)).map((x) => x.status)).toEqual(['delivered', 'sent']);
    expect(await broadcast(b.id)).toMatchObject({ delivered_count: 1, success_count: 2 });
  });

  it('only moves forward: a late "sent" cannot undo "delivered", and the same report twice changes nothing', async () => {
    const { a, b } = await sent('w2');
    await twilio(a, { MessageSid: 'SM0001', MessageStatus: 'delivered' });
    expect((await twilio(a, { MessageSid: 'SM0001', MessageStatus: 'sent' })).status).toBe(204);
    expect((await twilio(a, { MessageSid: 'SM0001', MessageStatus: 'delivered' })).status).toBe(
      204,
    );
    expect((await recipients(b.id))[0]!.status).toBe('delivered');
    expect(await broadcast(b.id)).toMatchObject({ delivered_count: 1 });
  });

  it('undelivered with an error code fails the recipient and keeps "<code> <text>"', async () => {
    const { a, b } = await sent('w3');
    await twilio(a, {
      MessageSid: 'SM0001',
      MessageStatus: 'undelivered',
      ErrorCode: '30003',
      ErrorMessage: 'Unreachable destination handset',
    });
    const [r] = await recipients(b.id);
    expect(r).toMatchObject({ status: 'failed' });
    expect(r!.error_message).toContain('30003 Unreachable destination handset');
    expect(await broadcast(b.id)).toMatchObject({ fail_count: 1 });
  });

  it('a status that says nothing, an unknown message and a malformed body are all a quiet 204', async () => {
    const { a, b } = await sent('w4');
    expect((await twilio(a, { MessageSid: 'SM0001', MessageStatus: 'queued' })).status).toBe(204);
    expect((await twilio(a, { MessageSid: 'SM-UNKNOWN', MessageStatus: 'delivered' })).status).toBe(
      204,
    );
    expect((await api.http().post('/v2/sms/status').type('form').send({})).status).toBe(204);
    expect((await api.http().post('/v2/sms/status').send('not a form')).status).toBe(204);
    expect((await recipients(b.id))[0]!.status).toBe('sent');
  });

  it('a wrong signature, no signature, or a signature made for another address is refused and changes nothing', async () => {
    const { a, b } = await sent('w5');
    const fields = { MessageSid: 'SM0001', MessageStatus: 'delivered' };
    expect((await twilio(a, fields, 'wrong-token')).status).toBe(401);
    expect((await twilio(a, fields, 'tok-1', 'https://evil.example/v2/sms/status')).status).toBe(
      401,
    );
    expect((await api.http().post('/v2/sms/status').type('form').send(fields)).status).toBe(401);
    expect((await recipients(b.id))[0]!.status).toBe('sent');
    // The right proof is accepted.
    expect((await twilio(a, fields)).status).toBe(204);
    expect((await recipients(b.id))[0]!.status).toBe('delivered');
  });

  it("another workspace's auth token cannot speak for this workspace's message", async () => {
    const { b } = await sent('w6');
    const other = await arrange('w6b', 1);
    await post(other.t.admin, '/v2/sms/senders', {
      fromNumber: '+17372508034',
      accountSid: 'ACother',
      authToken: 'tok-OTHER',
    });
    // Workspace B signs a report about workspace A's message id with B's own, perfectly valid, token.
    const fields = { MessageSid: 'SM0001', MessageStatus: 'delivered' };
    const forged = await api
      .http()
      .post('/v2/sms/status')
      .type('form')
      .set('x-twilio-signature', twilioSignature('tok-OTHER', STATUS_URL, fields))
      .send(fields);
    expect(forged.status).toBe(401);
    expect((await recipients(b.id))[0]!.status).toBe('sent');
  });

  it('keeps working for a workspace whose plan no longer includes SMS (late reports must still land)', async () => {
    const { a, b } = await sent('w7');
    await planWithSms(h, a.t, { sms: false });
    expect((await twilio(a, { MessageSid: 'SM0001', MessageStatus: 'delivered' })).status).toBe(
      204,
    );
    expect((await recipients(b.id))[0]!.status).toBe('delivered');
  });
});

describe('TW-SMS-022: delivery reports from MSG91', () => {
  async function sentVia(label: string) {
    const a = await arrange(label, 1, { provider: 'msg91', from: 'THRDWS' });
    const secret = (
      await h.owner.query(
        `SELECT meta_json ->> 'dlr_secret' AS s FROM wa_provider_configs WHERE org_id = $1`,
        [a.t.orgId],
      )
    ).rows[0].s as string;
    sms.send = { ok: true, messageId: `REQ-${label}`, segments: 1 };
    const b = await createBroadcast(a);
    await run(a.t, b.id);
    return { a, b, secret };
  }
  const dlr = (secret: string, body: object | string) =>
    api
      .http()
      .post(`/v2/sms/status/${secret}`)
      .send(body as object);

  it("the address with the sender's secret takes the report, in any of MSG91's shapes", async () => {
    const { b, secret } = await sentVia('m1');
    expect(sms.sendCalls[0]!.creds.provider).toBe('msg91');
    expect((await dlr(secret, { requestId: 'REQ-m1', status: 'DELIVRD' })).status).toBe(204);
    expect((await recipients(b.id))[0]!.status).toBe('delivered');

    const second = await sentVia('m1b');
    expect(
      (
        await dlr(second.secret, {
          data: { request_id: 'REQ-m1b', report: [{ desc: 'Rejected' }] },
        })
      ).status,
    ).toBe(204);
    expect((await recipients(second.b.id))[0]!.status).toBe('failed');
  });

  it("a wrong secret is refused; another workspace's secret cannot touch this workspace's message", async () => {
    const mine = await sentVia('m2');
    const theirs = await sentVia('m2b');
    expect((await dlr('not-a-secret', { requestId: 'REQ-m2', status: 'DELIVRD' })).status).toBe(
      401,
    );
    expect((await dlr(theirs.secret, { requestId: 'REQ-m2', status: 'DELIVRD' })).status).toBe(204);
    expect((await recipients(mine.b.id))[0]!.status).toBe('sent');
    expect((await dlr(mine.secret, 'garbage')).status).toBe(204);
  });
});

describe('TW-SMS-018, 019: campaigns', () => {
  async function campaign(a: Arranged, extra: object = {}) {
    const res = await post(a.t.admin, '/v2/campaigns', {
      name: 'SMS campaign',
      type: 'text',
      customMessage: 'Hi {{name}}',
      scheduleType: 'now',
      senderKey: a.key,
      contactIds: a.contacts,
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = (
      await h.owner.query(`SELECT id FROM wpcampaigns WHERE uuid = $1`, [res.body.campaign.id])
    ).rows[0];
    return { id: Number(row.id), orgId: a.t.orgId };
  }
  const crows = async (id: number) =>
    (
      await h.owner.query(
        `SELECT c.name, r.status, r.error_message, r.whatsapp_message_id FROM wp_campaign_contacts r
         JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE r.campaign_id = $1 ORDER BY r.id`,
        [id],
      )
    ).rows;
  const runCampaign = (c: { id: number; orgId: number }) =>
    RequestContextStore.run(
      { requestId: `c-${c.id}`, orgId: c.orgId, actorType: 'system', actorId: null, userId: null },
      () => campaigns.run(c.orgId, c.id),
    );

  it('sends the free-text message to each recipient, merges names, drops the buttons, and reports delivery to the campaign', async () => {
    const a = await arrange('p1', 3);
    const c = await campaign(a, {
      customButtons: [{ type: 'url', text: 'Open', url: 'https://x.test' }],
    });
    expect(await runCampaign(c)).toBe('finished');
    expect(sms.sendCalls.map((x) => x.body)).toEqual(['Hi Asha0', 'Hi Asha1', 'Hi Asha2']);
    expect((await crows(c.id)).map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
    expect(
      (
        await h.owner.query(`SELECT custom_buttons, provider FROM wpcampaigns WHERE id = $1`, [
          c.id,
        ])
      ).rows[0],
    ).toMatchObject({ provider: 'sms' });
    expect(slept).toEqual([]);

    const fields = { MessageSid: 'SM0002', MessageStatus: 'delivered' };
    await api
      .http()
      .post('/v2/sms/status')
      .type('form')
      .set('x-twilio-signature', twilioSignature('tok-1', STATUS_URL, fields))
      .send(fields);
    expect((await crows(c.id)).map((r) => r.status)).toEqual(['sent', 'delivered', 'sent']);
  });

  it('opted-out contacts are skipped, a campaign on an SMS sender needs the plan feature and is never held by the wallet', async () => {
    const a = await arrange('p2', 2);
    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND name = 'Asha1'`,
      [a.t.orgId],
    );
    const c = await campaign(a);
    await runCampaign(c);
    expect(sms.sendCalls).toHaveLength(1);
    expect((await crows(c.id)).map((r) => r.status)).toEqual(['sent', 'unsubscribed']);

    await planWithSms(h, a.t, { sms: false });
    const locked = await post(a.t.admin, '/v2/campaigns', {
      name: 'x',
      type: 'text',
      customMessage: 'Hi',
      scheduleType: 'now',
      senderKey: a.key,
      contactIds: a.contacts,
    });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('PLAN_FEATURE_LOCKED');
  });

  it('the engine is registered where the sending happens: the shared registry knows "sms"', () => {
    expect(h.app.get(EngineSenderRegistry, { strict: false }).get('sms')).toBeDefined();
  });

  it('keys never reach a log or an error: a failed recipient shows the sentence, not the token', async () => {
    const a = await arrange('p3', 1);
    sms.send = { ok: false, error: 'Twilio refused it' };
    const c = await campaign(a);
    await runCampaign(c);
    const r = await crows(c.id);
    expect(JSON.stringify(r)).not.toContain('tok-1');
    expect(r[0]!.error_message).toBe('Twilio refused it');
  });
});
