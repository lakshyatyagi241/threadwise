import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MESSAGE_DELIVERY_EVENT } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import {
  CapTally,
  PACING_SETTINGS,
  PacingRuntime,
  SenderLease,
  WALLET_GATE,
  type PacingSettingsSource,
  type WalletGate,
} from '../../../src/modules/broadcasts';
import { MergeTagService } from '../../../src/modules/crm';
import {
  OutboundRegistry,
  SenderResolver,
  type EngineTransport,
  type SendCommand,
} from '../../../src/modules/node-bridge-runtime';
import { WarmerService } from '../../../src/modules/scheduled-queue-warmer';
import { ScheduleMessageBuilder } from '../../../src/modules/scheduled-queue-warmer/schedule-message-builder.service';
import { ScheduledReceiptsService } from '../../../src/modules/scheduled-queue-warmer/scheduled-receipts.service';
import { ScheduledRunService } from '../../../src/modules/scheduled-queue-warmer/scheduled-run.service';
import {
  MessageBillingService,
  WalletLedgerService,
} from '../../../src/modules/wallet-message-billing';
import { DeliveryBillingConsumer } from '../../../src/modules/wallet-message-billing/delivery.consumer';
import { WalletLogService } from '../../../src/modules/wallet-message-billing/wallet-log.service';
import type { WalletRealtimePublisher } from '../../../src/modules/wallet-message-billing/wallet-realtime.publisher';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { ConsentGate } from '../../../src/modules/contact-consent';

/**
 * Does a scheduled send settle the wallet the way a broadcast does (TW-SCHED-024, TW-WALLET-009 to 013)? The whole chain on a real
 * Postgres: the run sends, the provider reports, the report becomes a `message.delivery_reported` event in the same transaction, and
 * the wallet's own subscriber turns the event into a charge on delivery and a refund on failure. Nothing is held at send: the
 * wallet is checked when the schedule is made (and edited) and charged when the provider says the message arrived.
 *
 * The provider is a stand-in that records what it was asked to send. NOT verified here: a real Cloud API or Twilio status webhook.
 */
let h: Harness;
let api: Api;
let n = 0;
let registry: OutboundRegistry;
let runService: ScheduledRunService;
let receipts: ScheduledReceiptsService;
let consumer: DeliveryBillingConsumer;
let sent: Array<{ engine: string; command: SendCommand; id: string }> = [];
let failNext: ((to: string) => boolean) | null = null;
const FUTURE = '2031-03-10';
const seen = new Map<number, number>();

const transport = (engine: string): EngineTransport => ({
  open: () =>
    Promise.resolve({
      send: async (command) => {
        const to = (command as { to: string }).to;
        if (failNext?.(to)) throw new Error('Provider said no');
        const id = `wamid.${engine}.${randomUUID()}`;
        sent.push({ engine, command, id });
        return { providerMessageId: id };
      },
    }),
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  registry = h.app.get(OutboundRegistry);
  const runtime = h.app.get(PacingRuntime);
  runtime.sleep = () => Promise.resolve();
  const pacing = h.app.get<PacingSettingsSource>(PACING_SETTINGS);
  pacing.get = () =>
    Promise.resolve({
      msgGapSeconds: 3,
      enableBatches: false,
      batchSize: 50,
      batchGapMinutes: 5,
      baileysDailyCap: 4000,
    });
  const db = h.app.get(DatabaseService);
  runService = new ScheduledRunService(
    db,
    h.app.get(SenderResolver),
    registry,
    h.app.get(MergeTagService, { strict: false }),
    h.app.get(ScheduleMessageBuilder),
    pacing as never,
    runtime,
    h.app.get(CapTally),
    h.app.get(SenderLease),
    h.app.get(WarmerService),
    h.app.get(UNOFFICIAL_WHATSAPP_GATE),
    h.app.get(OutboxService),
    h.app.get<WalletGate>(WALLET_GATE as never, { strict: false }),
    h.app.get(ConsentGate),
  );
  receipts = new ScheduledReceiptsService(db, h.app.get(OutboxService));
  consumer = new DeliveryBillingConsumer(
    h.app.get(MessageBillingService, { strict: false }),
    h.app.get(OutboxSubscriberRegistry, { strict: false }),
    h.app.get(WalletLogService, { strict: false }),
    db,
    { balanceChanged: async () => undefined } as unknown as WalletRealtimePublisher,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sent = [];
  failNext = null;
  registry.register('baileys', transport('baileys'));
  registry.register('waba', transport('waba'));
});

// --- arrangements --------------------------------------------------------------------------------------------------------------

/** A workspace that pays per message, with `fund` hundredths in its wallet, one personal number and one Cloud API number. */
async function arrange(label: string, fund = 100_000) {
  const t: Tenant = await api.signup(label);
  await h.owner.query(
    `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES ($1, true)
     ON CONFLICT (org_id) DO UPDATE SET bill_to_platform_credit = true`,
    [t.orgId],
  );
  if (fund > 0) {
    await h.app.get(DatabaseService).txAs({ orgId: t.orgId, userId: null }, (tx) =>
      h.app.get(WalletLedgerService, { strict: false }).post(tx, {
        orgId: t.orgId,
        unit: 'USD',
        type: 'topup',
        direction: 'in',
        amountMinor: fund,
        idempotencyKey: `fund:${t.orgId}`,
        source: 'topup.conversion',
        description: 'Wallet top-up',
      }),
    );
  }
  const device = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Phone', '+91', $2, 'connected', true) RETURNING uuid`,
      [t.orgId, `98111${String(10000 + n++)}`],
    )
  ).rows[0];
  const waba = (
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label)
       VALUES ($1, 'waba', 'connected', $2, 'Acme Official') RETURNING uuid`,
      [t.orgId, `+91981112${String(n++).padStart(4, '0')}`],
    )
  ).rows[0];
  return { t, phone: `baileys:${device.uuid}`, cloud: `waba:${waba.uuid}` };
}

async function template(t: Tenant, category = 'marketing') {
  const r = await h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, category, meta_category, template_type, status, meta_template_id, meta_status, language)
     VALUES ($1, $2, 'Hello {{1}}', $3, $3, 'standard', 'approved', $4, 'APPROVED', 'en') RETURNING uuid`,
    [t.orgId, `promo_${n++}`, category, `meta-${randomUUID()}`],
  );
  return r.rows[0].uuid as string;
}

