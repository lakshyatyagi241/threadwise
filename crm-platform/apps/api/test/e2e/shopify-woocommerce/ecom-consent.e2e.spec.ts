import { randomBytes } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { QUEUES } from '../../../src/infra/queue/queues';
import { SendWindowService } from '../../../src/modules/compliance-center';
import {
  COMMERCE_SENDER,
  type CommerceSender,
} from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import {
  BroadcastService,
  type BroadcastJob,
} from '../../../src/modules/shopify-woocommerce/broadcast.service';
import {
  CartService,
  type CartStepJob,
} from '../../../src/modules/shopify-woocommerce/cart.service';
import { CodService } from '../../../src/modules/shopify-woocommerce/cod.service';
import { EcomInboundService } from '../../../src/modules/shopify-woocommerce/ecom-inbound.service';
import { EventMessageService } from '../../../src/modules/shopify-woocommerce/event-message.service';
import { StockService } from '../../../src/modules/shopify-woocommerce/stock.service';
import {
  WebhookPipelineService,
  type WebhookJob,
} from '../../../src/modules/shopify-woocommerce/webhook-pipeline.service';
import { ConsentKit, refusedWith } from '../contact-consent/broadcast-consent.support';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * BL-141 follow-up (BL-278): every MARKETING-purpose send of the Shopify / WooCommerce senders asks the ConsentGate, on the first send
 * and on a send released from the quiet hours alike; a service or utility message never does. Against a real Postgres (the harness's own
 * container), with a fake sender that records what would have gone out, and the real consent ledger, switch and minor setting.
 */
let h: Harness;
let api: Api;
let kit: ConsentKit;
let svc: BroadcastService;
let queue: Queue<BroadcastJob>;
let events: EventMessageService;
let cart: CartService;
let cod: CodService;
let stock: StockService;
let pipeline: WebhookPipelineService;
let inbound: EcomInboundService;
let crypto: CryptoService;
let realNow: () => Date;
const sent: Array<{ to: string; clearance: string }> = [];
const texts: Array<{ to: string; body: string }> = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  kit = new ConsentKit(h, api);
  svc = h.app.get(BroadcastService);
  queue = h.app.get<Queue<BroadcastJob>>(getQueueToken(QUEUES.ECOM_WEBHOOK), { strict: false });
  events = h.app.get(EventMessageService);
  cart = h.app.get(CartService);
  cod = h.app.get(CodService);
  stock = h.app.get(StockService);
  pipeline = h.app.get(WebhookPipelineService);
  inbound = h.app.get(EcomInboundService);
  realNow = h.app.get(SendWindowService).now;
  crypto = h.app.get(CryptoService, { strict: false });
  const sender = h.app.get<CommerceSender>(COMMERCE_SENDER);
  sender.canSend = () => Promise.resolve(true);
  sender.send = (_o, m) => {
    sent.push({ to: m.to, clearance: m.consent.basis });
    return Promise.resolve({ providerMessageId: 'w1' });
  };
  sender.sendText = (_o, m) => {
    texts.push({ to: m.to, body: m.body });
    return Promise.resolve({ providerMessageId: 't1' });
  };
}, 240_000);

afterAll(async () => {
  await queue?.drain(true);
  await h?.stop();
});

beforeEach(() => {
  sent.length = 0;
  texts.length = 0;
});

afterEach(() => {
  h.app.get(SendWindowService).now = realNow;
});

// --- fixtures ------------------------------------------------------------------------------------------------------------------

type Kind = 'shopify' | 'woocommerce';
const tableOf = (kind: Kind, what: 'logs' | 'events') => `${kind}_integration_${what}`;

