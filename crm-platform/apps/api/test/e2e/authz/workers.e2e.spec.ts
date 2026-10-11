import { getQueueToken } from '@nestjs/bullmq';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEBHOOK_HEADERS } from '@crm/contracts';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { QUEUES } from '../../../src/infra/queue/queues';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import { BroadcastDispatchProcessor } from '../../../src/modules/broadcasts/broadcast-dispatch.processor';
import {
  EngineSenderRegistry,
  PACING_SETTINGS,
  PacingRuntime,
  type OpenedSender,
  type PacingSettingsSource,
} from '../../../src/modules/broadcasts';
import { CampaignProcessor } from '../../../src/modules/campaigns/campaign.processor';
import { ContactImportProcessor } from '../../../src/modules/crm/contact-import/contact-import.processor';
import { OutboundRegistry, type EngineTransport } from '../../../src/modules/node-bridge-runtime';
import { ScheduledRunProcessor } from '../../../src/modules/scheduled-queue-warmer/scheduled-run.processor';
import { WebhookDeliveryProcessor } from '../../../src/modules/outbound-webhooks/webhook-delivery.processor';
import { MessageDispatchProcessor } from '../../../src/modules/chat-conversations/message-dispatch.processor';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../../../src/modules/chat-conversations';
import { FlowRunProcessor } from '../../../src/modules/flow-runtime-engine/runtime/flow-run.processor';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { PushSubscriptionsRepository } from '../../../src/modules/notifications/push-subscriptions.repository';
import { WebPushDeliveryService } from '../../../src/modules/notifications/web-push-delivery.service';
import { WebPushProcessor } from '../../../src/modules/notifications/web-push.processor';
import { WebPushSender } from '../../../src/modules/notifications/web-push.sender';
import { FakeWebPushProvider } from '../../support/web-push-fakes';
import {
  asUser,
  conversationOf,
  messagesOf,
  simChannel,
  simInbound,
} from '../chat-conversations/pipeline-support';
import {
  addFlow,
  edge,
  graph,
  node,
  sentTo,
  type FlowPipeline,
} from '../flow-runtime-engine/support';
import { sign } from '../../../src/modules/outbound-webhooks/signing';
import { inboundUrlKey } from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import {
  changed,
  fakeJob,
  fingerprint,
  outcome,
  sleep,
  until,
  type Fingerprint,
} from './async-support';

/**
 * Background-work authorization (AUTHZ-018, 079..085, 093; the worker part of 059 and 085).
 *
 * The processors run IN-PROCESS against the real database (restricted role, RLS), real Redis and real BullMQ queues; only the far
 * end of an outbound call is a stand-in that records what it was asked to do (a fake engine adapter, a recording `fetch`). Each
 * suite proves, with a whole-tenant row fingerprint taken through the owner connection:
 *
 *   positive   a job for tenant A reads and writes A, and only A (B's fingerprint is byte-identical afterwards)
 *   forged     a job that names A but points at an object of B is rejected without any side effect
 *   malformed  a missing / non-numeric / negative org id is rejected without any side effect
 *   retries    running the same job again keeps its org and sends nothing twice
 *
 * Mapping: 018 forged and malformed tenant ids on every processor; 079 broadcasts and campaigns; 080 scheduled messages; 082 imports;
 * 083 outbound webhooks; 084 inbound provider webhooks; 085 retries, replays and permission at run time (POLICY-DECISION items are
 * named so in the test titles); 093 what the outbound edge received.
 */
let h: Harness;
let api: Api;
let db: DatabaseService;
let drainer: OutboxDrainService;

const realFetch = globalThis.fetch;
interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}
const fetchCalls: FetchCall[] = [];
/** What the fake receiver answers, by call number for a URL (default 200). */
let receiver: (url: string, nth: number) => number = () => 200;

beforeAll(async () => {
  process.env.CHANNEL_SIMULATOR_ENABLED = 'true';
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/chat-conversations/chat-conversations-worker.module'))
        .ChatConversationsWorkerModule,
      (await import('../../../src/modules/flow-runtime-engine')).FlowRuntimeEngineWorkerModule,
      (await import('../../../src/modules/broadcasts/broadcasts-worker.module'))
        .BroadcastsWorkerModule,
      (await import('../../../src/modules/campaigns/campaigns-worker.module'))
        .CampaignsWorkerModule,
      (
        await import('../../../src/modules/scheduled-queue-warmer/scheduled-queue-warmer-worker.module')
      ).ScheduledQueueWarmerWorkerModule,
      (await import('../../../src/modules/crm/contact-import/contact-import-worker.module'))
        .ContactImportWorkerModule,
      (await import('../../../src/modules/outbound-webhooks/outbound-webhooks-worker.module'))
        .OutboundWebhooksWorkerModule,
      (await import('../../../src/modules/whatsapp-cloud-api-waba/waba-worker.module'))
        .WabaWorkerModule,
    ],
  });
  api = new Api(h);
  db = h.app.get(DatabaseService);
  drainer = new OutboxDrainService(db, h.app.get(OutboxSubscriberRegistry));

  h.app.get(PacingRuntime, { strict: false }).sleep = () => Promise.resolve();
  const pacing = h.app.get<PacingSettingsSource>(PACING_SETTINGS, { strict: false });
  pacing.get = () =>
    Promise.resolve({
      msgGapSeconds: 0,
      enableBatches: false,
      batchSize: 50,
      batchGapMinutes: 5,
      baileysDailyCap: 4000,
    });
  h.app.get(EngineSenderRegistry).register('baileys', engineAdapter);
  h.app.get(OutboundRegistry).register('baileys', transport);

  // The receiver of outbound webhooks: the two public resolver addresses used by the specs are answered here, never dialled.
  const counts = new Map<string, number>();
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith('https://8.8.8.8/') && !url.startsWith('https://8.8.4.4/'))
      return realFetch(input, init);
    const nth = (counts.get(url) ?? 0) + 1;
    counts.set(url, nth);
    fetchCalls.push({
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: String(init?.body ?? ''),
    });
    return new Response('{"ok":true}', { status: receiver(url, nth) });
  }) as typeof fetch;
}, 300_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await h?.stop();
});

// ---- the stand-in edges ----------------------------------------------------------------------------------------------------

interface Outgoing {
  orgId: number;
  senderId: number;
  to: string;
  kind: 'template' | 'text';
}
let outgoing: Outgoing[] = [];
let n = 0;

/** The WhatsApp engine as the broadcast and campaign senders see it. Records WHICH tenant and WHICH sender it was opened for. */
const engineAdapter = {
  open: (orgId: number, sender: { id: number }): Promise<OpenedSender> =>
    Promise.resolve({
      send: (m) => {
        outgoing.push({ orgId, senderId: sender.id, to: m.to, kind: 'template' });
        return Promise.resolve({ providerMessageId: `wamid.b${++n}` });
      },
      sendText: (m) => {
        outgoing.push({ orgId, senderId: sender.id, to: m.to, kind: 'text' });
        return Promise.resolve({ providerMessageId: `wamid.c${++n}` });
      },
    }),
};
/** The same engine as the scheduled-message runner sees it. */
const transport: EngineTransport = {
  open: (orgId: number, sender: unknown) =>
    Promise.resolve({
      send: async (command: { to?: string }) => {
        outgoing.push({
          orgId,
          senderId: (sender as { id: number }).id,
          to: String(command.to),
          kind: 'text',
        });
        return { providerMessageId: `wamid.s${++n}` };
      },
    }),
} as never;

const digits = (s: string) => s.replace(/\D+/g, '');
const phone = () => `+91970${String(n++).padStart(7, '0')}`;

/** Everything a tenant owns (and the outbox / audit rows about it), as one comparable value. */
const print = (...orgs: Tenant[]) =>
  fingerprint(
    h.owner,
    orgs.map((o) => o.orgId),
  );
