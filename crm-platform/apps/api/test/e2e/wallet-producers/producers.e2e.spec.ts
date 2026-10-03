import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, MESSAGE_DELIVERY_EVENT, walletDeliveryReportedSchema } from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { BroadcastProgressService } from '../../../src/modules/broadcasts/broadcast-progress.service';
import { BroadcastReceiptsService } from '../../../src/modules/broadcasts/broadcast-receipts.service';
import { CampaignCallbacksService } from '../../../src/modules/campaigns/campaign-callbacks.service';
import { CampaignEvents } from '../../../src/modules/campaigns/campaign-events';
import { CampaignReceiptsService } from '../../../src/modules/campaigns/campaign-receipts.service';
import { ReceiptsService } from '../../../src/modules/chat-conversations/receipts.service';
import { bearer } from '../contacts-attributes-tags/support';
import {
  fund,
  newTenant,
  setReseller,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from '../wallet-message-billing/support';

/**
 * The producers of `message.delivery_reported` (WD-WALLET-012) and the launch gate on broadcasts and campaigns (WD-WALLET-013),
 * against the real schema: every place that learns a provider status writes exactly one event on a real transition and none on a
 * repeat, a regression or a status the wallet ignores; an empty pay-per-message wallet refuses a launch and creates nothing.
 */
let h: BspHarness;
const svc = <T>(c: new (...a: never[]) => T) => h.app.get(c, { strict: false });

beforeAll(async () => {
  h = await startBspHarness();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let seq = 0;
const nextPhone = () =>
  `+9198${String(Date.now() % 100000).padStart(5, '0')}${String(seq++).padStart(3, '0')}`;

async function contact(t: Tenant): Promise<{ id: number; digits: string }> {
  const phone = nextPhone();
  const r = await h.owner.query(
    `INSERT INTO contacts (org_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
    [t.orgId, `C${seq}`, phone],
  );
  return { id: Number(r.rows[0].id), digits: phone.replace(/\D/g, '') };
}

async function template(t: Tenant, category = 'marketing', metaCategory: string | null = null) {
  const r = await h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, category, meta_category)
     VALUES ($1, $2, 'Hello', 'standard', 'approved', $3, $4) RETURNING id, uuid`,
    [t.orgId, `t${randomUUID().slice(0, 8)}`, category, metaCategory],
  );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

/** The wallet events a tenant has produced, oldest first, parsed through the contract. */
async function reported(orgId: number) {
  const r = await h.owner.query(
    `SELECT aggregate_module, payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
    [orgId, MESSAGE_DELIVERY_EVENT],
  );
  return r.rows.map((x) => ({
    module: x.aggregate_module as string,
    ...walletDeliveryReportedSchema.parse(x.payload),
  }));
}

const wamid = () => `wamid.prod.${randomUUID()}`;

// ------------------------------------------------------------------------------------------------------------ broadcasts

describe('broadcasts report delivery to the wallet', () => {
  async function broadcast(t: Tenant, provider: string, status: string, id: string | null) {
    const tpl = await template(t, 'utility', 'marketing');
    const c = await contact(t);
    const b = await h.owner.query(
      `INSERT INTO broadcasts (org_id, name, status, provider, template_id, total_recipients) VALUES ($1,'B','processing',$2,$3,1) RETURNING id`,
      [t.orgId, provider, tpl.id],
    );
    const bid = Number(b.rows[0].id);
    await h.owner.query(
      `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, whatsapp_message_id) VALUES ($1,$2,$3,$4,$5)`,
      [t.orgId, bid, c.id, status, id],
    );
    return { bid, c };
  }
  const receipt = (id: string, status: 'sent' | 'delivered' | 'read' | 'failed') => ({
    providerMessageId: id,
    status,
    occurredAt: new Date(),
  });

  it('a WABA receipt writes one event per real step and none for a repeat or a late older status', async () => {
    const t = await newTenant(h, 'bp1');
    const id = wamid();
    const { c } = await broadcast(t, 'waba', 'sent', id);
    const receipts = svc(BroadcastReceiptsService);

    await receipts.handle(receipt(id, 'delivered'));
    await receipts.handle(receipt(id, 'delivered'));
    expect(await reported(t.orgId)).toEqual([
      {
        module: 'broadcasts',
        provider: 'waba',
        providerMessageId: id,
        status: 'delivered',
        recipient: c.digits,
        category: 'marketing', // Meta's pricing category wins over the template's own
        source: 'broadcast',
      },
    ]);

    await receipts.handle(receipt(id, 'read'));
    await receipts.handle(receipt(id, 'delivered')); // late: the state machine refuses it
    expect((await reported(t.orgId)).map((e) => e.status)).toEqual(['delivered', 'read']);
  });

  it('a failure after the send is reported once; a failure before any provider id is not (nothing was charged)', async () => {
    const t = await newTenant(h, 'bp2');
    const id = wamid();
    await broadcast(t, 'twilio', 'sent', id);
    const receipts = svc(BroadcastReceiptsService);
    await receipts.handle({ ...receipt(id, 'failed'), errorMessage: 'undeliverable' });
    await receipts.handle({ ...receipt(id, 'failed'), errorMessage: 'undeliverable' });
    expect(await reported(t.orgId)).toMatchObject([{ provider: 'twilio', status: 'failed' }]);

    // The dispatcher's own failure: the row never got an id.
    const t2 = await newTenant(h, 'bp2b');
    const { bid, c } = await broadcast(t2, 'waba', 'processing', null);
    await svc(DatabaseService).txAs({ orgId: t2.orgId }, (tx) =>
      svc(BroadcastProgressService).applyRecipient(tx, t2.orgId, bid, c.id, {
        status: 'failed',
        error: 'No usable phone number',
      }),
    );
    expect(await reported(t2.orgId)).toEqual([]);
  });

  it('the unofficial engine is charged on its send: `sent` reports once, a repeat does not; a Cloud engine `sent` reports nothing', async () => {
    const t = await newTenant(h, 'bp3');
    const { bid, c } = await broadcast(t, 'baileys', 'processing', null);
    const progress = svc(BroadcastProgressService);
    const db = svc(DatabaseService);
    const send = (id: string) =>
      db.txAs({ orgId: t.orgId }, (tx) =>
        progress.applyRecipient(tx, t.orgId, bid, c.id, { status: 'sent', providerMessageId: id }),
      );
    const id = wamid();
    await send(id);
    await send(id);
    expect(await reported(t.orgId)).toMatchObject([
      { provider: 'baileys', providerMessageId: id, status: 'sent', source: 'broadcast' },
    ]);

    const t2 = await newTenant(h, 'bp3b');
    const w = await broadcast(t2, 'waba', 'processing', null);
    await db.txAs({ orgId: t2.orgId }, (tx) =>
      progress.applyRecipient(tx, t2.orgId, w.bid, w.c.id, {
        status: 'sent',
        providerMessageId: wamid(),
      }),
    );
    expect(await reported(t2.orgId)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------------------- campaigns

describe('campaigns report delivery to the wallet', () => {
  async function campaign(t: Tenant, provider: string, status: string, id: string | null) {
    const tpl = await template(t, 'marketing');
    const c = await contact(t);
    const w = await h.owner.query(
      `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, provider, template_id) VALUES ($1,'K','template','running',$2,$3) RETURNING id, uuid`,
      [t.orgId, provider, tpl.id],
    );
    await h.owner.query(
      `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, whatsapp_message_id) VALUES ($1,$2,$3,$4,$5)`,
      [t.orgId, w.rows[0].id, c.id, status, id],
    );
    return { id: Number(w.rows[0].id), uuid: w.rows[0].uuid as string, c };
  }
  const receipt = (id: string, status: 'sent' | 'delivered' | 'read' | 'failed') => ({
    providerMessageId: id,
    status,
    occurredAt: new Date(),
  });

  it('a receipt reports one event per real step, with the campaign source, none on a repeat, and no failure over a delivery', async () => {
    const t = await newTenant(h, 'cp1');
    const id = wamid();
    const { c } = await campaign(t, 'waba', 'sent', id);
    const receipts = svc(CampaignReceiptsService);
    await receipts.handle(receipt(id, 'delivered'));
    await receipts.handle(receipt(id, 'delivered'));
    await receipts.handle(receipt(id, 'read'));
    await receipts.handle(receipt(id, 'delivered')); // older than read
    await receipts.handle(receipt(id, 'failed')); // the campaign moves, but the provider confirmed delivery: no refund event
    const events = await reported(t.orgId);
    expect(events.map((e) => e.status)).toEqual(['delivered', 'read']);
    expect(events[0]).toEqual({
      module: 'campaigns',
      provider: 'waba',
      providerMessageId: id,
      status: 'delivered',
      recipient: c.digits,
      category: 'marketing',
      source: 'campaign',
    });
  });

  it('a failed receipt after a send is reported once', async () => {
    const t = await newTenant(h, 'cp2');
    const id = wamid();
    await campaign(t, 'twilio', 'sent', id);
    const receipts = svc(CampaignReceiptsService);
    await receipts.handle({ ...receipt(id, 'failed'), errorMessage: 'nope' });
    await receipts.handle({ ...receipt(id, 'failed'), errorMessage: 'nope' });
    expect(await reported(t.orgId)).toMatchObject([{ provider: 'twilio', status: 'failed' }]);
  });

  it('the Node bridge reports an unofficial send once; a repeat or an older report writes nothing', async () => {
    const t = await newTenant(h, 'cp3');
    const k = await campaign(t, 'baileys', 'pending', null);
    const [contactUuid] = (
      await h.owner.query(`SELECT uuid FROM contacts WHERE org_id = $1`, [t.orgId])
    ).rows.map((r) => r.uuid as string);
    const callbacks = svc(CampaignCallbacksService);
    const id = wamid();
    const report = (status: 'sent' | 'delivered' | 'read', providerMessageId?: string) =>
      callbacks.contactStatus({
        campaignId: k.uuid,
        contactId: contactUuid!,
        status,
        providerMessageId,
      });
    await report('sent', id);
    await report('sent', id);
    await report('delivered'); // the id is already on the row
    await report('sent'); // regression
    expect(
      (await reported(t.orgId)).map((e) => [e.provider, e.status, e.providerMessageId]),
    ).toEqual([
      ['baileys', 'sent', id],
      ['baileys', 'delivered', id],
    ]);
  });

  it('the inline send reports only for the engine that cannot report delivery', async () => {
    const t = await newTenant(h, 'cp4');
    const events = svc(CampaignEvents);
    const db = svc(DatabaseService);
    const a = await campaign(t, 'baileys', 'pending', null);
    const b = await campaign(t, 'waba', 'pending', null);
    await db.txAs({ orgId: t.orgId }, async (tx) => {
      await events.deliveryReported(
        tx,
        t.orgId,
        a.id,
        a.c.id,
        'pending',
        'sent',
        wamid(),
        'baileys',
      );
      await events.deliveryReported(tx, t.orgId, b.id, b.c.id, 'pending', 'sent', wamid(), 'waba');
      await events.deliveryReported(tx, t.orgId, a.id, a.c.id, 'pending', 'sent', null, 'baileys');
    });
    expect(await reported(t.orgId)).toMatchObject([{ provider: 'baileys', status: 'sent' }]);
  });
});

// ------------------------------------------------------------------------------------------------------------ conversations

describe('conversation receipts report delivery to the wallet', () => {
  async function thread(t: Tenant, kind: string, senderKind: string, templateId: number | null) {
    const ch = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name, status) VALUES ($1,$2,'WA','connected') RETURNING id, uuid`,
      [t.orgId, kind],
    );
    const peer = nextPhone().replace(/\D/g, '');
    const cv = await h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title, msg_seq) VALUES ($1,$2,$3,'T',1) RETURNING id`,
      [t.orgId, ch.rows[0].id, peer],
    );
    const id = wamid();
    const m = await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, provider_message_id, template_id, created_at)
       VALUES ($1,$2,1,'out','text',$3,'sent',$4,$5, date_trunc('milliseconds', now())) RETURNING id, created_at`,
      [t.orgId, cv.rows[0].id, senderKind, id, templateId],
    );
    await h.owner.query(
      `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id)
       VALUES ($1,$2,'provider_id',$3,$4,$5,$6)`,
      [t.orgId, ch.rows[0].id, id, m.rows[0].id, m.rows[0].created_at, cv.rows[0].id],
    );
    return { channelUuid: ch.rows[0].uuid as string, id, peer };
  }
  const job = (
    orgId: number,
    channelUuid: string,
    providerMessageId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
  ) => ({
    orgId,
    channelUuid,
    receipt: { providerMessageId, status, at: new Date().toISOString() },
  });

  it('a WhatsApp Cloud receipt that moves the message reports once, as an inbox send; a late or repeated one reports nothing', async () => {
    const t = await newTenant(h, 'ch1');
    const tpl = await template(t, 'utility');
    const th = await thread(t, 'whatsapp_cloud', 'agent', tpl.id);
    const receipts = svc(ReceiptsService);

    expect(await receipts.apply(job(t.orgId, th.channelUuid, th.id, 'delivered'))).toBe('applied');
    expect(await receipts.apply(job(t.orgId, th.channelUuid, th.id, 'delivered'))).toBe('ignored');
    expect(await receipts.apply(job(t.orgId, th.channelUuid, th.id, 'read'))).toBe('applied');
    expect(await receipts.apply(job(t.orgId, th.channelUuid, th.id, 'sent'))).toBe('ignored');
    expect(await reported(t.orgId)).toEqual([
      {
        module: 'conversations',
        provider: 'waba',
        providerMessageId: th.id,
        status: 'delivered',
        recipient: th.peer,
        category: 'utility',
        source: 'inbox',
      },
      expect.objectContaining({ status: 'read', source: 'inbox' }),
    ]);
  });

  it('a failure over a sent message is reported; nothing is reported for a channel that is not billed per message', async () => {
    const t = await newTenant(h, 'ch2');
    const a = await thread(t, 'whatsapp_cloud', 'bot', null);
    await svc(ReceiptsService).apply(job(t.orgId, a.channelUuid, a.id, 'failed'));
    expect(await reported(t.orgId)).toMatchObject([
      { provider: 'waba', status: 'failed', source: 'auto_reply', category: null },
    ]);

    const t2 = await newTenant(h, 'ch2b');
    const w = await thread(t2, 'webchat', 'agent', null);
    await svc(ReceiptsService).apply(job(t2.orgId, w.channelUuid, w.id, 'delivered'));
    expect(await reported(t2.orgId)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------------------ launch gate

describe('the launch gate on broadcasts and campaigns (WD-WALLET-013)', () => {
  /** A workspace that pays per message (the reseller flag), so the wallet is the only thing that can cover a send. */
  const payg = async (label: string) => {
    const t = await newTenant(h, label);
    await setReseller(h, t.orgId, true);
    return t;
  };
  const count = async (sql: string, orgId: number) =>
    Number((await h.owner.query(sql, [orgId])).rows[0].n);
  const broadcastBody = async (t: Tenant) => {
    const tpl = await template(t);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const c = await contact(t);
      ids.push(
        (await h.owner.query(`SELECT uuid FROM contacts WHERE id = $1`, [c.id])).rows[0].uuid,
      );
    }
    return {
      name: 'Gate',
      templateId: tpl.uuid,
      contactIds: ids,
      scheduleType: 'now',
    };
  };
  const postBroadcast = (t: Tenant, body: object) =>
    h.api
      .http()
      .post('/v2/broadcasts')
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID())
      .send(body);
  const postCampaign = (t: Tenant, body: object) =>
    h.api
      .http()
      .post('/v2/campaigns')
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID())
      .send(body);
  const campaignBody = async (t: Tenant) => {
    const body = await broadcastBody(t);
    return {
      name: 'Gate',
      type: 'text',
      customMessage: 'Hello there',
      scheduleType: 'now',
      contactIds: body.contactIds,
    };
  };

  it('an empty pay-per-message wallet refuses a broadcast with WALLET_EMPTY and creates no rows', async () => {
    const t = await payg('g1'); // pay per message, no money
    const res = await postBroadcast(t, await broadcastBody(t));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code ?? res.body.error?.code).toBe(ERROR_CODES.WALLET_EMPTY);
    expect(
      await count(`SELECT count(*)::int AS n FROM broadcasts WHERE org_id = $1`, t.orgId),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM broadcast_contacts WHERE org_id = $1`, t.orgId),
    ).toBe(0);
  });

  it('an empty pay-per-message wallet refuses a campaign with WALLET_EMPTY and creates no rows', async () => {
    const t = await payg('g2');
    const res = await postCampaign(t, await campaignBody(t));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code ?? res.body.error?.code).toBe(ERROR_CODES.WALLET_EMPTY);
    expect(
      await count(`SELECT count(*)::int AS n FROM wpcampaigns WHERE org_id = $1`, t.orgId),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE org_id = $1`, t.orgId),
    ).toBe(0);
  });

  it('a funded wallet launches a broadcast and a campaign', async () => {
    const t = await payg('g3');
    await fund(h, t.orgId, 1_000_000);
    const bc = await postBroadcast(t, await broadcastBody(t));
    expect(bc.status, JSON.stringify(bc.body)).toBe(201);
    const cp = await postCampaign(t, await campaignBody(t));
    expect(cp.status, JSON.stringify(cp.body)).toBe(201);
    expect(cp.body.campaign.status).toBe('running');
  });

  it('a draft campaign launches nothing, so an empty wallet does not refuse it', async () => {
    const t = await payg('g4');
    const res = await postCampaign(t, { ...(await campaignBody(t)), status: 'draft' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('a plan-quota workspace inside its free monthly messages launches with an empty wallet', async () => {
    const t = await newTenant(h, 'g5');
    await setReseller(h, t.orgId, false);
    const res = await postBroadcast(t, await broadcastBody(t));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
