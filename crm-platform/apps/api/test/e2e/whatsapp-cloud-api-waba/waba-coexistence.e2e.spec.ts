import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  messagesOf,
  startPipeline,
  until,
  type Pipeline,
} from '../chat-conversations/pipeline-support';

/**
 * What the WhatsApp Business app mirrors into the workspace (coexistence) and what Meta sends beyond plain messages, through the real
 * WABA ingest and the inbox's own sink and queue: a real Postgres and Redis, real BullMQ workers.
 */
let p: Pipeline;
let seq = 0;
// Loaded after the application has started: the modules import each other and a static import here would close the cycle in the wrong order.
let ingest: { process: (changes: unknown[]) => Promise<unknown> };
let split: (payload: unknown) => unknown[];
let links: {
  ensure: (
    orgId: number,
    configId: number,
    o: { create: boolean },
  ) => Promise<{ id: number } | null>;
};

beforeAll(async () => {
  p = await startPipeline();
  const { WabaIngestService } =
    await import('../../../src/modules/whatsapp-cloud-api-waba/waba-ingest.service');
  const { splitWebhook } = await import('../../../src/modules/whatsapp-cloud-api-waba/waba-rules');
  const { WabaChannelLinkService } =
    await import('../../../src/modules/chat-conversations/waba-channel-link.service');
  ingest = p.h.app.get(WabaIngestService) as never;
  split = splitWebhook as never;
  links = p.h.app.get(WabaChannelLinkService, { strict: false }) as never;
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

async function arrange(label: string) {
  const t = await p.api.signup(label);
  const n = seq++;
  const phoneNumberId = `7100${n}00`;
  const wabaId = `88${phoneNumberId}`;
  const row = await p.h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, meta_json, connected_at)
     VALUES ($1, 'waba', 'connected', $2, 'Support line', $3::jsonb, now()) RETURNING id`,
    [
      t.orgId,
      `+9191133${String(10000 + n)}`,
      JSON.stringify({ provider: 'meta', waba_id: wabaId, phone_number_id: phoneNumberId }),
    ],
  );
  const number = { configId: Number(row.rows[0].id), phoneNumberId, wabaId };
  const channel = await links.ensure(t.orgId, number.configId, { create: true });
  if (!channel) throw new Error('no inbox channel was made for the number');
  return { t, number, channel };
}

const conversation = (x: Awaited<ReturnType<typeof arrange>>, peer: string) =>
  until(`the thread of ${peer}`, async () => {
    const r = await p.h.owner.query(
      `SELECT * FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
      [x.t.orgId, x.channel.id, peer],
    );
    return r.rows[0] as Record<string, unknown> | undefined;
  });

const feed = (
  x: Awaited<ReturnType<typeof arrange>>,
  field: string,
  value: Record<string, unknown>,
) =>
  ingest.process(
    split({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: x.number.wabaId,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field,
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: x.number.phoneNumberId },
                ...value,
              },
            },
          ],
        },
      ],
    }),
  );

describe('coexistence echoes (TW-WABA-044)', () => {
  const echo = (x: Awaited<ReturnType<typeof arrange>>, message: Record<string, unknown>) =>
    feed(x, 'smb_message_echoes', {
      message_echoes: [
        { from: '919112210000', timestamp: String(Math.floor(Date.now() / 1000)), ...message },
      ],
    });

  it('a message typed on the Business app is one outbound bubble with no unread, even if delivered twice', async () => {
    const x = await arrange('co1');
    const body = {
      to: '919800000030',
      id: 'wamid.echo.1',
      type: 'text',
      text: { body: 'typed on the phone' },
    };
    await echo(x, body);
    await echo(x, body);
    const conv = await conversation(x, '919800000030');
    const rows = await until('the echo', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length ? m : undefined;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(await messagesOf(p, conv.id as number)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'out', body: 'typed on the phone' });
    expect(Number(conv.unread_count ?? 0)).toBe(0);
  });

  it('describes a file typed from the app and skips an echo with no customer number', async () => {
    const x = await arrange('co2');
    await echo(x, {
      to: '919800000031',
      id: 'wamid.echo.2',
      type: 'image',
      image: { caption: 'look' },
    });
    await echo(x, { id: 'wamid.echo.3', type: 'text', text: { body: 'nobody' } });
    const conv = await conversation(x, '919800000031');
    const rows = await until('the echo', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length ? m : undefined;
    });
    expect(rows[0]).toMatchObject({ direction: 'out', body: '[Photo] look' });
    const all = await p.h.owner.query(`SELECT 1 FROM conversations WHERE org_id = $1`, [x.t.orgId]);
    expect(all.rows).toHaveLength(1);
  });
});