const expectUntouched = async (before: Fingerprint, ...orgs: Tenant[]) =>
  expect(changed(before, await print(...orgs)), 'tables changed').toEqual([]);

const MALFORMED_ORG_IDS: Array<[string, unknown]> = [
  ['missing', undefined],
  ['null', null],
  ['zero', 0],
  ['negative', -1],
  ['fractional', 1.5],
  ['numeric text', 'not-a-number'],
  ['injection text', '1 OR 1=1; --'],
  ['array', [1, 2]],
  ['object', { $ne: 0 }],
];

const device = async (t: Tenant) =>
  (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Main', '+91', $2, 'connected', true) RETURNING id, uuid`,
      [t.orgId, String(9811100000 + n++)],
    )
  ).rows[0] as { id: string; uuid: string };

// ============================================================================================================================
// AUTHZ-079 / AUTHZ-018  broadcast dispatch
// ============================================================================================================================

describe('AUTHZ-079 broadcast sender', () => {
  let processor: BroadcastDispatchProcessor;
  beforeAll(() => {
    processor = h.app.get(BroadcastDispatchProcessor, { strict: false });
  });

  async function arrange(label: string, contactCount = 2, tpl = true) {
    const t = await api.signup(label);
    const template = tpl
      ? (
          await h.owner.query(
            `INSERT INTO wa_templates (org_id, template_name, template_body, language, status)
             VALUES ($1, 'promo_oct', 'Hello', 'en_US', 'approved') RETURNING uuid`,
            [t.orgId],
          )
        ).rows[0].uuid
      : null;
    const dev = await device(t);
    const phones = Array.from({ length: contactCount }, phone);
    const contacts = await api.seedContacts(
      t,
      phones.map((p, i) => ({ name: `${label}${i}`, phone: p })),
    );
    const res = await api
      .http()
      .post('/v2/broadcasts')
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID())
      .send({
        name: `Blast ${label}`,
        templateId: template,
        contactIds: contacts,
        senderKeys: [`baileys:${dev.uuid}`],
        scheduleType: 'now',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = Number(
      (
        await h.owner.query(`SELECT id FROM broadcasts WHERE uuid = $1`, [
          res.body.broadcasts[0].id,
        ])
      ).rows[0].id,
    );
    return { t, dev, phones: phones.map(digits), broadcastId: id };
  }
  const job = (orgId: unknown, broadcastId: unknown, o?: { attemptsMade?: number }) =>
    fakeJob('dispatch', { orgId, broadcastId }, o);
  const status = async (id: number) =>
    (await h.owner.query(`SELECT status, success_count FROM broadcasts WHERE id = $1`, [id]))
      .rows[0] as {
      status: string;
      success_count: number;
    };

  it('AUTHZ-079 positive: a job for tenant A sends A recipients from A sender only, and leaves tenant B byte-identical', async () => {
    const a = await arrange('bc-a');
    const b = await arrange('bc-b');
    outgoing = [];
    const beforeB = await print(b.t);
    const res = await processor.process(job(a.t.orgId, a.broadcastId));
    expect(res).toBe('finished');
    expect(outgoing.map((o) => o.to).sort()).toEqual([...a.phones].sort());
    expect(outgoing.every((o) => o.orgId === a.t.orgId && o.senderId === Number(a.dev.id))).toBe(
      true,
    );
    expect(await status(a.broadcastId)).toMatchObject({ status: 'completed', success_count: 2 });
    await expectUntouched(beforeB, b.t);

    // ...and the other way round: B's job touches B only.
    outgoing = [];
    const beforeA = await print(a.t);
    expect(await processor.process(job(b.t.orgId, b.broadcastId))).toBe('finished');
    expect(outgoing.map((o) => o.to).sort()).toEqual([...b.phones].sort());
    expect(outgoing.every((o) => o.orgId === b.t.orgId && o.senderId === Number(b.dev.id))).toBe(
      true,
    );
    await expectUntouched(beforeA, a.t);
  });

  it('AUTHZ-079 negative: a job naming tenant A with tenant B broadcast id sends nothing and changes nothing (either direction)', async () => {
    const a = await arrange('bc-fa');
    const b = await arrange('bc-fb');
    outgoing = [];
    const before = await print(a.t, b.t);
    for (const [org, id] of [
      [a.t.orgId, b.broadcastId],
      [b.t.orgId, a.broadcastId],
    ] as const) {
      const r = await outcome(() => processor.process(job(org, id)));
      if (r.ok) expect(r.value).not.toBe('finished');
    }
    expect(outgoing).toEqual([]);
    await expectUntouched(before, a.t, b.t);
    // The rightful owners can still run their own broadcasts afterwards.
    expect(await processor.process(job(a.t.orgId, a.broadcastId))).toBe('finished');
    expect(await processor.process(job(b.t.orgId, b.broadcastId))).toBe('finished');
  });

  it.each(MALFORMED_ORG_IDS)(
    'AUTHZ-018 negative: a broadcast job with a %s org id is rejected without any side effect',
    async (_label, bad) => {
      const a = await arrange(`bc-m${n}`);
      outgoing = [];
      const before = await print(a.t);
      const r = await outcome(() => processor.process(job(bad, a.broadcastId)));
      if (r.ok) expect(r.value).not.toBe('finished');
      expect(outgoing).toEqual([]);
      await expectUntouched(before, a.t);
    },
  );

  it('AUTHZ-018 negative: a broadcast job with a missing or malformed broadcast id is rejected without any side effect', async () => {
    const a = await arrange('bc-mid');
    outgoing = [];
    const before = await print(a.t);
    for (const bad of [undefined, null, 0, -5, 'x', { a: 1 }]) {
      const r = await outcome(() => processor.process(job(a.t.orgId, bad)));
      if (r.ok) expect(r.value).not.toBe('finished');
    }
    expect(outgoing).toEqual([]);
    await expectUntouched(before, a.t);
  });

  it('AUTHZ-085 retry: running the same job again (a retry or a replay from the failed set) sends nobody twice and keeps the org', async () => {
    const a = await arrange('bc-rt');
    outgoing = [];
    expect(await processor.process(job(a.t.orgId, a.broadcastId))).toBe('finished');
    const after = await print(a.t);
    for (const attemptsMade of [1, 2, 4]) {
      expect(await processor.process(job(a.t.orgId, a.broadcastId, { attemptsMade }))).toBe(
        'skipped',
      );
    }
    expect(outgoing).toHaveLength(2);
    await expectUntouched(after, a.t);
  });

  it('AUTHZ-085 POLICY-DECISION: a broadcast scheduled by a member who is removed before it runs is still sent (the job re-checks the row, not the creator)', async () => {
    const t = await api.signup('bc-pol');
    const dev = await device(t);
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, language, status) VALUES ($1,'promo_oct','Hello','en_US','approved') RETURNING uuid`,
        [t.orgId],
      )
    ).rows[0].uuid as string;
    const contacts = await api.seedContacts(t, [{ name: 'Pol', phone: phone() }]);
    const creator = await api.member(t, 'creator', [['bcast.broadcasts.create']]);
    const res = await api
      .http()
      .post('/v2/broadcasts')
      .set(bearer(creator.token))
      .set('idempotency-key', randomUUID())
      .send({
        name: 'By member',
        templateId: tpl,
        contactIds: contacts,
        senderKeys: [`baileys:${dev.uuid}`],
        scheduleType: 'now',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = Number(
      (
        await h.owner.query(`SELECT id FROM broadcasts WHERE uuid = $1`, [
          res.body.broadcasts[0].id,
        ])
      ).rows[0].id,
    );
    const uuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [creator.userId]))
      .rows[0].uuid as string;
    expect((await api.as(t.admin).delete(`/v2/workspace/members/${uuid}`)).status).toBe(204);
    outgoing = [];
    const r = await processor.process(job(t.orgId, id));
    console.log(
      `[POLICY-DECISION] broadcast created by a removed member: job result=${r}, messages sent=${outgoing.length}`,
    );
    // Observed and pinned: the dispatcher carries no actor and does not look at the creator's current permission or status.
    expect(r).toBe('finished');
    expect(outgoing).toHaveLength(1);
  });

  describe('references to another tenant', () => {
    let a: Awaited<ReturnType<typeof arrange>>;
    let b: Awaited<ReturnType<typeof arrange>>;
    beforeAll(async () => {
      a = await arrange('bc-fk-a');
      b = await arrange('bc-fk-b');
    });
    const idOf = async (table: string, org: number) =>
      Number(
        (
          await h.owner.query(`SELECT id FROM "${table}" WHERE org_id = $1 ORDER BY id LIMIT 1`, [
            org,
          ])
        ).rows[0].id,
      );

    it('AUTHZ-018 negative: the database refuses a broadcast whose sender device is another tenant device (composite key)', async () => {
      const r = await outcome(() =>
        h.owner.query(`UPDATE broadcasts SET device_id = $1 WHERE id = $2`, [
          Number(b.dev.id),
          a.broadcastId,
        ]),
      );
      expect(r.ok, 'broadcasts.device_id accepted a device of another tenant').toBe(false);
    });
    it('AUTHZ-018 negative: the database refuses a broadcast whose template is another tenant template (composite key)', async () => {
      const foreign = await idOf('wa_templates', b.t.orgId);
      const r = await outcome(() =>
        h.owner.query(`UPDATE broadcasts SET template_id = $1 WHERE id = $2`, [
          foreign,
          a.broadcastId,
        ]),
      );
      expect(r.ok, 'broadcasts.template_id accepted a template of another tenant').toBe(false);
    });
    it('AUTHZ-018 negative: the database refuses a broadcast recipient row that points at another tenant contact (composite key)', async () => {
      const foreign = await idOf('contacts', b.t.orgId);
      const r = await outcome(() =>
        h.owner.query(`UPDATE broadcast_contacts SET contact_id = $1 WHERE broadcast_id = $2`, [
          foreign,
          a.broadcastId,
        ]),
      );
      expect(r.ok, 'broadcast_contacts.contact_id accepted a contact of another tenant').toBe(
        false,
      );
    });
    it('AUTHZ-079 negative: even with a foreign device id forced into the row, the job sends nothing from tenant B device', async () => {
      const c = await arrange('bc-fk-c');
      const d = await arrange('bc-fk-d');
      await outcome(() =>
        h.owner.query(`UPDATE broadcasts SET device_id = $1 WHERE id = $2`, [
          Number(d.dev.id),
          c.broadcastId,
        ]),
      );
      outgoing = [];
      const beforeD = await print(d.t);
      await outcome(() => processor.process(job(c.t.orgId, c.broadcastId)));
      expect(
        outgoing.filter((o) => o.senderId === Number(d.dev.id) && o.orgId !== d.t.orgId),
      ).toEqual([]);
      expect(outgoing.filter((o) => o.orgId === d.t.orgId)).toEqual([]);
      await expectUntouched(beforeD, d.t);
    });
    it('AUTHZ-079 control: a same-tenant device reference is accepted', async () => {
      const own = await device(a.t);
      expect(
        (
          await outcome(() =>
            h.owner.query(`UPDATE broadcasts SET device_id = $1 WHERE id = $2`, [
              Number(own.id),
              a.broadcastId,
            ]),
          )
        ).ok,
      ).toBe(true);
    });
  });
});

// ============================================================================================================================
// AUTHZ-079  campaigns
// ============================================================================================================================

describe('AUTHZ-079 campaign sender', () => {
  let processor: CampaignProcessor;
  beforeAll(async () => {
    processor = h.app.get(CampaignProcessor, { strict: false });
    // Creating a campaign queues it; the in-process worker would send it before the spec drives the processor itself.
    await h.app.get<Queue>(getQueueToken(QUEUES.CAMPAIGN), { strict: false }).pause();
  });
  afterAll(async () => {
    await h.app
      .get<Queue>(getQueueToken(QUEUES.CAMPAIGN), { strict: false })
      .obliterate({ force: true })
      .catch(() => undefined);
  });

  async function arrange(label: string, count = 2) {
    const t = await api.signup(label);
    const dev = await device(t);
    const phones = Array.from({ length: count }, phone);
    const contactIds = await api.seedContacts(
      t,
      phones.map((p, i) => ({ name: `${label}${i}`, phone: p })),
    );
    const res = await api
      .http()
      .post('/v2/campaigns')
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID())
      .send({
        name: `Offer ${label}`,
        type: 'text',
        customMessage: 'Hi {{name}}',
        scheduleType: 'now',
        senderKey: `baileys:${dev.uuid}`,
        contactIds,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = Number(
      (await h.owner.query(`SELECT id FROM wpcampaigns WHERE uuid = $1`, [res.body.campaign.id]))
        .rows[0].id,
    );
    return { t, dev, phones: phones.map(digits), campaignId: id };
  }
  const job = (orgId: unknown, campaignId: unknown, o?: { attemptsMade?: number }) =>
    fakeJob('run', { orgId, campaignId }, o);

  it('AUTHZ-079 positive: a campaign job messages tenant A contacts from A sender; tenant B is byte-identical', async () => {
    const a = await arrange('cp-a');
    const b = await arrange('cp-b');
    outgoing = [];
    const beforeB = await print(b.t);
    expect(await processor.process(job(a.t.orgId, a.campaignId))).toBe('finished');
    expect(outgoing.map((o) => o.to).sort()).toEqual([...a.phones].sort());
    expect(outgoing.every((o) => o.orgId === a.t.orgId && o.senderId === Number(a.dev.id))).toBe(
      true,
    );
    await expectUntouched(beforeB, b.t);
  });

  it('AUTHZ-079 negative: a job naming A with B campaign id (and the reverse) sends nothing and changes nothing', async () => {
    const a = await arrange('cp-fa');
    const b = await arrange('cp-fb');
    outgoing = [];
    const before = await print(a.t, b.t);
    for (const [org, id] of [
      [a.t.orgId, b.campaignId],
      [b.t.orgId, a.campaignId],
    ] as const) {
      const r = await outcome(() => processor.process(job(org, id)));
      if (r.ok) expect(r.value).not.toBe('finished');
    }
    expect(outgoing).toEqual([]);
    await expectUntouched(before, a.t, b.t);
    expect(await processor.process(job(a.t.orgId, a.campaignId))).toBe('finished');
  });

  it.each(MALFORMED_ORG_IDS)(
    'AUTHZ-018 negative: a campaign job with a %s org id is rejected without any side effect',
    async (_label, bad) => {
      const a = await arrange(`cp-m${n}`);
      outgoing = [];
      const before = await print(a.t);
      const r = await outcome(() => processor.process(job(bad, a.campaignId)));
      if (r.ok) expect(r.value).not.toBe('finished');
      expect(outgoing).toEqual([]);
      await expectUntouched(before, a.t);
    },
  );

  it('AUTHZ-085 retry: a replayed campaign job sends nobody twice', async () => {
    const a = await arrange('cp-rt');
    outgoing = [];
    expect(await processor.process(job(a.t.orgId, a.campaignId))).toBe('finished');
    const after = await print(a.t);
    expect(await processor.process(job(a.t.orgId, a.campaignId, { attemptsMade: 2 }))).toBe(
      'skipped',
    );
    expect(outgoing).toHaveLength(2);
    await expectUntouched(after, a.t);
  });
});

// ============================================================================================================================
// AUTHZ-080  scheduled messages
// ============================================================================================================================

describe('AUTHZ-080 scheduled-message runner', () => {
  let processor: ScheduledRunProcessor;
  beforeAll(() => {
    processor = h.app.get(ScheduledRunProcessor, { strict: false });
  });

  async function arrange(label: string, count = 2) {
    const t = await api.signup(label);
    const dev = await device(t);
    const phones = Array.from({ length: count }, phone);
    const r = await h.owner.query(
      `INSERT INTO scheduled_messages (org_id, schedule_name, template_type, message_content, schedule_type, send_date, send_time,
          scheduled_time, timezone, repeat_every, recipient_type, total_recipients, provider, status)
       VALUES ($1, 'Test', 'text', 'Hello', 'once', '2026-10-05', '09:00', $2::timestamptz, 'UTC', 1, 'numbers', $3, 'baileys', 'scheduled')
       RETURNING id`,
      [t.orgId, new Date(Date.now() - 60_000).toISOString(), count],
    );
    const id = Number(r.rows[0].id);
    for (const p of phones) {
      await h.owner.query(
        `INSERT INTO scheduled_message_contacts (org_id, scheduled_message_id, phone) VALUES ($1,$2,$3)`,
        [t.orgId, id, p],
      );
    }
    return { t, dev, phones: phones.map(digits), scheduledId: id };
  }
  const job = (orgId: unknown, scheduledId: unknown, o?: { attemptsMade?: number }) =>
    fakeJob('run', { orgId, scheduledId }, o);

  it('AUTHZ-080 positive: a scheduled run messages tenant A numbers from A sender only; tenant B is byte-identical', async () => {
    const a = await arrange('sc-a');
    const b = await arrange('sc-b');
    outgoing = [];
    const beforeB = await print(b.t);
    expect(await processor.process(job(a.t.orgId, a.scheduledId))).toBe('finished');
    expect(outgoing.map((o) => o.to).sort()).toEqual([...a.phones].sort());
    expect(outgoing.every((o) => o.orgId === a.t.orgId && o.senderId === Number(a.dev.id))).toBe(
      true,
    );
    await expectUntouched(beforeB, b.t);
  });

  it('AUTHZ-080 negative: a job naming A with B schedule id (and the reverse) sends nothing and changes nothing', async () => {
    const a = await arrange('sc-fa');
    const b = await arrange('sc-fb');
    outgoing = [];
    const before = await print(a.t, b.t);
    for (const [org, id] of [
      [a.t.orgId, b.scheduledId],
      [b.t.orgId, a.scheduledId],
    ] as const) {
      const r = await outcome(() => processor.process(job(org, id)));
      if (r.ok) expect(r.value).not.toBe('finished');
    }
    expect(outgoing).toEqual([]);
    await expectUntouched(before, a.t, b.t);
    expect(await processor.process(job(b.t.orgId, b.scheduledId))).toBe('finished');
  });

  it.each(MALFORMED_ORG_IDS)(
    'AUTHZ-018 negative: a scheduled job with a %s org id is rejected without any side effect',
    async (_label, bad) => {
      const a = await arrange(`sc-m${n}`);
      outgoing = [];
      const before = await print(a.t);
      const r = await outcome(() => processor.process(job(bad, a.scheduledId)));
      if (r.ok) expect(r.value).not.toBe('finished');
      expect(outgoing).toEqual([]);
      await expectUntouched(before, a.t);
    },
  );

  it('AUTHZ-085 retry: a replayed scheduled job messages nobody twice', async () => {
    const a = await arrange('sc-rt');
    outgoing = [];
    expect(await processor.process(job(a.t.orgId, a.scheduledId))).toBe('finished');
    const sentOnce = outgoing.length;
    const r = await outcome(() =>
      processor.process(job(a.t.orgId, a.scheduledId, { attemptsMade: 3 })),
    );
    if (r.ok) expect(r.value).not.toBe('finished');
    expect(outgoing).toHaveLength(sentOnce);
  });
});

// ============================================================================================================================
// AUTHZ-082  contact import
// ============================================================================================================================

describe('AUTHZ-082 contact import worker', () => {
  let processor: ContactImportProcessor;
  beforeAll(async () => {
    processor = h.app.get(ContactImportProcessor, { strict: false });
    // The import is queued when it is uploaded; the in-process worker would run it before the spec drives the processor itself.
    await h.app.get<Queue>(getQueueToken(QUEUES.CON_IMPORT), { strict: false }).pause();
  });
  afterAll(async () => {
    await h.app
      .get<Queue>(getQueueToken(QUEUES.CON_IMPORT), { strict: false })
      .obliterate({ force: true })
      .catch(() => undefined);
  });

  async function arrange(label: string) {
    const t = await api.signup(label);
    const csv =
      'name,mobile\n' +
      Array.from(
        { length: 1100 },
        (_, i) => `${label} ${i},+9196${String(10_000_000 + i + n)}`,
      ).join('\n') +
      '\n';
    n += 2000;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/import')
      .attach('file', Buffer.from(csv), 'people.csv');
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const jobId = Number(
      (await h.owner.query(`SELECT id FROM contact_import_jobs WHERE uuid = $1`, [res.body.id]))
        .rows[0].id,
    );
    return { t, jobId };
  }
  const job = (data: Record<string, unknown>) => fakeJob('import', data);
  const contacts = async (t: Tenant) =>
    Number(
      (await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId]))
        .rows[0].n,
    );
  const queue = () => h.app.get<Queue>(getQueueToken(QUEUES.CON_IMPORT), { strict: false });

  it('AUTHZ-082 negative: a job naming A with B import id (and the reverse) imports nothing and changes nothing', async () => {
    const a = await arrange('im-fa');
    const b = await arrange('im-fb');
    const before = await print(a.t, b.t);
    await outcome(() =>
      processor.process(job({ orgId: a.t.orgId, userId: a.t.adminUserId, jobId: b.jobId })),
    );
    await outcome(() =>
      processor.process(job({ orgId: b.t.orgId, userId: b.t.adminUserId, jobId: a.jobId })),
    );
    await expectUntouched(before, a.t, b.t);
    expect(await contacts(a.t)).toBe(0);
    expect(await contacts(b.t)).toBe(0);
  });

  it.each(MALFORMED_ORG_IDS)(
    'AUTHZ-018 negative: an import job with a %s org id is rejected without any side effect',
    async (_label, bad) => {
      const a = await arrange(`im-m${n}`);
      const before = await print(a.t);
      await outcome(() =>
        processor.process(job({ orgId: bad, userId: a.t.adminUserId, jobId: a.jobId })),
      );
      await expectUntouched(before, a.t);
      expect(await contacts(a.t)).toBe(0);
    },
  );

  it('AUTHZ-082 negative: a job whose actor belongs to another tenant never writes that actor into this tenant data', async () => {
    const a = await arrange('im-act-a');
    const b = await arrange('im-act-b');
    await outcome(() =>
      processor.process(job({ orgId: a.t.orgId, userId: b.t.adminUserId, jobId: a.jobId })),
    );
    const refs = await h.owner
      .query(
        `SELECT (SELECT count(*)::int FROM contacts WHERE org_id = $1 AND owner_id = $2) AS owned,
              (SELECT count(*)::int FROM audit_log WHERE org_id = $1 AND actor_id = $2) AS audited,
              (SELECT count(*)::int FROM contact_import_jobs WHERE org_id = $1 AND created_by = $2) AS jobs`,
        [a.t.orgId, b.t.adminUserId],
      )
      .catch(() => ({ rows: [{ owned: 0, audited: 0, jobs: 0 }] }));
    expect(refs.rows[0]).toEqual({ owned: 0, audited: 0, jobs: 0 });
  });

  it('AUTHZ-082 positive and replay: the rightful job imports A rows only, B is untouched, and a replay adds nothing', async () => {
    const a = await arrange('im-ok-a');
    const b = await arrange('im-ok-b');
    const beforeB = await print(b.t);
    const queued = await queue().getJob(`con-import-${a.t.orgId}-${a.jobId}`);
    expect(queued?.data).toEqual({ orgId: a.t.orgId, userId: a.t.adminUserId, jobId: a.jobId });
    await processor.process(job(queued!.data));
    expect(await contacts(a.t)).toBe(1100);
    expect(await contacts(b.t)).toBe(0);
    await expectUntouched(beforeB, b.t);
    const afterA = await print(a.t);
    await processor.process(job(queued!.data));
    expect(await contacts(a.t)).toBe(1100);
    expect(changed(afterA, await print(a.t)).filter((t) => t === 'contacts')).toEqual([]);
  }, 180_000);
});

// ============================================================================================================================
// AUTHZ-083 / AUTHZ-093  outbound webhooks
// ============================================================================================================================

describe('AUTHZ-083 outbound webhooks', () => {
  let delivery: WebhookDeliveryProcessor;
  const URL_A = 'https://8.8.8.8/in-a';
  const URL_B = 'https://8.8.4.4/in-b';
  const SECRET_A = 'whsec_tenant_a';
  const SECRET_B = 'whsec_tenant_b';
  let A: Tenant;
  let B: Tenant;
  let hookA: { uuid: string; id: number };
  let hookB: { uuid: string; id: number };

  beforeAll(async () => {
    delivery = h.app.get(WebhookDeliveryProcessor, { strict: false });
    A = await api.signup('wh-a');
    B = await api.signup('wh-b');
    const mk = async (t: Tenant, url: string, secret: string) => {
      const res = await api
        .as(t.admin)
        .post('/v2/webhooks')
        .send({ name: 'Sync', url, events: ['contact_created'], secret });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const row = await h.owner.query(`SELECT id FROM webhooks WHERE uuid = $1`, [res.body.id]);
      return { uuid: res.body.id as string, id: Number(row.rows[0].id) };
    };
    hookA = await mk(A, URL_A, SECRET_A);
    hookB = await mk(B, URL_B, SECRET_B);
  });

  async function emit(t: Tenant, label: string): Promise<{ id: string; contactId: string }> {
    const contactId = randomUUID();
    const r = await h.owner.query(
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
       VALUES ($1,'contacts','1','contact.created',$2) RETURNING id`,
      [t.orgId, JSON.stringify({ uuid: contactId, name: label })],
    );
    return { id: String(r.rows[0].id), contactId };
  }
  async function drainAll() {
    for (let i = 0; i < 20; i += 1) {
      await drainer.drain();
      const left = await h.owner.query(
        `SELECT count(*)::int AS n FROM event_outbox WHERE status IN ('pending','processing')`,
      );
      if (left.rows[0].n === 0) return;
      await sleep(50);
    }
  }
  const deliveries = async (t: Tenant) =>
    Number(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM webhook_deliveries WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    );
  const envelope = (event: string, data: Record<string, unknown>) => ({
    id: randomUUID(),
    event,
    createdAt: new Date().toISOString(),
    data,
  });

  it('AUTHZ-083 and 093 positive: tenant A event goes to A endpoint only, signed with A secret, carrying A data; B is byte-identical', async () => {
    await drainAll(); // the drain completes every tenant's pending outbox rows; settle them before B is fingerprinted
    fetchCalls.length = 0;
    const beforeB = await print(B);
    const ev = await emit(A, 'only-a');
    await drainAll();
    const call = await until('A delivery', () => fetchCalls.find((c) => c.url === URL_A));
    expect(fetchCalls.map((c) => c.url)).toEqual([URL_A]);
    const body = JSON.parse(call.body) as { event: string; data: { uuid: string } };
    expect(body).toMatchObject({ event: 'contact_created', data: { uuid: ev.contactId } });
    const ts = call.headers[WEBHOOK_HEADERS.timestamp]!;
    expect(call.headers[WEBHOOK_HEADERS.signature]).toBe(sign(SECRET_A, ts, call.body));
    expect(call.headers[WEBHOOK_HEADERS.signature]).not.toBe(sign(SECRET_B, ts, call.body));
    await until('delivery row', async () => (await deliveries(A)) >= 1);
    expect(await deliveries(B)).toBe(0);
    await expectUntouched(beforeB, B);
  });

  it('AUTHZ-083 and 093 positive: tenant B event goes to B endpoint only, with B secret', async () => {
    fetchCalls.length = 0;
    const ev = await emit(B, 'only-b');
    await drainAll();
    const call = await until('B delivery', () => fetchCalls.find((c) => c.url === URL_B));
    expect(fetchCalls.map((c) => c.url)).toEqual([URL_B]);
    expect(JSON.parse(call.body).data.uuid).toBe(ev.contactId);
    const ts = call.headers[WEBHOOK_HEADERS.timestamp]!;
    expect(call.headers[WEBHOOK_HEADERS.signature]).toBe(sign(SECRET_B, ts, call.body));
  });

  it('AUTHZ-083 negative: a delivery job naming A with B webhook id (and the reverse) sends nothing and changes nothing', async () => {
    fetchCalls.length = 0;
    const before = await print(A, B);
    const r1 = await outcome(() =>
      delivery.process(
        fakeJob('deliver', {
          orgId: A.orgId,
          webhookId: hookB.id,
          envelope: envelope('contact_created', { uuid: randomUUID() }),
        }),
      ),
    );
    const r2 = await outcome(() =>
      delivery.process(
        fakeJob('deliver', {
          orgId: B.orgId,
          webhookId: hookA.id,
          envelope: envelope('contact_created', { uuid: randomUUID() }),
        }),
      ),
    );
    for (const r of [r1, r2]) if (r.ok) expect(r.value).toEqual({ statusCode: null });
    expect(fetchCalls).toEqual([]);
    await expectUntouched(before, A, B);
  });

  it.each(MALFORMED_ORG_IDS)(
    'AUTHZ-018 negative: a delivery job with a %s org id sends nothing and changes nothing',
    async (_label, bad) => {
      fetchCalls.length = 0;
      const before = await print(A, B);
      await outcome(() =>
        delivery.process(
          fakeJob('deliver', {
            orgId: bad,
            webhookId: hookA.id,
            envelope: envelope('contact_created', { uuid: randomUUID() }),
          }),
        ),
      );
      expect(fetchCalls).toEqual([]);
      await expectUntouched(before, A, B);
    },
  );

  it('AUTHZ-083 negative: a delivery job with a missing or malformed webhook id sends nothing', async () => {
    fetchCalls.length = 0;
    for (const bad of [undefined, null, 0, -1, 'x', { a: 1 }]) {
      await outcome(() =>
        delivery.process(
          fakeJob('deliver', {
            orgId: A.orgId,
            webhookId: bad,
            envelope: envelope('contact_created', {}),
          }),
        ),
      );
    }
    expect(fetchCalls).toEqual([]);
  });

  it('AUTHZ-085 replay: the same outbox event handled twice queues one delivery (job id = event id + endpoint)', async () => {
    fetchCalls.length = 0;
    const ev = await emit(A, 'replay');
    await drainAll();
    await until('first delivery', () =>
      fetchCalls.find((c) => JSON.parse(c.body).data.uuid === ev.contactId),
    );
    // Redeliver the very same event to the consumer, as the drain does after a crash.
    const registry = h.app.get(OutboxSubscriberRegistry) as unknown as {
      subscribers: Array<{ name: string; handle(e: unknown): Promise<void> }>;
    };
    const consumer = registry.subscribers.find((s) => s.name === 'outbound-webhooks')!;
    await consumer.handle({
      id: ev.id,
      orgId: A.orgId,
      aggregateModule: 'contacts',
      aggregateId: '1',
      eventType: 'contact.created',
      payload: { uuid: ev.contactId, name: 'replay' },
    });
    await sleep(1500);
    expect(fetchCalls.filter((c) => JSON.parse(c.body).data.uuid === ev.contactId)).toHaveLength(1);
  });

  it('AUTHZ-085 retry: a failed attempt is retried by the queue with the same org, endpoint, secret and envelope id, and never reaches B', async () => {
    fetchCalls.length = 0;
    let failedOnce = false;
    receiver = (url) => {
      if (url === URL_A && !failedOnce) {
        failedOnce = true;
        return 503;
      }
      return 200;
    };
    try {
      await drainAll();
      const beforeB = await print(B);
      const ev = await emit(A, 'retry');
      await drainAll();
      // attempt 1 fails with 503, the queue retries after its first backoff step (10 s)
      const calls = await until(
        'retry delivered',
        () => {
          const mine = fetchCalls.filter((c) => JSON.parse(c.body).data.uuid === ev.contactId);
          return mine.length >= 2 ? mine : undefined;
        },
        45_000,
      );
      expect(new Set(calls.map((c) => c.url))).toEqual(new Set([URL_A]));
      expect(new Set(calls.map((c) => c.headers[WEBHOOK_HEADERS.id])).size).toBe(1);
      for (const c of calls) {
        expect(c.headers[WEBHOOK_HEADERS.signature]).toBe(
          sign(SECRET_A, c.headers[WEBHOOK_HEADERS.timestamp]!, c.body),
        );
      }
      await expectUntouched(beforeB, B);
      expect(fetchCalls.some((c) => c.url === URL_B)).toBe(false);
    } finally {
      receiver = () => 200;
    }
  }, 90_000);
});

