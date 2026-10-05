import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dashWidgetsSchema } from '@crm/contracts';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The cards that read other domains' tables: Instagram band (TW-DASH-008), Flow Copilot and flow list (TW-DASH-017) and integration
 * status (TW-DASH-020). Rows are arranged with the owner connection; everything asserted goes through the API.
 */
let h: Harness;
let api: Api;
let t: Tenant;
let other: Tenant;
let bare: Tenant;
const get = async (tok: string) => {
  const res = await api.as(tok).get('/v2/dashboard/widgets?range=7d');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return dashWidgetsSchema.parse(res.body);
};
const q = (text: string, p: unknown[]) => h.owner.query(text, p);

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('dext');
  other = await api.signup('dext2');
  bare = await api.signup('dext3');

  // Instagram: two accounts (one needs attention), 3 conversations awaiting reply, 10 DMs in and 15 out in 7 days, one old DM
  await q(
    `INSERT INTO workspace_ig_accounts (org_id, instaflow_account_id, username, name, status, followers)
     VALUES ($1, 'ig1', 'shop', 'Shop', 'connected', 1200), ($1, 'ig2', 'second', 'Second', 'error', 300)`,
    [t.orgId],
  );
  const ig = await q(
    `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'instagram', 'ig') RETURNING id`,
    [t.orgId],
  );
  const sim = await q(
    `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
    [t.orgId],
  );
  const convs: number[] = [];
  for (const [i, unread, inbound, outbound, archived] of [
    [1, 2, '1 hour', null, false],
    [2, 0, '2 hours', '3 hours', false], // newest inbound is later than the reply: needs reply
    [3, 0, '1 hour', '30 minutes', false], // answered after the inbound: fine
    [4, 1, '1 hour', null, false], // unread and unanswered: needs reply
    [5, 5, '1 hour', null, true], // archived: neither open nor waiting
  ] as const) {
    const c = await q(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title, unread_count, archived, last_inbound_at, last_outbound_at)
       VALUES ($1, $2, $3, $3, $4, $5, now() - $6::interval, CASE WHEN $7::text IS NULL THEN NULL ELSE now() - $7::interval END) RETURNING id`,
      [t.orgId, ig.rows[0].id, `ig-${i}`, unread, archived, inbound, outbound],
    );
    convs.push(Number(c.rows[0].id));
  }
  // conversation 3 is answered (last outbound after inbound) but conversation 2 is not: needs reply = convs 1, 2, 4
  await q(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind, created_at)
     SELECT $1, $2, g, CASE WHEN g <= 10 THEN 'in' ELSE 'out' END, CASE WHEN g <= 10 THEN 'customer' ELSE 'agent' END, CASE WHEN g <= 10 THEN 'received' ELSE 'sent' END, 'text', now() - interval '1 day'
     FROM generate_series(1, 25) g`,
    [t.orgId, convs[0]],
  );
  await q(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind, created_at)
     VALUES ($1, $2, 100, 'in', 'customer', 'received', 'text', now() - interval '20 days')`,
    [t.orgId, convs[0]],
  );
  // a simulator chat never counts as an Instagram DM
  const sc = await q(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, unread_count) VALUES ($1, $2, 'sim-1', 'sim', 3) RETURNING id`,
    [t.orgId, sim.rows[0].id],
  );
  await q(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind) VALUES ($1, $2, 1, 'in', 'customer', 'received', 'text')`,
    [t.orgId, sc.rows[0].id],
  );
  await q(
    `INSERT INTO workspace_ig_accounts (org_id, instaflow_account_id, username, status, followers) VALUES ($1, 'x', 'foreign', 'connected', 99)`,
    [other.orgId],
  );

  // flows: 8 flows (3 inactive), 2 subscribers on the newest, 1 on another; the newest has 3 nodes
  for (let i = 1; i <= 8; i++) {
    await q(
      `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, is_active, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, now() - ($6 || ' hours')::interval)`,
      [
        t.orgId,
        i === 2 ? '' : `flow ${i}`,
        JSON.stringify(i === 1 ? { flowNodes: [{}, {}, {}] } : {}),
        i === 1 ? 'webhook' : 'keyword',
        i <= 3,
        i,
      ],
    );
  }
  const f1 = await q(`SELECT id FROM flows WHERE org_id = $1 AND flow_name = 'flow 1'`, [t.orgId]);
  const f3 = await q(`SELECT id FROM flows WHERE org_id = $1 AND flow_name = 'flow 3'`, [t.orgId]);
  for (const [flow, who] of [
    [f1.rows[0].id, 'a'],
    [f1.rows[0].id, 'b'],
    [f3.rows[0].id, 'c'],
  ] as const) {
    const c = await q(`INSERT INTO contacts (org_id, name) VALUES ($1, $2) RETURNING id`, [
      t.orgId,
      who,
    ]);
    await q(
      `INSERT INTO flow_subscribers (org_id, flow_id, contact_id, status) VALUES ($1, $2, $3, 'active')`,
      [t.orgId, flow, c.rows[0].id],
    );
  }

  // integrations: Shopify and WooCommerce connected in `t`, only a Meta catalog in `other`
  await q(
    `INSERT INTO shopify_integrations (org_id, store_url, access_token, webhook_secret, status) VALUES ($1, 'a.myshopify.com', 'x', 'x', 'active')`,
    [t.orgId],
  );
  const woo = await q(
    `INSERT INTO woocommerce_integrations (org_id, store_url, consumer_key, consumer_secret, webhook_secret, status) VALUES ($1, 'https://w.example', 'k', 's', 'w', 'active') RETURNING id`,
    [t.orgId],
  );
  await q(
    `INSERT INTO woocommerce_integration_logs (org_id, integration_id, event_type) VALUES ($1, $2, 'order.created'), ($1, $2, 'order.paid')`,
    [t.orgId, woo.rows[0].id],
  );
  await q(
    `INSERT INTO woocommerce_integration_logs (org_id, integration_id, event_type, created_at) VALUES ($1, $2, 'order.old', now() - interval '30 days')`,
    [t.orgId, woo.rows[0].id],
  );
  await q(
    `INSERT INTO wa_catalogs (org_id, provider, catalog_id) VALUES ($1, 'meta_cloud', 'cat1')`,
    [other.orgId],
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('TW-DASH-008 Instagram band', () => {
  it('hides the band when no account is linked', async () => {
    expect((await get(bare.admin)).instagram).toBeNull();
  });

  it('shows the accounts, followers, need-reply and the fixed 7-day DM counts (reply rate caps at 100)', async () => {
    const ig = (await get(t.admin)).instagram!;
    expect(ig.accountsCount).toBe(2);
    expect(ig.accounts.map((a) => a.handle)).toEqual(['@shop', '@second']); // followers desc
    expect(ig.accounts[1]!.status).toBe('error');
    expect(ig.followers).toBe(1500);
    expect(ig.open).toBe(4); // archived chat is not open
    expect(ig.needsReply).toBe(3);
    expect(ig.unread).toBe(3);
    expect(ig.dmsIn7d).toBe(10); // the 20-day-old DM is outside the window; the simulator DM is another channel
    expect(ig.dmsOut7d).toBe(15);
    expect(ig.replyRatePct).toBe(100);
  });

  it('is scoped to the workspace', async () => {
    const ig = (await get(other.admin)).instagram!;
    expect(ig).toMatchObject({
      accountsCount: 1,
      followers: 99,
      open: 0,
      dmsIn7d: 0,
      replyRatePct: 0,
    });
  });
});

describe('TW-DASH-017 flow counters and list', () => {
  it('counts flows, active flows and lifetime subscribers; lists the six latest with steps and subscribers', async () => {
    const f = (await get(t.admin)).flows;
    expect(f).toMatchObject({ total: 8, active: 3, subscribers: 3 });
    expect(f.recent).toHaveLength(6);
    expect(f.recent[0]).toMatchObject({
      name: 'flow 1',
      trigger: 'webhook',
      steps: 3,
      subscribers: 2,
      active: true,
    });
    expect(f.recent[1]!.name).toBe('Untitled flow');
    expect(f.recent[1]!.steps).toBe(0);
  });

  it('an empty workspace reads zero with no rows', async () => {
    expect((await get(bare.admin)).flows).toEqual({
      total: 0,
      active: 0,
      subscribers: 0,
      recent: [],
    });
  });
});

describe('TW-DASH-020 integrations status', () => {
  it('reads this workspace: Shopify connected, WooCommerce with its 7-day events', async () => {
    const i = (await get(t.admin)).integrations;
    expect(i.rows).toEqual([
      { code: 'woocommerce', connected: true, events7d: 2 },
      { code: 'shopify', connected: true, events7d: null },
      { code: 'google_sheets', connected: false, events7d: null },
      { code: 'meta_catalog', connected: false, events7d: null },
    ]);
    expect(i.connected).toBe(3); // + the Instagram account
    expect(i.total).toBe(10);
  });

  it('another tenant firing events never marks this one connected', async () => {
    const i = (await get(bare.admin)).integrations;
    expect(i.connected).toBe(0);
    expect(i.rows.every((r) => !r.connected)).toBe(true);
    const o = (await get(other.admin)).integrations;
    expect(o.rows.find((r) => r.code === 'meta_catalog')!.connected).toBe(true);
    expect(o.rows.find((r) => r.code === 'shopify')!.connected).toBe(false);
  });
});
