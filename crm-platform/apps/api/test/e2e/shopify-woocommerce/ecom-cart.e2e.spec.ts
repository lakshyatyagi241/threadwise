import { randomBytes } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUES } from '../../../src/infra/queue/queues';
import {
  COMMERCE_SENDER,
  type CommerceSender,
} from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import { bodyParams } from '../../../src/modules/shopify-woocommerce/event-rules';
import {
  CartService,
  type CartStepJob,
} from '../../../src/modules/shopify-woocommerce/cart.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** Abandoned-cart recovery: schedule the follow-up steps, cancel them on an order, send when due (TW-ECOM-019). */
let h: Harness;
let api: Api;
let cart: CartService;
let queue: Queue<CartStepJob>;
let canSend = true;
const sent: Array<{ to: string; params: string[] }> = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  cart = h.app.get(CartService);
  queue = h.app.get<Queue<CartStepJob>>(getQueueToken(QUEUES.ECOM_WEBHOOK), {
    strict: false,
  });
  const sender = h.app.get<CommerceSender>(COMMERCE_SENDER);
  sender.canSend = () => Promise.resolve(canSend);
  sender.send = (_o, m) => {
    sent.push({ to: m.to, params: bodyParams(m.template.body, m.ctx.positional) });
    return Promise.resolve({ providerMessageId: 'w1' });
  };
}, 240_000);

afterAll(async () => {
  await queue?.drain(true);
  await h?.stop();
});

beforeEach(() => {
  sent.length = 0;
  canSend = true;
});

async function store(t: Tenant, steps: Array<{ type: string; delay?: number }>): Promise<number> {
  const secret = randomBytes(20).toString('hex');
  const r = await h.owner.query(
    `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
     VALUES ($1, $2, $3, 'Shop', 'USD', 'x', $4) RETURNING id`,
    [t.orgId, t.adminUserId, `${secret.slice(0, 6)}.myshopify.com`, secret],
  );
  const id = Number(r.rows[0].id);
  for (const s of steps) {
    const tpl = await h.owner.query(
      `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel)
       VALUES ($1, $2, $3, 'Hi {{1}}, finish {{2}}', 'en_US', 'whatsapp') RETURNING id`,
      [t.orgId, t.adminUserId, `tpl_${randomBytes(4).toString('hex')}`],
    );
    await h.owner.query(
      `INSERT INTO shopify_integration_events (org_id, integration_id, event_type, is_active, template_id, delay_seconds) VALUES ($1, $2, $3, true, $4, $5)`,
      [t.orgId, id, s.type, Number(tpl.rows[0].id), s.delay ?? 0],
    );
  }
  return id;
}

const checkout = (phone = '+1 555 010 4444') => ({
  id: 9001,
  token: `tok-${randomBytes(4).toString('hex')}`,
  email: 'a@x.test',
  abandoned_checkout_url: 'https://shop/checkout/abc',
  customer: { first_name: 'Ada', last_name: 'L', phone },
});

const recoveries = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT status, customer_phone, scheduled_ids, checkout_token FROM shopify_cart_recoveries WHERE org_id = $1 ORDER BY id`,
      [t.orgId],
    )
  ).rows;

describe('scheduling the follow-ups', () => {
  it('queues each active step with at least a minute of delay (an hour when none is set) and opens one recovery', async () => {
    const t = await api.signup('ecart1');
    const s = await store(t, [{ type: 'cart/step2' }, { type: 'cart/step3', delay: 10 }]);
    const data = checkout();
    await cart.schedule(t.orgId, 'shopify', s, data);
    const rows = await recoveries(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'active', customer_phone: '15550104444' });
    expect(rows[0].checkout_token).not.toContain(data.token);
    const ids = rows[0].scheduled_ids as string[];
    expect(ids).toHaveLength(2);
    const [two, three] = await Promise.all(ids.map((id) => queue.getJob(id)));
    expect(two!.opts.delay).toBe(3_600_000);
    expect(three!.opts.delay).toBe(60_000);
  });

  it('schedules nothing without a phone, without active steps, or without a connected number', async () => {
    const t = await api.signup('ecart2');
    const s = await store(t, [{ type: 'cart/step2' }]);
    await cart.schedule(t.orgId, 'shopify', s, { ...checkout(), customer: { first_name: 'No' } });
    canSend = false;
    await cart.schedule(t.orgId, 'shopify', s, checkout());
    const bare = await store(t, []);
    canSend = true;
    await cart.schedule(t.orgId, 'shopify', bare, checkout());
    expect(await recoveries(t)).toHaveLength(0);
  });
});

describe('cancelling and sending', () => {
  it('an order for the number removes the pending steps and closes the recovery', async () => {
    const t = await api.signup('ecart3');
    const s = await store(t, [{ type: 'cart/step2' }]);
    await cart.schedule(t.orgId, 'shopify', s, checkout());
    const [row] = await recoveries(t);
    await cart.cancelOnOrder(t.orgId, 'shopify', { customer: { phone: '15550104444' } });
    expect((await recoveries(t))[0]!.status).toBe('recovered');
    expect(await queue.getJob((row.scheduled_ids as string[])[0]!)).toBeUndefined();
  });

  it("another number's order leaves the recovery alone", async () => {
    const t = await api.signup('ecart4');
    const s = await store(t, [{ type: 'cart/step2' }]);
    await cart.schedule(t.orgId, 'shopify', s, checkout());
    await cart.cancelOnOrder(t.orgId, 'shopify', { customer: { phone: '15559998888' } });
    expect((await recoveries(t))[0]!.status).toBe('active');
  });

  it("a due step sends the template with the checkout's values and logs it; a closed recovery sends nothing", async () => {
    const t = await api.signup('ecart5');
    const s = await store(t, [{ type: 'cart/step2' }]);
    const data = checkout();
    await cart.schedule(t.orgId, 'shopify', s, data);
    const recoveryId = Number(
      (await h.owner.query(`SELECT id FROM shopify_cart_recoveries WHERE org_id = $1`, [t.orgId]))
        .rows[0].id,
    );
    const job: CartStepJob = {
      orgId: t.orgId,
      kind: 'shopify',
      storeId: s,
      eventType: 'cart/step2',
      recoveryId,
      data,
    };
    await cart.runStep(job);
    expect(sent).toEqual([{ to: '15550104444', params: ['Ada L', '#9001'] }]);
    expect(
      (
        await h.owner.query(
          `SELECT status, recipient FROM shopify_integration_logs WHERE org_id = $1 AND event_type = 'cart/step2'`,
          [t.orgId],
        )
      ).rows,
    ).toEqual([{ status: 'sent', recipient: '15550104444' }]);
    await cart.cancelOnOrder(t.orgId, 'shopify', data);
    sent.length = 0;
    await cart.runStep(job);
    expect(sent).toHaveLength(0);
  });
});