// ============================================================================================================================
// AUTHZ-084  inbound provider webhooks (WhatsApp)
// ============================================================================================================================

describe('AUTHZ-084 inbound WhatsApp webhook', () => {
  let A: Tenant;
  let B: Tenant;
  const SECRET_B = 'meta-app-secret-of-tenant-b';
  const PHONE_A = '5550001001';
  const PHONE_B = '5550001002';
  const WABA_A = 'waba-a-1001';
  const WABA_B = 'waba-b-1002';
  let urlKey = '';

  const username = async (t: Tenant) =>
    (
      await h.owner.query(
        `SELECT meta_json ->> 'wa_username' AS u FROM wa_provider_configs WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0].u as string | null;
  const ingestQueue = () => h.app.get<Queue>(getQueueToken(QUEUES.WABA_INGEST), { strict: false });

  beforeAll(async () => {
    urlKey = inboundUrlKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
    A = await api.signup('wb-a');
    B = await api.signup('wb-b');
    const crypto = h.app.get(CryptoService);
    for (const [t, phoneId, wabaId, creds] of [
      [A, PHONE_A, WABA_A, null],
      [B, PHONE_B, WABA_B, crypto.encrypt(JSON.stringify({ app_secret: SECRET_B }))],
    ] as const) {
      await h.owner.query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, meta_json, credentials_json, connected_at)
         VALUES ($1,'waba','connected',$2,$3::jsonb,$4, now())`,
        [
          t.orgId,
          `+${phoneId}`,
          JSON.stringify({ provider: 'meta', waba_id: wabaId, phone_number_id: phoneId }),
          creds,
        ],
      );
    }
  });

  const change = (waba: string, phoneId: string, name: string) => ({
    id: waba,
    changes: [
      {
        field: 'business_username_update',
        value: { metadata: { phone_number_id: phoneId }, username: name, status: 'approved' },
      },
    ],
  });
  const body = (...entries: unknown[]) =>
    JSON.stringify({ object: 'whatsapp_business_account', entry: entries });
  const sigOf = (secret: string, raw: string) =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const post = (raw: string, headers: Record<string, string> = {}, query = '') =>
    api
      .http()
      .post(`/v2/public/webhooks/whatsapp${query}`)
      .set('content-type', 'application/json')
      .set(headers)
      .send(raw);

  it('AUTHZ-084 positive: a payload for B own number signed with B app secret is accepted and lands on B only', async () => {
    const raw = body(change(WABA_B, PHONE_B, 'b_legit'));
    const beforeA = await print(A);
    const res = await post(raw, { 'x-hub-signature-256': sigOf(SECRET_B, raw) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await until('B username', async () => ((await username(B)) === 'b_legit' ? true : undefined));
    await expectUntouched(beforeA, A);
    expect(await username(A)).toBeNull();
  });

  it('AUTHZ-084 negative: tenant B signature over a payload naming ONLY tenant A number is refused and writes nothing', async () => {
    const raw = body(change(WABA_A, PHONE_A, 'forged_by_b_only_a'));
    const before = await print(A);
    const res = await post(raw, { 'x-hub-signature-256': sigOf(SECRET_B, raw) });
    expect(res.status).toBe(401);
    expect(
      await ingestQueue().getJob(createHash('sha256').update(raw).digest('hex')),
    ).toBeUndefined();
    await sleep(500);
    await expectUntouched(before, A);
  });

  it('AUTHZ-084 negative: a payload that names a victim number AND the attacker own number, signed with the attacker app secret, must not deliver to the victim', async () => {
    // The attacker proves possession of ITS secret by including its own number; the victim change in the same body must not ride along.
    const victim = await api.signup('wb-victim');
    const attacker = await api.signup('wb-attacker');
    const secret = 'meta-app-secret-of-the-attacker';
    const crypto = h.app.get(CryptoService);
    for (const [t, phoneId, wabaId, creds] of [
      [victim, '5550002001', 'waba-v-2001', null],
      [
        attacker,
        '5550002002',
        'waba-x-2002',
        crypto.encrypt(JSON.stringify({ app_secret: secret })),
      ],
    ] as const) {
      await h.owner.query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, meta_json, credentials_json, connected_at)
         VALUES ($1,'waba','connected',$2,$3::jsonb,$4, now())`,
        [
          t.orgId,
          `+${phoneId}`,
          JSON.stringify({ provider: 'meta', waba_id: wabaId, phone_number_id: phoneId }),
          creds,
        ],
      );
    }
    const raw = body(
      change('waba-x-2002', '5550002002', 'attacker_own'),
      change('waba-v-2001', '5550002001', 'forged_into_victim'),
    );
    const before = await print(victim);
    const res = await post(raw, { 'x-hub-signature-256': sigOf(secret, raw) });
    await sleep(2000);
    const got = (
      await h.owner.query(
        `SELECT meta_json ->> 'wa_username' AS u FROM wa_provider_configs WHERE org_id = $1`,
        [victim.orgId],
      )
    ).rows[0].u;
    expect(
      got,
      `webhook answered ${res.status}; the victim wa_username was written by a payload signed with the attacker's own app secret`,
    ).toBeNull();
    await expectUntouched(before, victim);
  });

  it('AUTHZ-084 negative: no signature, a wrong signature or a wrong URL key is refused (401) and queues nothing', async () => {
    const raw = body(change(WABA_B, PHONE_B, 'should_not_apply'));
    const queued = createHash('sha256').update(raw).digest('hex');
    expect((await post(raw)).status).toBe(401);
    expect((await post(raw, { 'x-hub-signature-256': sigOf('not-the-secret', raw) })).status).toBe(
      401,
    );
    expect((await post(raw, {}, '?k=not-the-key')).status).toBe(401);
    expect((await post(raw, { 'x-hub-signature-256': 'sha256=zz' })).status).toBe(401);
    expect(await ingestQueue().getJob(queued)).toBeUndefined();
    await sleep(500);
    expect(await username(B)).toBe('b_legit');
  });

  it('AUTHZ-084 negative: a validly authenticated payload for a number no workspace owns writes nothing anywhere', async () => {
    const raw = body(change('waba-unknown', 'no-such-phone', 'ghost'));
    const before = await print(A, B);
    const res = await post(raw, {}, `?k=${urlKey}`);
    expect(res.status).toBe(200);
    await sleep(1500);
    await expectUntouched(before, A, B);
  });

  it('AUTHZ-084 replay: the same signed body twice is one job and one effect', async () => {
    const raw = body(change(WABA_B, PHONE_B, 'b_replayed'));
    const sig = { 'x-hub-signature-256': sigOf(SECRET_B, raw) };
    expect((await post(raw, sig)).status).toBe(200);
    expect((await post(raw, sig)).status).toBe(200);
    await until('replayed username', async () =>
      (await username(B)) === 'b_replayed' ? true : undefined,
    );
    const jobs = await ingestQueue().getJobs(['waiting', 'active', 'delayed', 'completed'], 0, 200);
    expect(
      jobs.filter((j) => j.id === createHash('sha256').update(raw).digest('hex')),
    ).toHaveLength(1);
    expect(await username(A)).toBeNull();
  });
});