async function store(t: Tenant, kind: Kind = 'shopify'): Promise<{ id: number; uuid: string }> {
  const secret = randomBytes(20).toString('hex');
  const r =
    kind === 'shopify'
      ? await h.owner.query(
          `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
           VALUES ($1, $2, $3, 'Acme', 'USD', 'x', $4) RETURNING id, uuid`,
          [t.orgId, t.adminUserId, `${secret.slice(0, 6)}.myshopify.com`, secret],
        )
      : await h.owner.query(
          `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
           VALUES ($1, $2, $3, 'Acme', 'USD', $4, $5, $6) RETURNING id, uuid`,
          [
            t.orgId,
            t.adminUserId,
            `https://${secret.slice(0, 6)}.test`,
            crypto.encrypt('ck'),
            crypto.encrypt('cs'),
            secret,
          ],
        );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

async function template(
  t: Tenant,
  category: string,
  body = 'Hi {{1}}, {{2}} {{3}}',
): Promise<{ id: number; uuid: string }> {
  const r = await h.owner.query(
    `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel, category)
     VALUES ($1, $2, $3, $4, 'en_US', 'whatsapp', $5) RETURNING id, uuid`,
    [t.orgId, t.adminUserId, `tpl_${randomBytes(4).toString('hex')}`, body, category],
  );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

/** The automation of an event, with a template of the given category. */
async function automation(
  t: Tenant,
  kind: Kind,
  storeId: number,
  eventType: string,
  category: string,
  over: { sendTo?: string; adminNumber?: string } = {},
): Promise<void> {
  const tpl = await template(t, category);
  await h.owner.query(
    `INSERT INTO ${tableOf(kind, 'events')} (org_id, integration_id, event_type, is_active, template_id, send_to, admin_number)
     VALUES ($1, $2, $3, true, $4, $5, $6)`,
    [t.orgId, storeId, eventType, tpl.id, over.sendTo ?? 'customer', over.adminNumber ?? null],
  );
}

/** A contact reachable on a number, as the consent ledger and the gate see one. */
async function person(
  t: Tenant,
  phone: string,
  name = `P ${phone.slice(-4)}`,
): Promise<{ id: number; uuid: string }> {
  const r = await h.owner.query(
    `INSERT INTO contacts (org_id, name, phone) VALUES ($1, $2, $3) RETURNING id, uuid`,
    [t.orgId, name, phone],
  );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

async function groupOf(t: Tenant, people: Array<{ id: number }>): Promise<string> {
  const g = await h.owner.query(
    `INSERT INTO contact_groups (org_id, name) VALUES ($1, 'Buyers') RETURNING id, uuid`,
    [t.orgId],
  );
  for (const p of people)
    await h.owner.query(
      `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1, $2, $3)`,
      [t.orgId, p.id, Number(g.rows[0].id)],
    );
  return g.rows[0].uuid as string;
}

const logs = async (t: Tenant, type: string, kind: Kind = 'shopify') =>
  (
    await h.owner.query(
      `SELECT status, recipient, response, payload, error FROM ${tableOf(kind, 'logs')}
        WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [t.orgId, type],
    )
  ).rows;
const skippedRows = async (t: Tenant, type: string, kind: Kind = 'shopify') =>
  (await logs(t, type, kind)).filter((r) => r.status === 'skipped');

const queued = async (orgId: number): Promise<BroadcastJob[]> =>
  (await queue.getJobs(['waiting', 'delayed', 'active']))
    .filter((j) => j.name === 'broadcast' && j.data.orgId === orgId)
    .map((j) => j.data);

const offer = (t: Tenant, s: { uuid: string }, templateUuid: string, groupUuid: string) =>
  api
    .http()
    .post(`/v2/shopify/stores/${s.uuid}/offer`)
    .set(bearer(t.admin))
    .send({ templateUuid, groupUuid });

const winback = (t: Tenant, s: { uuid: string }, templateUuid: string) =>
  api
    .http()
    .post(`/v2/shopify/stores/${s.uuid}/winback`)
    .set(bearer(t.admin))
    .send({ templateUuid, days: 0 });

const order = (t: Tenant, id: string, phone: string) =>
  h.owner.query(
    `INSERT INTO wa_orders (org_id, shopify_order_id, source, customer_phone, total_minor, currency_code, status, items_json)
     VALUES ($1, $2, 'shopify', $3, 5000, 'USD', 'paid', '[]'::jsonb)`,
    [t.orgId, id, phone],
  );

// --- the offer broadcast ---------------------------------------------------------------------------------------------------------

describe('offer broadcast: a MARKETING template asks the ConsentGate for every customer', () => {
  async function arrange(label: string, category = 'marketing') {
    const t = await api.signup(label);
    const s = await store(t);
    const tpl = await template(t, category);
    const granted = await person(t, '+1 555 010 0001', 'Ada Granted');
    const plain = await person(t, '+1 555 010 0002', 'Bo Plain');
    const child = await person(t, '+1 555 010 0003', 'Cy Child');
    await kit.record(t, granted.uuid, 'whatsapp', 'granted');
    const g = await groupOf(t, [granted, plain, child]);
    return { t, s, tpl, g, granted, plain, child };
  }
  const run = async (orgId: number) => {
    const [job] = await queued(orgId);
    await svc.run(job!);
  };

  it('switch on: only a recorded grant goes; the others are skipped, counted by reason and logged with the stable code', async () => {
    const { t, s, tpl, g } = await arrange('ecc1');
    await kit.setSwitch(t, true);
    expect((await offer(t, s, tpl.uuid, g)).body).toEqual({ ok: true, total: 3, queued: true });
    await run(t.orgId);

    expect(sent).toEqual([{ to: '15550100001', clearance: 'asked' }]);
    expect((await logs(t, 'offer/broadcast')).find((r) => r.status === 'sent')).toMatchObject({
      status: 'sent',
      response: {
        sent: 1,
        failed: 0,
        skipped: 2,
        skippedReasons: [{ reason: 'no_consent_recorded', count: 2 }],
      },
    });
    // The Activity tab: one row per reason, never silently dropped.
    expect(await skippedRows(t, 'offer/skipped')).toEqual([
      expect.objectContaining({
        status: 'skipped',
        recipient: '2 contacts',
        error: refusedWith('no_consent_recorded'),
        payload: { reason: 'no_consent_recorded', count: 2 },
      }),
    ]);
  });

  it('switch off (the default): nobody needs a grant, so everyone not withdrawn goes', async () => {
    const { t, s, tpl, g } = await arrange('ecc2');
    await offer(t, s, tpl.uuid, g);
    await run(t.orgId);
    expect(sent.map((m) => m.to).sort()).toEqual(['15550100001', '15550100002', '15550100003']);
    expect(await skippedRows(t, 'offer/skipped')).toEqual([]);
    expect((await logs(t, 'offer/broadcast'))[0]).toMatchObject({
      status: 'sent',
      response: { sent: 3, failed: 0 },
    });
  });

  it('a contact flagged as a minor is skipped when the workspace says no minors', async () => {
    const { t, s, tpl, g, child } = await arrange('ecc3');
    await kit.minor(t, child.id);
    await offer(t, s, tpl.uuid, g);
    await run(t.orgId);
    expect(sent.map((m) => m.to).sort()).toEqual(['15550100001', '15550100002']);
    expect(await skippedRows(t, 'offer/skipped')).toEqual([
      expect.objectContaining({ error: refusedWith('subject_minor'), recipient: '1 contact' }),
    ]);
  });

  it('when the check refuses everyone the row ends skipped with the reason, not failed', async () => {
    const t = await api.signup('ecc4');
    const s = await store(t);
    const tpl = await template(t, 'marketing');
    const a = await person(t, '+1 555 010 0011');
    const b = await person(t, '+1 555 010 0012');
    await kit.setSwitch(t, true);
    await offer(t, s, tpl.uuid, await groupOf(t, [a, b]));
    await run(t.orgId);
    expect(sent).toEqual([]);
    const [main] = await logs(t, 'offer/broadcast');
    expect(main).toMatchObject({
      status: 'skipped',
      response: { sent: 0, failed: 0, skipped: 2 },
      error: refusedWith('no_consent_recorded'),
    });
  });

  it('a UTILITY template is a notice and is never asked: the switch, a missing grant and a minor flag do not stop it', async () => {
    const { t, s, tpl, g, child } = await arrange('ecc5', 'utility');
    await kit.minor(t, child.id);
    await kit.setSwitch(t, true);
    await offer(t, s, tpl.uuid, g);
    await run(t.orgId);
    expect(sent.map((m) => [m.to, m.clearance]).sort()).toEqual([
      ['15550100001', 'service'],
      ['15550100002', 'service'],
      ['15550100003', 'service'],
    ]);
    expect(await skippedRows(t, 'offer/skipped')).toEqual([]);
  });
});

describe('win-back: customers read off orders are matched to their contact by number', () => {
  it('a withdrawn customer is skipped and recorded (it used to be dropped without a trace), a granted one and a stranger go', async () => {
    const t = await api.signup('ecc6');
    const s = await store(t);
    const tpl = await template(t, 'marketing');
    const out = await person(t, '+1 555 020 0001', 'Out');
    const ok = await person(t, '+1 555 020 0002', 'Ok');
    await kit.record(t, ok.uuid, 'whatsapp', 'granted');
    await kit.record(t, out.uuid, 'whatsapp', 'withdrawn');
    await order(t, 'w1', '15550200001');
    await order(t, 'w2', '15550200002');
    await order(t, 'w3', '15550200003');
    expect((await winback(t, s, tpl.uuid)).body).toEqual({ ok: true, total: 3, queued: true });
    const [job] = await queued(t.orgId);
    await svc.run(job!);
    expect(sent.map((m) => m.to).sort()).toEqual(['15550200002', '15550200003']);
    expect((await logs(t, 'winback/broadcast')).find((r) => r.status === 'sent')).toMatchObject({
      response: {
        sent: 2,
        failed: 0,
        skipped: 1,
        skippedReasons: [{ reason: 'withdrawn', count: 1 }],
      },
    });
    expect(await skippedRows(t, 'winback/skipped')).toEqual([
      expect.objectContaining({ error: refusedWith('withdrawn') }),
    ]);
  });

  it('switch on: a stranger with no contact and a customer with no grant are skipped, the granted one goes', async () => {
    const t = await api.signup('ecc7');
    const s = await store(t);
    const tpl = await template(t, 'marketing');
    const ok = await person(t, '+1 555 020 0012');
    await person(t, '+1 555 020 0013');
    await kit.record(t, ok.uuid, 'whatsapp', 'granted');
    await kit.setSwitch(t, true);
    for (const [i, p] of ['15550200012', '15550200013', '15550200014'].entries())
      await order(t, `x${i}`, p);
    await winback(t, s, tpl.uuid);
    await svc.run((await queued(t.orgId))[0]!);
    expect(sent.map((m) => m.to)).toEqual(['15550200012']);
    expect((await skippedRows(t, 'winback/skipped'))[0]).toMatchObject({
      recipient: '2 contacts',
      error: refusedWith('no_consent_recorded'),
    });
  });

  it('a utility win-back is never asked about', async () => {
    const t = await api.signup('ecc8');
    const s = await store(t);
    const tpl = await template(t, 'utility');
    await kit.setSwitch(t, true);
    await order(t, 'u1', '15550200021');
    await winback(t, s, tpl.uuid);
    await svc.run((await queued(t.orgId))[0]!);
    expect(sent).toEqual([{ to: '15550200021', clearance: 'service' }]);
  });
});

describe('held for the quiet hours, then released: the gate is asked first and asked again', () => {
  /** 2030-10-15 16:00 UTC: 21:30 in India (quiet 21:00 to 09:00), 17:00 in London (open). */
  const EVENING = new Date('2030-10-15T16:00:00Z');
  const MORNING = new Date('2030-10-16T03:31:00Z');

  async function arrange(label: string) {
    const t = await api.signup(label);
    const s = await store(t);
    const tpl = await template(t, 'marketing');
    await h.owner.query(
      `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end) VALUES ($1, true, '21:00', '09:00')`,
      [t.orgId],
    );
    const asha = await person(t, '+91 98765 43210', 'Asha Rao');
    const ned = await person(t, '+44 20 7183 8750', 'Ned Hill');
    return { t, s, tpl, asha, ned, g: await groupOf(t, [asha, ned]) };
  }
  const window = () => h.app.get(SendWindowService);

  it('a customer who is refused is not held for a message that will not go', async () => {
    const { t, s, tpl, g, ned } = await arrange('ecc9');
    await kit.record(t, ned.uuid, 'whatsapp', 'granted');
    await kit.setSwitch(t, true);
    window().now = () => EVENING;
    await offer(t, s, tpl.uuid, g);
    await svc.run((await queued(t.orgId))[0]!);
    // Ned (open, granted) goes; Asha has no grant: refused now, not queued for the opening.
    expect(sent.map((m) => m.to)).toEqual(['442071838750']);
    expect((await queued(t.orgId)).filter((j) => j.resume)).toEqual([]);
    expect((await logs(t, 'offer/broadcast')).find((r) => r.status === 'sent')).toMatchObject({
      response: { sent: 1, skipped: 1, skippedReasons: [{ reason: 'no_consent_recorded' }] },
    });
  });

  it('a customer who withdrew while the message waited is refused on release, with the reason recorded', async () => {
    const { t, s, tpl, g, asha } = await arrange('ecc10');
    window().now = () => EVENING;
    await offer(t, s, tpl.uuid, g);
    await svc.run((await queued(t.orgId))[0]!);
    expect(sent.map((m) => m.to)).toEqual(['442071838750']);
    const resume = (await queued(t.orgId)).find((j) => j.resume)!;
    expect(resume.resume?.audience).toMatchObject([
      { phone: '+91 98765 43210', contactId: asha.id },
    ]);

    await kit.record(t, asha.uuid, 'whatsapp', 'withdrawn');
    sent.length = 0;
    window().now = () => MORNING;
    await svc.run(resume);
    expect(sent).toEqual([]);
    expect((await logs(t, 'offer/broadcast')).find((r) => r.status === 'sent')).toMatchObject({
      status: 'sent',
      response: { sent: 1, failed: 0, skipped: 1, skippedReasons: [{ reason: 'withdrawn' }] },
    });
    expect(await skippedRows(t, 'offer/skipped')).toEqual([
      expect.objectContaining({ error: refusedWith('withdrawn') }),
    ]);
  });

  it('the workspace switch turned on while the message waited: a customer with no grant is refused on release', async () => {
    const { t, s, tpl, g } = await arrange('ecc11');
    window().now = () => EVENING;
    await offer(t, s, tpl.uuid, g);
    await svc.run((await queued(t.orgId))[0]!);
    const resume = (await queued(t.orgId)).find((j) => j.resume)!;
    await kit.setSwitch(t, true);
    sent.length = 0;
    window().now = () => MORNING;
    await svc.run(resume);
    expect(sent).toEqual([]);
    expect(await skippedRows(t, 'offer/skipped')).toEqual([
      expect.objectContaining({ error: refusedWith('no_consent_recorded') }),
    ]);
  });

  it('a customer still allowed on release is messaged, and the log ends with the totals of both runs', async () => {
    const { t, s, tpl, g } = await arrange('ecc12');
    window().now = () => EVENING;
    await offer(t, s, tpl.uuid, g);
    await svc.run((await queued(t.orgId))[0]!);
    const resume = (await queued(t.orgId)).find((j) => j.resume)!;
    sent.length = 0;
    window().now = () => MORNING;
    await svc.run(resume);
    expect(sent.map((m) => m.to)).toEqual(['919876543210']);
    expect((await logs(t, 'offer/broadcast'))[0]).toMatchObject({
      status: 'sent',
      response: { sent: 2, failed: 0 },
    });
  });
});

// --- the automations: order and cart messages ----------------------------------------------------------------------------------------

const customerData = (phone: string) => ({
  id: 9001,
  name: '#9001',
  order_number: 9001,
  total_price: '40.00',
  currency: 'USD',
  token: `tok-${randomBytes(4).toString('hex')}`,
  email: 'a@x.test',
  abandoned_checkout_url: 'https://shop/checkout/abc',
  customer: { first_name: 'Ada', last_name: 'L', phone },
});

describe('automation messages (EventMessageService)', () => {
  async function fire(
    t: Tenant,
    storeId: number,
    eventType: string,
    data: Record<string, unknown>,
  ) {
    const cfg = await events.config(t.orgId, 'shopify', storeId, eventType);
    expect(cfg, `an active ${eventType} automation`).toBeDefined();
    return events.send(t.orgId, 'shopify', storeId, cfg!, data, `ref-${eventType}`);
  }

  it('an order confirmation (UTILITY) is never blocked: STOP, the switch and a minor flag do not stop it', async () => {
    const t = await api.signup('ecc13');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'orders/create', 'utility');
    const c = await person(t, '+1 555 030 0001');
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    await kit.minor(t, c.id);
    await kit.setSwitch(t, true);
    const out = await fire(t, s.id, 'orders/create', customerData('+1 555 030 0001'));
    expect(out).toMatchObject({ status: 'sent', recipient: '15550300001', error: null });
    expect(sent).toEqual([{ to: '15550300001', clearance: 'service' }]);
  });

  it('an abandoned-cart reminder with a MARKETING template: a customer who opted out is skipped with the reason, never dropped silently', async () => {
    const t = await api.signup('ecc14');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'checkouts/create', 'marketing');
    const c = await person(t, '+1 555 030 0002');
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    const out = await fire(t, s.id, 'checkouts/create', customerData('+1 555 030 0002'));
    expect(out).toMatchObject({
      status: 'skipped',
      recipient: '15550300002',
      error: refusedWith('withdrawn'),
      response: [{ to: '15550300002', skipped: 'withdrawn' }],
    });
    expect(sent).toEqual([]);
  });

  it('a granted customer and one with nothing on record (switch off) get the reminder', async () => {
    const t = await api.signup('ecc15');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'checkouts/create', 'marketing');
    const granted = await person(t, '+1 555 030 0003');
    await kit.record(t, granted.uuid, 'whatsapp', 'granted');
    expect((await fire(t, s.id, 'checkouts/create', customerData('+1 555 030 0003'))).status).toBe(
      'sent',
    );
    expect((await fire(t, s.id, 'checkouts/create', customerData('+1 555 030 0004'))).status).toBe(
      'sent',
    );
    expect(sent.map((m) => [m.to, m.clearance])).toEqual([
      ['15550300003', 'asked'],
      ['15550300004', 'asked'],
    ]);
  });

  it('switch on: a reminder needs a recorded grant', async () => {
    const t = await api.signup('ecc16');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'checkouts/create', 'marketing');
    const granted = await person(t, '+1 555 030 0005');
    await person(t, '+1 555 030 0006');
    await kit.record(t, granted.uuid, 'whatsapp', 'granted');
    await kit.setSwitch(t, true);
    expect((await fire(t, s.id, 'checkouts/create', customerData('+1 555 030 0005'))).status).toBe(
      'sent',
    );
    expect(await fire(t, s.id, 'checkouts/create', customerData('+1 555 030 0006'))).toMatchObject({
      status: 'skipped',
      error: refusedWith('no_consent_recorded'),
    });
    // A number that is no contact at all has nothing on record either.
    expect(await fire(t, s.id, 'checkouts/create', customerData('+1 555 030 0007'))).toMatchObject({
      status: 'skipped',
      error: refusedWith('no_consent_recorded'),
    });
    expect(sent.map((m) => m.to)).toEqual(['15550300005']);
  });

  it('the same reminder set up as UTILITY is a notice and is not asked about', async () => {
    const t = await api.signup('ecc17');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'checkouts/create', 'utility');
    const c = await person(t, '+1 555 030 0008');
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    expect((await fire(t, s.id, 'checkouts/create', customerData('+1 555 030 0008'))).status).toBe(
      'sent',
    );
  });

  it('the merchant admin number is not a customer: it gets the message although the customer is refused', async () => {
    const t = await api.signup('ecc18');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'checkouts/create', 'marketing', {
      sendTo: 'both',
      adminNumber: '+1 555 099 0000',
    });
    const c = await person(t, '+1 555 030 0009');
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    const out = await fire(t, s.id, 'checkouts/create', customerData('+1 555 030 0009'));
    expect(out).toMatchObject({
      status: 'sent',
      recipient: '15550990000',
      error: refusedWith('withdrawn'),
    });
    expect(sent).toEqual([{ to: '15550990000', clearance: 'staff' }]);
  });

  it('a cart-recovery step that comes due is cleared too, and its log row says skipped with the reason', async () => {
    const t = await api.signup('ecc19');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'cart/step2', 'marketing');
    const c = await person(t, '+1 555 030 0010');
    const data = customerData('+1 555 030 0010');
    await cart.schedule(t.orgId, 'shopify', s.id, data);
    const recoveryId = Number(
      (await h.owner.query(`SELECT id FROM shopify_cart_recoveries WHERE org_id = $1`, [t.orgId]))
        .rows[0].id,
    );
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    const job: CartStepJob = {
      orgId: t.orgId,
      kind: 'shopify',
      storeId: s.id,
      eventType: 'cart/step2',
      recoveryId,
      data,
    };
    await cart.runStep(job);
    expect(sent).toEqual([]);
    expect(await logs(t, 'cart/step2')).toEqual([
      expect.objectContaining({
        status: 'skipped',
        recipient: '15550300010',
        error: refusedWith('withdrawn'),
      }),
    ]);
  });

  it('through the webhook pipeline the delivery log row carries the skip', async () => {
    const t = await api.signup('ecc20');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'orders/create', 'marketing');
    const c = await person(t, '+1 555 030 0011');
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    const log = (
      await h.owner.query(
        `INSERT INTO shopify_integration_logs (org_id, integration_id, event_type, status) VALUES ($1, $2, 'orders/create', 'received') RETURNING id, created_at`,
        [t.orgId, s.id],
      )
    ).rows[0];
    const job: WebhookJob = {
      orgId: t.orgId,
      kind: 'shopify',
      storeId: s.id,
      eventType: 'orders/create',
      data: customerData('+1 555 030 0011'),
      log: { id: Number(log.id), createdAt: new Date(log.created_at).toISOString() },
    };
    await pipeline.run(job);
    expect(sent).toEqual([]);
    expect((await logs(t, 'orders/create'))[0]).toMatchObject({
      status: 'skipped',
      error: refusedWith('withdrawn'),
    });
  });
});

// --- cash on delivery, back in stock, the reward --------------------------------------------------------------------------------------

describe('COD confirmation', () => {
  const sOrder = (phone: string) => ({
    id: 7001,
    name: '#7001',
    order_number: 7001,
    total_price: '40.00',
    currency: 'USD',
    financial_status: 'pending',
    customer: { first_name: 'Ada', last_name: 'L', phone },
  });

  it('a confirmation (UTILITY) is never blocked by an opt-out', async () => {
    const t = await api.signup('ecc21');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'cod/confirm', 'utility');
    const c = await person(t, '+1 555 040 0001');
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    await cod.confirm(t.orgId, 'shopify', s.id, sOrder('+1 555 040 0001'));
    expect(sent).toEqual([{ to: '15550400001', clearance: 'service' }]);
    expect((await logs(t, 'cod/confirm'))[0]).toMatchObject({ status: 'sent' });
  });

  it('one sent with a MARKETING template is asked like any marketing message: skipped with the reason, and the log says so', async () => {
    const t = await api.signup('ecc22');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'cod/confirm', 'marketing');
    const c = await person(t, '+1 555 040 0002');
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    await cod.confirm(t.orgId, 'shopify', s.id, sOrder('+1 555 040 0002'));
    expect(sent).toEqual([]);
    expect((await logs(t, 'cod/confirm'))[0]).toMatchObject({
      status: 'skipped',
      recipient: '15550400002',
      error: refusedWith('withdrawn'),
    });
  });
});

describe('back-in-stock alerts', () => {
  async function waitlist(t: Tenant, phones: string[]) {
    await h.owner.query(
      `INSERT INTO wa_products (org_id, shopify_product_id, sku, name, slug, price_minor, currency_code, in_stock, availability, status)
       VALUES ($1, '601', 'SH-R', 'Red Shirt', 'red-shirt-601', 1000, 'USD', false, 'out of stock', 'active')`,
      [t.orgId],
    );
    for (const phone of phones)
      expect(await stock.optIn(t.orgId, 'shopify', phone, 'notify me red shirt')).toBe(true);
  }
  const restock = async (t: Tenant, storeId: number) => {
    const log = (
      await h.owner.query(
        `INSERT INTO shopify_integration_logs (org_id, integration_id, event_type, status) VALUES ($1, $2, 'products/update', 'received') RETURNING id, created_at`,
        [t.orgId, storeId],
      )
    ).rows[0];
    await pipeline.run({
      orgId: t.orgId,
      kind: 'shopify',
      storeId,
      eventType: 'products/update',
      data: {
        id: 601,
        title: 'Red Shirt',
        handle: 'red-shirt',
        variants: [{ inventory_quantity: 5 }],
      },
      log: { id: Number(log.id), createdAt: new Date(log.created_at).toISOString() },
    } satisfies WebhookJob);
  };
  const statuses = async (t: Tenant) =>
    (
      await h.owner.query(
        `SELECT customer_phone, status FROM shopify_stock_waitlist WHERE org_id = $1 ORDER BY id`,
        [t.orgId],
      )
    ).rows;

  it('a MARKETING alert skips the customer who opted out; the rest are told, and everyone is marked notified once', async () => {
    const t = await api.signup('ecc23');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'stock/back', 'marketing');
    const out = await person(t, '+1 555 050 0001');
    await kit.record(t, out.uuid, 'whatsapp', 'withdrawn');
    await waitlist(t, ['15550500001', '15550500002']);
    await restock(t, s.id);
    expect(sent.map((m) => m.to)).toEqual(['15550500002']);
    expect(await statuses(t)).toEqual([
      { customer_phone: '15550500001', status: 'notified' },
      { customer_phone: '15550500002', status: 'notified' },
    ]);
    const rows = await logs(t, 'stock/back');
    expect(rows.find((r) => r.status === 'skipped')).toMatchObject({
      recipient: '1 waiting',
      error: refusedWith('withdrawn'),
    });
    expect(rows.find((r) => r.status === 'sent')).toMatchObject({
      payload: { notified: 1, skipped: 1, skippedReasons: [{ reason: 'withdrawn', count: 1 }] },
    });
  });

  it('a UTILITY alert tells everyone on the waitlist, opted out or not', async () => {
    const t = await api.signup('ecc24');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'stock/back', 'utility');
    const out = await person(t, '+1 555 050 0011');
    await kit.record(t, out.uuid, 'whatsapp', 'withdrawn');
    await kit.setSwitch(t, true);
    await waitlist(t, ['15550500011', '15550500012']);
    await restock(t, s.id);
    expect(sent.map((m) => m.to).sort()).toEqual(['15550500011', '15550500012']);
    expect(await skippedRows(t, 'stock/back')).toEqual([]);
  });

  it('the acknowledgement of the opt-in is a reply inside the open session and is never asked, even for a customer who opted out', async () => {
    const t = await api.signup('ecc28');
    const s = await store(t);
    await automation(t, 'shopify', s.id, 'stock/back', 'marketing');
    const out = await person(t, '+1 555 050 0021');
    await kit.record(t, out.uuid, 'whatsapp', 'withdrawn');
    await kit.minor(t, out.id);
    await kit.setSwitch(t, true);
    await waitlist(t, ['15550500021']);
    expect(texts).toEqual([
      { to: '15550500021', body: expect.stringContaining('back in stock') as string },
    ]);
  });
});

describe('the review reward', () => {
  const PHONE = '2348012345678';
  async function arrange(label: string, category: string) {
    const t = await api.signup(label);
    const s = await store(t, 'woocommerce');
    await automation(t, 'woocommerce', s.id, 'review/reward', category);
    await h.owner.query(
      `INSERT INTO wa_orders (org_id, woo_order_id, source, customer_phone, total_minor, currency_code, status, items_json, meta_json, created_at)
       VALUES ($1, '100', 'woocommerce', $2, 1000, 'USD', 'shipped', '[]'::jsonb, '{}'::jsonb, now() - interval '3 days')`,
      [t.orgId, PHONE],
    );
    const c = await person(t, `+${PHONE}`);
    return { t, c };
  }

  it('a MARKETING reward is skipped for a customer who opted out, logged with the reason, and does not use up the 30-day cooldown', async () => {
    const { t, c } = await arrange('ecc25', 'marketing');
    await kit.record(t, c.uuid, 'whatsapp', 'withdrawn');
    expect(await inbound.handleInbound(t.orgId, PHONE, '5 stars, great')).toEqual([
      'woocommerce-concierge',
    ]);
    expect(sent).toEqual([]);
    expect(await logs(t, 'review/reward', 'woocommerce')).toEqual([
      expect.objectContaining({ status: 'skipped', error: refusedWith('withdrawn') }),
    ]);
    // Opting back in: the next good rating is rewarded, as nothing was given the first time.
    await kit.record(t, c.uuid, 'whatsapp', 'granted');
    await inbound.handleInbound(t.orgId, PHONE, 'love it');
    expect(sent).toEqual([{ to: PHONE, clearance: 'asked' }]);
  });

  it('a granted customer is rewarded', async () => {
    const { t, c } = await arrange('ecc26', 'marketing');
    await kit.record(t, c.uuid, 'whatsapp', 'granted');
    await kit.setSwitch(t, true);
    await inbound.handleInbound(t.orgId, PHONE, 'great');
    expect(sent).toEqual([{ to: PHONE, clearance: 'asked' }]);
  });
});