describe('groups, hand-offs, orders and coexistence imports (TW-WABA-039, 040, 042, 043, 045, 046)', () => {
  const groupRow = async (orgId: number, groupId: string) =>
    (
      await p.h.owner.query(`SELECT * FROM waba_groups WHERE org_id = $1 AND group_id = $2`, [
        orgId,
        groupId,
      ])
    ).rows[0];
  const stamp = () => String(Math.floor(Date.now() / 1000));

  it('mirrors the group lifecycle: create, join, suspend, delete', async () => {
    const x = await arrange('gr1');
    await feed(x, 'group_lifecycle_update', {
      groups: [
        {
          group_id: 'G1',
          type: 'group_create',
          subject: 'Team',
          invite_link: 'https://chat.whatsapp.com/z',
          timestamp: 1_700_000_000,
        },
      ],
    });
    expect(await groupRow(x.t.orgId, 'G1')).toMatchObject({
      subject: 'Team',
      invite_link: 'https://chat.whatsapp.com/z',
    });
    await feed(x, 'group_participants_update', {
      groups: [
        {
          group_id: 'G1',
          type: 'group_participants_add',
          added_participants: [{ wa_id: '1' }, { wa_id: '2' }],
        },
      ],
    });
    expect((await groupRow(x.t.orgId, 'G1')).participant_count).toBe(2);
    await feed(x, 'group_status_update', {
      groups: [{ group_id: 'G1', type: 'group_suspend', timestamp: 7 }],
    });
    expect((await groupRow(x.t.orgId, 'G1')).suspended).toBe(true);
    await feed(x, 'group_lifecycle_update', { groups: [{ group_id: 'G1', type: 'group_delete' }] });
    expect(await groupRow(x.t.orgId, 'G1')).toBeUndefined();
  });

  it('stores a group message on the group thread with no contact, titled by the group, and folds participant statuses', async () => {
    const x = await arrange('gr2');
    await feed(x, 'group_lifecycle_update', {
      groups: [{ group_id: 'G2', type: 'group_create', subject: 'Neighbours' }],
    });
    await feed(x, 'messages', {
      contacts: [{ profile: { name: 'Asha' }, wa_id: '919800000040' }],
      messages: [
        {
          from: '919800000040',
          id: 'wamid.group.1',
          timestamp: stamp(),
          type: 'text',
          group_id: 'G2',
          text: { body: 'hello all' },
        },
      ],
    });
    const conv = await conversation(x, 'g:G2');
    expect(conv.title).toBe('Neighbours');
    expect(conv.contact_id).toBeNull();
    const rows = await until('the message', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length ? m : undefined;
    });
    expect(rows[0]).toMatchObject({ direction: 'in', body: 'hello all' });
    expect(rows[0]?.meta).toMatchObject({
      group: { participant: '919800000040', senderName: 'Asha' },
    });
    expect(
      (await p.h.owner.query(`SELECT 1 FROM contacts WHERE org_id = $1`, [x.t.orgId])).rows,
    ).toHaveLength(0);

    // A send into the group and its statuses: one bubble, one tally.
    await p.h.owner.query(
      `UPDATE messages SET direction = 'out', status = 'sent', provider_message_id = 'wamid.out.g' WHERE id = $1`,
      [rows[0]?.id],
    );
    await p.h.owner.query(
      `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id)
       SELECT $1, $2, 'provider_id', 'wamid.out.g', id, created_at, conversation_id FROM messages WHERE id = $3`,
      [x.t.orgId, x.channel.id, rows[0]?.id],
    );
    const status = (participant: string, st: string, pricing: Record<string, unknown>) => ({
      id: 'wamid.out.g',
      status: st,
      timestamp: stamp(),
      recipient_type: 'group',
      recipient_participant_id: participant,
      conversation: { origin: { type: 'service' }, pricing },
    });
    await feed(x, 'messages', {
      statuses: [
        status('a', 'delivered', { billable: true }),
        status('b', 'read', { type: 'free_group_customer_service' }),
        status('a', 'sent', { billable: true }),
      ],
    });
    const after = (await messagesOf(p, conv.id as number))[0];
    expect(after?.meta).toMatchObject({
      group_delivery: { delivered_to: 2, billable_count: 1, free_count: 1, category: 'service' },
    });
    expect(after?.status).toBe('read');
  });

  it('hands a form submission and a payment status to the outbox, not to the inbox', async () => {
    const x = await arrange('gr3');
    await feed(x, 'messages', {
      messages: [
        {
          from: '919800000041',
          id: 'wamid.form.1',
          timestamp: stamp(),
          type: 'interactive',
          interactive: {
            type: 'nfm_reply',
            nfm_reply: { response_json: JSON.stringify({ flow_token: 't1', city: 'Pune' }) },
          },
        },
      ],
      statuses: [
        {
          id: 'wamid.pay.1',
          type: 'payment',
          status: 'captured',
          timestamp: stamp(),
          recipient_id: '919800000041',
        },
      ],
    });
    const events = (
      await p.h.owner.query(
        `SELECT event_type, payload FROM event_outbox WHERE org_id = $1 AND event_type IN ('whatsapp.form.submitted','whatsapp.payment.updated')`,
        [x.t.orgId],
      )
    ).rows;
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.event_type === 'whatsapp.form.submitted')?.payload).toMatchObject({
      from: '919800000041',
      flowToken: 't1',
      response: { city: 'Pune' },
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(
      (await p.h.owner.query(`SELECT 1 FROM conversations WHERE org_id = $1`, [x.t.orgId])).rows,
    ).toHaveLength(0);
  });

  it('turns a catalog cart into one order with its lines, falls back for an unknown product, and never doubles on a retry', async () => {
    const x = await arrange('gr4');
    await p.h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, meta_retailer_id) VALUES ($1, 'Honey jar', 'honey', 'SKU-HONEY')`,
      [x.t.orgId],
    );
    const body = {
      contacts: [{ profile: { name: 'Asha' }, wa_id: '919800000045' }],
      messages: [
        {
          from: '919800000045',
          id: 'wamid.order.1',
          timestamp: stamp(),
          type: 'order',
          order: {
            catalog_id: 'CAT1',
            product_items: [
              { product_retailer_id: 'SKU-HONEY', quantity: 2, item_price: 10.99, currency: 'INR' },
              { product_retailer_id: 'GONE-1', quantity: 1, item_price: 5, currency: 'INR' },
            ],
          },
        },
      ],
    };
    await feed(x, 'messages', body);
    await feed(x, 'messages', body);
    const orders = (await p.h.owner.query(`SELECT * FROM wa_orders WHERE org_id = $1`, [x.t.orgId]))
      .rows;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      source: 'waba',
      customer_phone: '919800000045',
      customer_name: 'Asha',
      status: 'new',
    });
    expect(Number(orders[0].total_minor)).toBe(2698);
    const lines = (
      await p.h.owner.query(
        `SELECT name, retailer_id, product_id FROM wa_order_items WHERE order_id = $1 ORDER BY id`,
        [orders[0].id],
      )
    ).rows;
    expect(lines.map((l) => l.name)).toEqual(['Honey jar', 'GONE-1']);
    expect(lines[0].product_id).not.toBeNull();
    expect(lines[1].retailer_id).toBe('wsn-unknown-2');
    expect(
      (
        await p.h.owner.query(
          `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'whatsapp.order.received'`,
          [x.t.orgId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await p.h.owner.query(`SELECT 1 FROM conversations WHERE org_id = $1`, [x.t.orgId])).rows,
    ).toHaveLength(0);
  });

  it('imports history quietly: backdated, deduped, both sides, no unread, no contact', async () => {
    const x = await arrange('gr5');
    const own = (
      await p.h.owner.query(`SELECT phone_number FROM wa_provider_configs WHERE id = $1`, [
        x.number.configId,
      ])
    ).rows[0].phone_number.replace(/\D+/g, '');
    const old = Math.floor(Date.now() / 1000) - 90 * 86400;
    const value = {
      history: [
        {
          threads: [
            {
              id: '919800000042',
              messages: [
                {
                  id: 'wamid.h1',
                  from: '919800000042',
                  timestamp: String(old),
                  type: 'text',
                  text: { body: 'old question' },
                },
                {
                  id: 'wamid.h2',
                  from: own,
                  to: '919800000042',
                  timestamp: String(old + 60),
                  type: 'text',
                  text: { body: 'old answer' },
                },
              ],
            },
          ],
        },
      ],
    };
    await feed(x, 'history', value);
    await feed(x, 'history', value);
    const conv = await conversation(x, '919800000042');
    // Two queue jobs may finish in either order, so the thread is read in the order the messages were really sent.
    const inSendOrder = async () =>
      (await messagesOf(p, conv.id as number)).sort(
        (a, b) =>
          new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime(),
      );
    const rows = await until('two messages', async () => {
      const m = await inSendOrder();
      return m.length >= 2 ? m : undefined;
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(await messagesOf(p, conv.id as number)).toHaveLength(2);
    expect(rows.map((r) => r.body)).toEqual(['old question', 'old answer']);
    expect(rows.map((r) => r.direction)).toEqual(['in', 'out']);
    expect(Math.abs(new Date(rows[0]?.created_at as string).getTime() - old * 1000)).toBeLessThan(
      1000,
    );
    const fresh = (
      await p.h.owner.query(`SELECT unread_count, contact_id FROM conversations WHERE id = $1`, [
        conv.id,
      ])
    ).rows[0];
    expect(Number(fresh.unread_count)).toBe(0);
    expect(fresh.contact_id).toBeNull();
  });

  it('mirrors the phone address book without events and never applies a remove', async () => {
    const x = await arrange('gr6');
    await feed(x, 'smb_app_state_sync', {
      state_sync: [
        {
          type: 'contact',
          action: 'add',
          contact: { full_name: 'Ravi K', phone_number: '+919800000043' },
        },
        { type: 'contact', action: 'remove', contact: { phone_number: '+919800000044' } },
      ],
    });
    const synced = (
      await p.h.owner.query(
        `SELECT name, source FROM contacts WHERE org_id = $1 AND normalized_phone IN ('+919800000043','919800000043')`,
        [x.t.orgId],
      )
    ).rows[0];
    expect(synced).toMatchObject({ name: 'Ravi K', source: 'whatsapp_business_app' });
    expect(
      (
        await p.h.owner.query(
          `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'contact.created'`,
          [x.t.orgId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await p.h.owner.query(
          `SELECT 1 FROM contacts WHERE org_id = $1 AND normalized_phone IN ('+919800000044','919800000044')`,
          [x.t.orgId],
        )
      ).rows,
    ).toHaveLength(0);
  });
});
