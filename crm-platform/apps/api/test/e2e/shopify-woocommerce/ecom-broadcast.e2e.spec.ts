import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUES } from '../../../src/infra/queue/queues';
import {
  COMMERCE_SENDER,
  type CommerceSender,
} from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import {
  BroadcastService,
  type BroadcastJob,
} from '../../../src/modules/shopify-woocommerce/broadcast.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** The offer and win-back broadcasts (WD-ECOM-014, 015), against a real Postgres and a fake sender. */
let h: Harness;
let api: Api;
let svc: BroadcastService;
let queue: Queue<BroadcastJob>;
const sent: Array<{ to: string; params: string[] }> = [];
let failFor: string | null = null;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  svc = h.app.get(BroadcastService);
  queue = h.app.get<Queue<BroadcastJob>>(getQueueToken(QUEUES.ECOM_WEBHOOK), { strict: false });
  const sender = h.app.get<CommerceSender>(COMMERCE_SENDER);
  sender.send = (_o, m) => {
    if (failFor && m.to === failFor) return Promise.reject(new Error('no route'));
    sent.push({ to: m.to, params: m.params });
    return Promise.resolve({ providerMessageId: 'w1' });
  };
}, 240_000);

afterAll(async () => {
  await queue?.drain(true);
  await h?.stop();
});

beforeEach(() => {
  sent.length = 0;
  failFor = null;
});

async function setup(t: Tenant, kind: 'shopify' | 'woocommerce' = 'shopify') {
  const secret = randomBytes(20).toString('hex');
  const store =
    kind === 'shopify'
      ? await h.owner.query(
          `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
           VALUES ($1, $2, $3, 'Acme', 'USD', 'x', $4) RETURNING id, uuid`,
          [t.orgId, t.adminUserId, `${secret.slice(0, 6)}.myshopify.com`, secret],
        )
      : await h.owner.query(
          `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
           VALUES ($1, $2, $3, 'Acme', 'USD', 'k', 's', $4) RETURNING id, uuid`,
          [t.orgId, t.adminUserId, `https://${secret.slice(0, 6)}.test`, secret],
        );
  const tpl = await h.owner.query(
    `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel)
     VALUES ($1, $2, $3, 'Hi {{1}}, {{2}} {{3}}', 'en_US', 'whatsapp') RETURNING uuid`,
    [t.orgId, t.adminUserId, `tpl_${randomBytes(4).toString('hex')}`],
  );
  return {
    storeId: Number(store.rows[0].id),
    storeUuid: store.rows[0].uuid as string,
    templateUuid: tpl.rows[0].uuid as string,
  };
}

async function group(
  t: Tenant,
  members: Array<{ phone: string; name: string; unsub?: boolean }>,
): Promise<string> {
  const g = await h.owner.query(
    `INSERT INTO contact_groups (org_id, name) VALUES ($1, 'Buyers') RETURNING id, uuid`,
    [t.orgId],
  );
  for (const m of members) {
    const c = await h.owner.query(
      `INSERT INTO contacts (org_id, name, phone, is_unsubscribed) VALUES ($1, $2, $3, $4) RETURNING id`,
      [t.orgId, m.name, m.phone, m.unsub ?? false],
    );
    await h.owner.query(
      `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1, $2, $3)`,
      [t.orgId, Number(c.rows[0].id), Number(g.rows[0].id)],
    );
  }
  return g.rows[0].uuid as string;
}

const queued = async (): Promise<BroadcastJob[]> =>
  (await queue.getJobs(['waiting', 'delayed', 'active']))
    .filter((j) => j.name === 'broadcast')
    .map((j) => j.data);

const log = async (t: Tenant, type: string) =>
  (
    await h.owner.query(
      `SELECT status, recipient, response, error FROM shopify_integration_logs WHERE org_id = $1 AND event_type = $2`,
      [t.orgId, type],
    )
  ).rows[0];