const numbers = (k: number) =>
  Array.from({ length: k }, (_, i) => `+9198333${String(10000 + n++ + i)}`);
const body = (senders: string[], over: Record<string, unknown> = {}) => ({
  name: 'Wallet check',
  scheduleType: 'once',
  sendDate: FUTURE,
  sendTime: '10:30',
  timezone: 'UTC',
  senders,
  messageType: 'plain',
  message: 'Hello',
  recipientType: 'number',
  numbers: numbers(3),
  ...over,
});
const post = (t: Tenant, path: string, b: unknown = {}) =>
  api
    .as(t.admin)
    .post(path)
    .set('idempotency-key', `k${Math.random()}`)
    .send(b as object);
const row = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM scheduled_messages WHERE uuid = $1`, [uuid])).rows[0];
const recipients = async (uuid: string) =>
  (
    await h.owner.query(
      `SELECT phone, status, wa_message_id FROM scheduled_message_contacts WHERE scheduled_message_id = $1 ORDER BY id`,
      [(await row(uuid)).id],
    )
  ).rows as Array<{ phone: string; status: string; wa_message_id: string | null }>;
const due = (uuid: string) =>
  h.owner.query(
    `UPDATE scheduled_messages SET scheduled_time = now() - interval '1 minute', next_run_at = now() - interval '1 minute' WHERE uuid = $1`,
    [uuid],
  );
const run = async (t: Tenant, uuid: string) => {
  const r = await row(uuid);
  return RequestContextStore.run(
    { requestId: `t-${uuid}`, orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    () => runService.run(t.orgId, Number(r.id)),
  );
};
const receipt = (id: string, status: 'sent' | 'delivered' | 'read' | 'failed') =>
  receipts.handleReceipt({ providerMessageId: id, status, occurredAt: new Date() });

/** Hands every wallet event the tenant has produced since the last call to the wallet's own subscriber, in order. */
async function drain(orgId: number): Promise<number> {
  const rows = (
    await h.owner.query(
      `SELECT id, aggregate_module, aggregate_id, payload FROM event_outbox
        WHERE org_id = $1 AND event_type = $2 AND id > $3 ORDER BY id`,
      [orgId, MESSAGE_DELIVERY_EVENT, seen.get(orgId) ?? 0],
    )
  ).rows;
  for (const r of rows) {
    await consumer.handle({
      id: String(r.id),
      orgId,
      aggregateModule: r.aggregate_module,
      aggregateId: String(r.aggregate_id),
      eventType: MESSAGE_DELIVERY_EVENT,
      payload: r.payload,
    } as never);
    seen.set(orgId, Number(r.id));
  }
  return rows.length;
}
const balance = async (orgId: number) =>
  Number(
    (
      await h.owner.query(
        `SELECT (balance * 100)::bigint AS minor FROM wallets WHERE org_id = $1`,
        [orgId],
      )
    ).rows[0]?.minor ?? 0,
  );
const charges = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT wamid, status, credits, source, category, billing_mode FROM usage_charges WHERE org_id = $1 ORDER BY id`,
      [orgId],
    )
  ).rows;