// ============================================================================================================================
// AUTHZ-081  flow runtime steps
// ============================================================================================================================

describe('AUTHZ-081 flow runtime step processor', () => {
  let processor: FlowRunProcessor;
  let fp: FlowPipeline;
  const runQueue = () => h.app.get<Queue>(getQueueToken(QUEUES.FLOW_RUN), { strict: false });
  beforeAll(async () => {
    processor = h.app.get(FlowRunProcessor, { strict: false });
    fp = { h, api, stop: async () => undefined };
    // The first step is queued when the run starts; the in-process worker would take it before the spec drives the processor itself.
    await runQueue().pause();
  });
  afterAll(async () => {
    await runQueue()
      .resume()
      .catch(() => undefined);
  });

  let peerCounter = 0;
  async function startedRun(label: string) {
    const t = await api.signup(label);
    const ch = await simChannel({ h, api } as never, t, {
      simulator: { latencyMs: { sent: 0, delivered: 150, read: 400 }, window: 'open' },
    });
    await addFlow(fp, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('a', 'message', { text: `hello from ${label}` }),
          node('z', 'end'),
        ],
        [edge('t', 'a'), edge('a', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: 'go' },
    });
    const peer = `91990${String(1_000_000 + peerCounter++)}`;
    await simInbound({ h, api } as never, t, ch, { from: peer, name: 'Asha', text: 'go' });
    const run = await until('a run for the keyword', async () => {
      const r = await h.owner.query(
        `SELECT id FROM flow_runs WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
        [t.orgId],
      );
      return r.rows[0] ? Number(r.rows[0].id) : undefined;
    });
    const stepJob = await until('the first step job', async () => {
      const jobs = await runQueue().getJobs(['waiting', 'delayed', 'prioritized'], 0, 500);
      return jobs.find((j) => j.data.orgId === t.orgId && j.data.runId === run);
    });
    await sleep(1500); // the inbound message's own async work settles before anyone is fingerprinted
    return { t, ch, peer, runId: run, seq: Number(stepJob.data.seq) };
  }
  const job = (orgId: unknown, runId: unknown, seq: unknown, o?: { attemptsMade?: number }) =>
    fakeJob('step', { orgId, runId, seq }, o);
  const sent = (r: Awaited<ReturnType<typeof startedRun>>) =>
    sentTo(fp, r.t, r.ch as never, r.peer);
  /** What the worker would do: run every waiting step of this run (each step queues the next one) until none is left. */
  async function drive(r: Awaited<ReturnType<typeof startedRun>>, first: number) {
    const results: string[] = [await processor.process(job(r.t.orgId, r.runId, first))];
    for (let i = 0; i < 6; i += 1) {
      const jobs = (await runQueue().getJobs(['waiting', 'delayed', 'prioritized'], 0, 500)).filter(
        (j) => j.data.orgId === r.t.orgId && j.data.runId === r.runId && j.data.seq !== first,
      );
      const next = jobs.find((j) => !results.includes(`seq:${j.data.seq}`));
      if (!next) break;
      results.push(`seq:${next.data.seq}`);
      results.push(await processor.process(job(r.t.orgId, r.runId, Number(next.data.seq))));
    }
    return results;
  }

  it('AUTHZ-081 negative: a step job naming A with B run id (and the reverse) sends nothing and changes nothing', async () => {
    const a = await startedRun('fl-fa');
    const b = await startedRun('fl-fb');
    const before = await print(a.t, b.t);
    for (const [org, run, seq] of [
      [a.t.orgId, b.runId, b.seq],
      [b.t.orgId, a.runId, a.seq],
    ] as const) {
      const r = await outcome(() => processor.process(job(org, run, seq)));
      if (r.ok) expect(r.value).toBe('stale');
    }
    await expectUntouched(before, a.t, b.t);
    expect(await sent(a)).toEqual([]);
    expect(await sent(b)).toEqual([]);
  });

  it.each(MALFORMED_ORG_IDS)(
    'AUTHZ-018 negative: a step job with a %s org id is rejected without any side effect',
    async (_label, bad) => {
      const a = await startedRun(`fl-m${peerCounter}`);
      const before = await print(a.t);
      const r = await outcome(() => processor.process(job(bad, a.runId, a.seq)));
      if (r.ok) expect(r.value).toBe('stale');
      await expectUntouched(before, a.t);
      expect(await sent(a)).toEqual([]);
    },
  );

  it('AUTHZ-081 positive and retry: the rightful step runs for its own tenant only, and a replay of the same step is stale and sends nothing more', async () => {
    const a = await startedRun('fl-ok-a');
    const b = await startedRun('fl-ok-b');
    const beforeB = await print(b.t);
    const results = await drive(a, a.seq);
    expect(
      results.filter((x) => !x.startsWith('seq:')).every((x) => ['stepped', 'ended'].includes(x)),
    ).toBe(true);
    await until('A flow message', async () => ((await sent(a)).length >= 1 ? true : undefined));
    expect(await sent(a)).toEqual(['hello from fl-ok-a']);
    expect(await sent(b)).toEqual([]);
    await expectUntouched(beforeB, b.t);

    const afterA = await sent(a);
    const second = await processor.process(job(a.t.orgId, a.runId, a.seq, { attemptsMade: 1 }));
    expect(second).toBe('stale');
    await sleep(500);
    expect(await sent(a)).toEqual(afterA);
  }, 60_000);
});

// ============================================================================================================================
// AUTHZ-018 / AUTHZ-093  inbox outbound message dispatch
// ============================================================================================================================

describe('AUTHZ-093 inbox message dispatch', () => {
  let processor: MessageDispatchProcessor;
  let facade: ConversationsFacade;
  const queue = () => h.app.get<Queue>(getQueueToken(QUEUES.MESSAGE_DISPATCH), { strict: false });
  beforeAll(async () => {
    processor = h.app.get(MessageDispatchProcessor, { strict: false });
    facade = h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
    // An outbound reply is queued when the agent sends it; the in-process worker would send it before the spec drives the processor.
    await queue().pause();
  });
  afterAll(async () => {
    await queue()
      .obliterate({ force: true })
      .catch(() => undefined);
  });

  let c = 0;
  async function queued(label: string) {
    const t = await api.signup(label);
    const ch = await simChannel({ h, api } as never, t);
    const peer = `91991${String(1_000_000 + c++)}`;
    await simInbound({ h, api } as never, t, ch, { from: peer, name: 'Customer', text: 'hello' });
    const conv = await conversationOf({ h, api } as never, t, ch, peer);
    await until(
      'inbound stored',
      async () => (await messagesOf({ h, api } as never, conv.id as number)).length >= 1,
    );
    const { message } = await asUser(t.orgId, t.adminUserId, () =>
      facade.enqueueOutbound({
        conversationId: conv.uuid as string,
        clientMessageId: randomUUID(),
        content: { kind: 'text', body: `reply from ${label}` },
      }),
    );
    await sleep(2000); // the inbound message's own async work (translation usage, notifications) settles before anyone is fingerprinted
    return { t, messageUuid: message.id as string };
  }
  const job = (data: Record<string, unknown>, o?: { attemptsMade?: number }) =>
    fakeJob('message.send', data, o);
  const status = async (uuid: string) =>
    (await h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [uuid])).rows[0]
      .status as string;

  it('AUTHZ-093 negative: a send job naming A with B message (and the reverse) sends nothing and changes nothing', async () => {
    const a = await queued('md-fa');
    const b = await queued('md-fb');
    const before = await print(a.t, b.t);
    for (const [org, uuid] of [
      [a.t.orgId, b.messageUuid],
      [b.t.orgId, a.messageUuid],
    ] as const) {
      const r = await outcome(() =>
        processor.process(job({ orgId: org, messageUuid: uuid, generation: 1 })),
      );
      if (r.ok) expect(r.value).toBe('missing');
    }
    expect(await status(a.messageUuid)).toBe('queued');
    expect(await status(b.messageUuid)).toBe('queued');
    await expectUntouched(before, a.t, b.t);
  });

  it.each(MALFORMED_ORG_IDS)(
    'AUTHZ-018 negative: a send job with a %s org id is rejected without any side effect',
    async (_label, bad) => {
      const a = await queued(`md-m${c}`);
      const before = await print(a.t);
      const r = await outcome(() =>
        processor.process(job({ orgId: bad, messageUuid: a.messageUuid, generation: 1 })),
      );
      expect(r.ok).toBe(false);
      expect(await status(a.messageUuid)).toBe('queued');
      await expectUntouched(before, a.t);
    },
  );

  it('AUTHZ-093 negative: a send job with a missing or malformed message id is rejected without any side effect', async () => {
    const a = await queued('md-mid');
    const before = await print(a.t);
    for (const bad of [undefined, null, 5, 'not-a-uuid', { a: 1 }]) {
      expect(
        (
          await outcome(() =>
            processor.process(job({ orgId: a.t.orgId, messageUuid: bad, generation: 1 })),
          )
        ).ok,
      ).toBe(false);
    }
    await expectUntouched(before, a.t);
  });

  it('AUTHZ-093 positive and retry: the rightful job sends A message through A channel only; B stays queued; a replay sends nothing more', async () => {
    const a = await queued('md-ok-a');
    const b = await queued('md-ok-b');
    const beforeB = await print(b.t);
    expect(
      await processor.process(job({ orgId: a.t.orgId, messageUuid: a.messageUuid, generation: 1 })),
    ).toBe('sent');
    expect(await status(a.messageUuid)).toBe('sent');
    expect(await status(b.messageUuid)).toBe('queued');
    await expectUntouched(beforeB, b.t);
    const attempts = async () =>
      Number(
        (
          await h.owner.query(
            `SELECT count(*)::int AS n FROM message_events e JOIN messages m ON m.id = e.message_id AND m.org_id = e.org_id WHERE m.uuid = $1 AND e.event = 'attempt'`,
            [a.messageUuid],
          )
        ).rows[0].n,
      );
    const once = await attempts();
    expect(
      await processor.process(
        job({ orgId: a.t.orgId, messageUuid: a.messageUuid, generation: 1 }, { attemptsMade: 2 }),
      ),
    ).toBe('skipped');
    expect(await attempts()).toBe(once);
  });
});

// ============================================================================================================================
// AUTHZ-083  browser push worker
// ============================================================================================================================

describe('AUTHZ-083 web push worker', () => {
  let processor: WebPushProcessor;
  const provider = new FakeWebPushProvider();
  let n2 = 0;

  beforeAll(() => {
    const subs = h.app.get(PushSubscriptionsRepository, { strict: false });
    const sender = new WebPushSender(provider, db as never, subs);
    const delivery = new WebPushDeliveryService(
      db,
      h.app.get(NotificationsRepository, { strict: false }),
      subs,
      sender,
      { isVisible: async () => false } as never,
    );
    processor = new WebPushProcessor(delivery);
  });

  async function arrange(label: string) {
    const t = await api.signup(label);
    const user = await api.member(t, 'pusher', []);
    const uuid = randomUUID();
    await h.owner.query(
      `INSERT INTO inbox_notifications (org_id, uuid, user_id, type, title, body, data, link) VALUES ($1,$2,$3,'new_message',$4,'body','{}'::jsonb,'/inbox')`,
      [t.orgId, uuid, user.userId, `Title ${label}`],
    );
    const endpoint = `https://push.example.test/${label}/${n2++}-${'x'.repeat(30)}`;
    await h.owner.query(
      `INSERT INTO push_subscriptions (org_id, user_id, endpoint, endpoint_hash, p256dh, auth) VALUES ($1,$2,$3,$4,'p256dh-key','auth-key')`,
      [t.orgId, user.userId, endpoint, createHash('sha256').update(endpoint).digest('hex')],
    );
    return { t, userId: user.userId, notificationUuid: uuid, endpoint };
  }
  const job = (data: Record<string, unknown>, o?: { attemptsMade?: number }) =>
    fakeJob('push', data, o);

  it('AUTHZ-083 negative: a push job mixing tenants, users and notifications sends nothing and changes nothing', async () => {
    const a = await arrange('wp-fa');
    const b = await arrange('wp-fb');
    provider.sent.length = 0;
    const before = await print(a.t, b.t);
    const mixes = [
      { orgId: a.t.orgId, userId: a.userId, notificationUuid: b.notificationUuid },
      { orgId: a.t.orgId, userId: b.userId, notificationUuid: a.notificationUuid },
      { orgId: b.t.orgId, userId: a.userId, notificationUuid: a.notificationUuid },
      { orgId: a.t.orgId, userId: b.userId, notificationUuid: b.notificationUuid },
    ];
    for (const data of mixes) await outcome(() => processor.process(job(data)));
    expect(provider.sent).toEqual([]);
    await expectUntouched(before, a.t, b.t);
  });

  it.each(MALFORMED_ORG_IDS)(
    'AUTHZ-018 negative: a push job with a %s org id sends nothing and changes nothing',
    async (_label, bad) => {
      const a = await arrange(`wp-m${n2}`);
      provider.sent.length = 0;
      const before = await print(a.t);
      await outcome(() =>
        processor.process(
          job({ orgId: bad, userId: a.userId, notificationUuid: a.notificationUuid }),
        ),
      );
      expect(provider.sent).toEqual([]);
      await expectUntouched(before, a.t);
    },
  );

  it('AUTHZ-083 and 093 positive: the rightful job pushes to the person own device only; B device and notification are untouched', async () => {
    const a = await arrange('wp-ok-a');
    const b = await arrange('wp-ok-b');
    provider.sent.length = 0;
    const beforeB = await print(b.t);
    await processor.process(
      job({ orgId: a.t.orgId, userId: a.userId, notificationUuid: a.notificationUuid }),
    );
    expect(provider.sent.map((x) => x.target.endpoint)).toEqual([a.endpoint]);
    expect(JSON.stringify(provider.sent[0]!.payload)).toContain('Title wp-ok-a');
    expect(JSON.stringify(provider.sent[0]!.payload)).not.toContain('wp-ok-b');
    await expectUntouched(beforeB, b.t);
  });
});