describe('send offer (WD-ECOM-014)', () => {
  it('queues the sends to the opted-in members and writes the counts when it runs', async () => {
    const t = await api.signup('ebc1');
    const s = await setup(t);
    const g = await group(t, [
      { phone: '+1 555 010 0001', name: 'Ada Lovelace' },
      { phone: '15550100002', name: 'Bo' },
      { phone: '15550100003', name: 'Out', unsub: true },
      { phone: '', name: 'NoNumber' },
    ]);
    await h.owner.query(
      `INSERT INTO wa_products (org_id, shopify_product_id, name, slug, price_minor, currency_code, product_url) VALUES ($1, '1', 'Red Shirt', 'red-shirt', 1000, 'USD', 'https://x/p')`,
      [t.orgId],
    );
    const product = (
      await h.owner.query(`SELECT uuid FROM wa_products WHERE org_id = $1`, [t.orgId])
    ).rows[0].uuid;
    const res = await api
      .http()
      .post(`/v2/shopify/stores/${s.storeUuid}/offer`)
      .set(bearer(t.admin))
      .send({
        templateUuid: s.templateUuid,
        groupUuid: g,
        productUuid: product,
        couponCode: 'SAVE10',
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, total: 3, queued: true });
    const [job] = (await queued()).filter((j) => j.orgId === t.orgId);
    expect(await log(t, 'offer/broadcast')).toMatchObject({
      status: 'processed',
      recipient: '3 contacts',
    });
    await svc.run(job!);
    expect(sent.map((m) => m.to).sort()).toEqual(['15550100001', '15550100002']);
    expect(sent.find((m) => m.to === '15550100001')!.params).toEqual([
      'Ada',
      'Red Shirt',
      'SAVE10',
    ]);
    expect(await log(t, 'offer/broadcast')).toMatchObject({
      status: 'sent',
      response: { sent: 2, failed: 1 },
    });
  });

  it("answers ok:false for an unknown template or an empty audience, and 404 for another workspace's store", async () => {
    const t = await api.signup('ebc2');
    const other = await api.signup('ebc3');
    const s = await setup(t);
    const empty = await group(t, []);
    const unknown = await api
      .http()
      .post(`/v2/shopify/stores/${s.storeUuid}/offer`)
      .set(bearer(t.admin))
      .send({ templateUuid: randomUUID(), groupUuid: empty });
    expect(unknown.body).toEqual({ ok: false, message: 'Template not found.' });
    const none = await api
      .http()
      .post(`/v2/shopify/stores/${s.storeUuid}/offer`)
      .set(bearer(t.admin))
      .send({ templateUuid: s.templateUuid, groupUuid: empty });
    expect(none.body).toEqual({
      ok: false,
      message: 'That segment has no contactable (opted-in) members.',
    });
    const foreign = await api
      .http()
      .post(`/v2/shopify/stores/${s.storeUuid}/offer`)
      .set(bearer(other.admin))
      .send({ templateUuid: s.templateUuid, groupUuid: empty });
    expect(foreign.status).toBe(404);
  });

  it('a send that fails counts as failed and the row says why', async () => {
    const t = await api.signup('ebc4');
    const s = await setup(t);
    const g = await group(t, [{ phone: '15550100009', name: 'Zed' }]);
    failFor = '15550100009';
    await api
      .http()
      .post(`/v2/shopify/stores/${s.storeUuid}/offer`)
      .set(bearer(t.admin))
      .send({ templateUuid: s.templateUuid, groupUuid: g });
    const [job] = (await queued()).filter((j) => j.orgId === t.orgId);
    await svc.run(job!);
    expect(await log(t, 'offer/broadcast')).toMatchObject({
      status: 'failed',
      response: { sent: 0, failed: 1 },
      error: 'no route',
    });
  });
});

describe('win-back (WD-ECOM-015)', () => {
  const order = (
    t: Tenant,
    id: string,
    phone: string,
    minor: number,
    daysAgo: number,
    source = 'shopify',
  ) =>
    h.owner.query(
      `INSERT INTO wa_orders (org_id, shopify_order_id, source, customer_phone, total_minor, currency_code, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'USD', 'paid', now() - make_interval(days => $6))`,
      [t.orgId, id, source, phone, minor, daysAgo],
    );

  it('picks lapsed customers by recency, order count and spend, skips opted-out numbers and other sources', async () => {
    const t = await api.signup('ebc5');
    const s = await setup(t);
    await order(t, 'a1', '15550200001', 5000, 90);
    await order(t, 'a2', '15550200001', 5000, 100);
    await order(t, 'b1', '15550200002', 500, 90);
    await order(t, 'c1', '15550200003', 9000, 5);
    await order(t, 'd1', '15550200004', 9000, 90);
    await order(t, 'w1', '15550200005', 9000, 90, 'woocommerce');
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, phone, is_unsubscribed) VALUES ($1, 'Out', '+1 555 020 0004', true)`,
      [t.orgId],
    );
    const res = await api
      .http()
      .post(`/v2/shopify/stores/${s.storeUuid}/winback`)
      .set(bearer(t.admin))
      .send({ templateUuid: s.templateUuid, days: 60, minOrders: 1, minSpent: 10 });
    expect(res.body).toEqual({ ok: true, total: 2, queued: true });
    const [job] = (await queued()).filter((j) => j.orgId === t.orgId);
    await svc.run(job!);
    expect(sent.map((m) => m.to)).toEqual(['15550200001']);
    expect(sent[0]!.params).toEqual(['there', 'Acme', '']);
    expect(await log(t, 'winback/broadcast')).toMatchObject({
      status: 'sent',
      recipient: '2 lapsed (>60d)',
      response: { sent: 1, failed: 0 },
    });
  });

  it('days 0 means any time; nothing matching answers ok:false', async () => {
    const t = await api.signup('ebc6');
    const s = await setup(t);
    await order(t, 'e1', '15550200006', 100, 1);
    const any = await api
      .http()
      .post(`/v2/shopify/stores/${s.storeUuid}/winback`)
      .set(bearer(t.admin))
      .send({ templateUuid: s.templateUuid, days: 0 });
    expect(any.body).toMatchObject({ ok: true, total: 1 });
    const none = await api
      .http()
      .post(`/v2/shopify/stores/${s.storeUuid}/winback`)
      .set(bearer(t.admin))
      .send({ templateUuid: s.templateUuid, days: 60 });
    expect(none.body).toEqual({ ok: false, message: 'No customers match this segment.' });
  });
});