const events = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT aggregate_module, payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [orgId, MESSAGE_DELIVERY_EVENT],
    )
  ).rows;

// --- the chain -----------------------------------------------------------------------------------------------------------------

describe('a Cloud API schedule: charged when the provider says delivered, refunded when it says failed', () => {
  it('charges each delivered message once however many reports follow, and refunds a failure once', async () => {
    const { t, cloud } = await arrange('w1');
    const tpl = await template(t);
    const made = await post(
      t,
      '/v2/scheduled',
      body([cloud], { messageType: 'template', message: undefined, templateId: tpl }),
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.ids[0];
    const start = await balance(t.orgId);
    await due(id);
    expect(await run(t, id)).toBe('finished');
    expect(sent).toHaveLength(3);
    const ids = sent.map((s) => s.id);

    // sent: the wallet is told nothing for the Cloud API, and nothing was held when the message left
    expect(await drain(t.orgId)).toBe(0);
    expect(await balance(t.orgId)).toBe(start);
    expect((await recipients(id)).map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);

    // the provider's own "sent" is a repeat: no event
    expect(await receipt(ids[0]!, 'sent')).toBe(true);
    expect(await events(t.orgId)).toHaveLength(0);

    // delivered: one event each, one charge each, from the wallet's subscriber
    for (const x of ids) expect(await receipt(x, 'delivered')).toBe(true);
    expect(await drain(t.orgId)).toBe(3);
    const after = await charges(t.orgId);
    expect(after).toHaveLength(3);
    expect(
      after.every(
        (c) => c.status === 'charged' && c.source === 'scheduled' && c.category === 'marketing',
      ),
    ).toBe(true);
    const price = Number(after[0]!.credits);
    expect(price).toBeGreaterThan(0);
    expect(await balance(t.orgId)).toBe(start - 3 * price);
    expect((await events(t.orgId)).map((e) => e.aggregate_module)).toEqual(
      Array(3).fill('scheduled_messages'),
    );

    // the same report twice, a read after delivered, and a late "sent" never charge again
    for (const x of ids) expect(await receipt(x, 'delivered')).toBe(true);
    expect(await drain(t.orgId)).toBe(0);
    // a read message cannot fail afterwards (the broadcast state machine), so the one that will fail stays at delivered
    for (const x of [ids[0]!, ids[2]!]) expect(await receipt(x, 'read')).toBe(true);
    await drain(t.orgId);
    expect(await receipt(ids[0]!, 'sent')).toBe(true);
    await drain(t.orgId);
    expect(await charges(t.orgId)).toHaveLength(3);
    expect(await balance(t.orgId)).toBe(start - 3 * price);

    // failed after delivered: the exact charge goes back, once
    expect(await receipt(ids[1]!, 'failed')).toBe(true);
    await drain(t.orgId);
    expect(await receipt(ids[1]!, 'failed')).toBe(true);
    await drain(t.orgId);
    expect(await balance(t.orgId)).toBe(start - 2 * price);
    expect((await charges(t.orgId)).filter((c) => c.status === 'refunded')).toHaveLength(1);

    // the schedule's own counters follow: 3 sent, 2 still delivered, 1 failed; and the rows say the same
    expect(await row(id)).toMatchObject({ total_sent: 3, total_delivered: 2, total_failed: 1 });
    expect((await recipients(id)).map((r) => r.status).sort()).toEqual(['failed', 'read', 'read']);
  });

  it('charges nothing for a message that failed before it was delivered, and nothing is left to refund', async () => {
    const { t, cloud } = await arrange('w2');
    const tpl = await template(t);
    const made = await post(
      t,
      '/v2/scheduled',
      body([cloud], {
        messageType: 'template',
        message: undefined,
        templateId: tpl,
        numbers: numbers(2),
      }),
    );
    const id = made.body.ids[0];
    const start = await balance(t.orgId);
    await due(id);
    await run(t, id);
    for (const s of sent) await receipt(s.id, 'failed');
    await drain(t.orgId);
    expect(await charges(t.orgId)).toHaveLength(0);
    expect(await balance(t.orgId)).toBe(start);
    // the schedule shows both as failed with the provider's text, and the funnel agrees
    expect((await recipients(id)).map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(await row(id)).toMatchObject({ total_failed: 2 });
  });

  it("a report about a message that is not a scheduled message's is not claimed", async () => {
    expect(await receipt(`wamid.unknown.${randomUUID()}`, 'delivered')).toBe(false);
  });

  it("another workspace cannot settle this workspace's message by reporting it", async () => {
    const a = await arrange('w3a');
    const b = await arrange('w3b');
    const tpl = await template(a.t);
    const made = await post(
      a.t,
      '/v2/scheduled',
      body([a.cloud], {
        messageType: 'template',
        message: undefined,
        templateId: tpl,
        numbers: numbers(1),
      }),
    );
    await due(made.body.ids[0]);
    await run(a.t, made.body.ids[0]);
    const startB = await balance(b.t.orgId);
    await receipt(sent[0]!.id, 'delivered');
    await drain(b.t.orgId);
    await drain(a.t.orgId);
    expect(await charges(b.t.orgId)).toHaveLength(0);
    expect(await balance(b.t.orgId)).toBe(startB);
    expect(await charges(a.t.orgId)).toHaveLength(1);
  });
});

describe('a personal-number schedule: charged when it is sent, as the unofficial engine reports no delivery', () => {
  it('charges each message once at send and not again when the ack arrives, and a re-run sends and charges nobody twice', async () => {
    const { t, phone } = await arrange('w4');
    const made = await post(t, '/v2/scheduled', body([phone]));
    const id = made.body.ids[0];
    const start = await balance(t.orgId);
    await due(id);
    expect(await run(t, id)).toBe('finished');
    expect(sent).toHaveLength(3);
    expect(await drain(t.orgId)).toBe(3);
    const c = await charges(t.orgId);
    expect(c).toHaveLength(3);
    const price = Number(c[0]!.credits);
    expect(await balance(t.orgId)).toBe(start - 3 * price);
    // a worker restart replays the job: the finished schedule is skipped, and so is every recipient already sent
    expect(await run(t, id)).toBe('skipped');
    expect(sent).toHaveLength(3);
    // the ack
    for (const s of sent) {
      await receipts.handle({
        orgId: t.orgId,
        deviceId: 1,
        providerMessageId: s.id,
        status: 'delivered',
        occurredAt: new Date(),
      });
    }
    await drain(t.orgId);
    expect(await charges(t.orgId)).toHaveLength(3);
    expect(await balance(t.orgId)).toBe(start - 3 * price);
    expect(await row(id)).toMatchObject({ total_sent: 3, total_delivered: 3 });
  });
});

describe('retries and restarts never charge a message twice', () => {
  it('a retry sends only the recipients that failed; the ones already sent keep their one charge', async () => {
    const { t, phone } = await arrange('w5');
    const nums = numbers(3);
    const made = await post(t, '/v2/scheduled', body([phone], { numbers: nums }));
    const id = made.body.ids[0];
    const start = await balance(t.orgId);
    failNext = (to) => to === nums[1]!.replace(/\D/g, '');
    await due(id);
    expect(await run(t, id)).toBe('finished');
    expect(sent).toHaveLength(2);
    expect(await row(id)).toMatchObject({ status: 'completed', total_sent: 2, total_failed: 1 });
    await drain(t.orgId);
    expect(await charges(t.orgId)).toHaveLength(2);
    const price = Number((await charges(t.orgId))[0]!.credits);

    // the retry gives it a new time; the recipient that failed goes back to pending, the two that were sent stay sent
    failNext = null;
    await h.owner.query(`UPDATE scheduled_messages SET status = 'failed' WHERE uuid = $1`, [id]);
    const retry = await post(t, `/v2/scheduled/${id}/retry`, {
      sendDate: FUTURE,
      sendTime: '11:00',
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    await due(id);
    expect(await run(t, id)).toBe('finished');
    expect(sent).toHaveLength(3); // exactly one more message
    await drain(t.orgId);
    expect(await charges(t.orgId)).toHaveLength(3);
    expect(await balance(t.orgId)).toBe(start - 3 * price);
    // and a second retry-and-run with nothing left to send adds nothing
    expect(await run(t, id)).toBe('skipped');
    expect(sent).toHaveLength(3);
  });

  it('a recipient claimed before a crash is failed as interrupted and never sent or charged again', async () => {
    const { t, phone } = await arrange('w6');
    const made = await post(t, '/v2/scheduled', body([phone], { numbers: numbers(2) }));
    const id = made.body.ids[0];
    const sid = (await row(id)).id;
    const first = `(SELECT min(id) FROM scheduled_message_contacts WHERE scheduled_message_id = ${Number(sid)})`;
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET status = 'processing' WHERE id = ${first}`,
    );
    // touch_row stamps updated_at on every update, so the claim is aged afterwards
    await h.owner.query(
      `ALTER TABLE scheduled_message_contacts DISABLE TRIGGER trg_scheduled_message_contacts_touch`,
    );
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET updated_at = now() - interval '1 hour' WHERE id = ${first}`,
    );
    await h.owner.query(
      `ALTER TABLE scheduled_message_contacts ENABLE TRIGGER trg_scheduled_message_contacts_touch`,
    );
    const start = await balance(t.orgId);
    await due(id);
    await run(t, id);
    expect(sent).toHaveLength(1);
    await drain(t.orgId);
    expect(await charges(t.orgId)).toHaveLength(1);
    const price = Number((await charges(t.orgId))[0]!.credits);
    expect(await balance(t.orgId)).toBe(start - price);
    expect((await recipients(id)).map((r) => r.status).sort()).toEqual(['failed', 'sent']);
  });

  it("a recurring schedule's late delivery reports still find their recipients, and the next occurrence is charged again", async () => {
    const { t, cloud } = await arrange('w7');
    const tpl = await template(t);
    const nums = numbers(2);
    const made = await post(
      t,
      '/v2/scheduled',
      body([cloud], {
        messageType: 'template',
        message: undefined,
        templateId: tpl,
        scheduleType: 'recurring',
        repeatInterval: 'daily',
        numbers: nums,
      }),
    );
    const id = made.body.ids[0];
    const start = await balance(t.orgId);
    await due(id);
    await run(t, id);
    expect(await row(id)).toMatchObject({ status: 'scheduled', recipients_spent: true });
    // the reports come after the run is over, as they do on the Cloud API: the recipients still carry their message ids
    const first = sent.map((s) => s.id);
    expect((await recipients(id)).map((r) => r.wa_message_id).sort()).toEqual([...first].sort());
    for (const x of first) await receipt(x, 'delivered');
    await drain(t.orgId);
    expect(await charges(t.orgId)).toHaveLength(2);
    const price = Number((await charges(t.orgId))[0]!.credits);

    // the next occurrence starts from the whole audience again and is charged on its own message ids
    await due(id);
    await run(t, id);
    expect(sent).toHaveLength(4);
    for (const s of sent.slice(2)) await receipt(s.id, 'delivered');
    await drain(t.orgId);
    expect(await charges(t.orgId)).toHaveLength(4);
    expect(await balance(t.orgId)).toBe(start - 4 * price);
    expect(await row(id)).toMatchObject({ total_sent: 4, total_delivered: 4 });
  });
});

describe('the wallet is checked before anything is written', () => {
  it('refuses to make or edit a schedule when the pay-per-message wallet is empty', async () => {
    const empty = await arrange('w8', 0);
    const refused = await post(empty.t, '/v2/scheduled', body([empty.phone]));
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('WALLET_EMPTY');
    expect(
      (await h.owner.query(`SELECT 1 FROM scheduled_messages WHERE org_id = $1`, [empty.t.orgId]))
        .rows,
    ).toHaveLength(0);

    // funded when it is made, empty when it is edited: the edit is refused the same way and changes nothing
    const { t, phone } = await arrange('w9', 5_000);
    const made = await post(t, '/v2/scheduled', body([phone], { numbers: numbers(1) }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const left = await balance(t.orgId);
    await h.app.get(DatabaseService).txAs({ orgId: t.orgId, userId: null }, (tx) =>
      h.app.get(WalletLedgerService, { strict: false }).post(tx, {
        orgId: t.orgId,
        unit: 'USD',
        type: 'spend',
        direction: 'out',
        amountMinor: left,
        idempotencyKey: `drain:${t.orgId}`,
        source: 'message.sent',
        description: 'drain',
      }),
    );
    const v = (await api.as(t.admin).get(`/v2/scheduled/${made.body.ids[0]}`)).body.rowVersion;
    const edit = await api
      .as(t.admin)
      .patch(`/v2/scheduled/${made.body.ids[0]}`)
      .send({ rowVersion: v, name: 'Renamed' });
    expect(edit.status).toBe(422);
    expect(edit.body.code).toBe('WALLET_EMPTY');
    expect((await row(made.body.ids[0])).schedule_name).toBe('Wallet check');
  });
});
