import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * What the Node bridge and the providers tell us about a campaign (TW-CAMP-021, 022): the bridge token, a recipient's status,
 * status by message id with the forward-only rule, replies, opt-outs and the drain tick. Real app, real Postgres.
 */
let h: Harness;
let api: Api;
const TOKEN = 'bridge-secret-for-tests';

beforeAll(async () => {
  process.env.NODE_BRIDGE_TOKEN = TOKEN;
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
  delete process.env.NODE_BRIDGE_TOKEN;
});

let n = 0;
const phone = () => `+91940${String(n++).padStart(7, '0')}`;
const node = (path: string, body: object = {}, token: string | null = TOKEN) => {
  const r = api.http().post(`/v2/campaigns/node/${path}`);
  return (token === null ? r : r.set('x-node-token', token)).send(body);
};

/** A campaign with `statuses.length` recipients straight into the tables. */
async function campaign(t: Tenant, statuses: string[] = ['sent']) {
  const camp = (
    await h.owner.query(
      `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, total_recipients)
       VALUES ($1,'C','text','running',$2) RETURNING id, uuid`,
      [t.orgId, statuses.length],
    )
  ).rows[0];
  const uuids = await api.seedContacts(
    t,
    statuses.map((_, i) => ({ name: `P${n}-${i}`, phone: phone() })),
  );
  const ids: number[] = [];
  for (const [i, status] of statuses.entries()) {
    const id = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuids[i]])).rows[0].id,
    );
    ids.push(id);
    await h.owner.query(
      `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, whatsapp_message_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [t.orgId, camp.id, id, status, `wamid.${randomUUID().slice(0, 8)}`],
    );
  }
  return { id: Number(camp.id), uuid: camp.uuid as string, contactUuids: uuids, contactIds: ids };
}
const row = async (campaignId: number, contactId: number) =>
  (
    await h.owner.query(
      `SELECT status, whatsapp_message_id, sent_at, delivered_at, read_at, response, responded_at, is_unsubscribed, error_message
       FROM wp_campaign_contacts WHERE campaign_id = $1 AND contact_id = $2`,
      [campaignId, contactId],
    )
  ).rows[0];
const camp = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, sent_count, delivered_count, read_count, failed_count, responded_count FROM wpcampaigns WHERE id = $1`,
      [id],
    )
  ).rows[0];
const events = async (type: string) =>
  (
    await h.owner.query(
      `SELECT payload FROM event_outbox WHERE event_type = $1 ORDER BY id DESC LIMIT 5`,
      [type],
    )
  ).rows;

describe('the bridge token', () => {
  it('every call needs X-Node-Token equal to the configured one', async () => {
    const t = await api.signup('cb1');
    const c = await campaign(t);
    const body = { campaignId: c.uuid, status: 'completed' };
    expect((await node('update-status', body, null)).status).toBe(403);
    expect((await node('update-status', body, 'wrong')).status).toBe(403);
    expect((await node('update-status', body, `${TOKEN}x`)).status).toBe(403);
    expect((await node('update-status', body)).status).toBe(200);
    expect((await node('drain', {}, null)).status).toBe(403);
  });
});

describe('TW-CAMP-021: statuses', () => {
  it('the campaign status callback recounts from the rows and then takes the status reported', async () => {
    const t = await api.signup('cb2');
    const c = await campaign(t, ['delivered', 'read', 'failed', 'queued']);
    const res = await node('update-status', { campaignId: c.uuid, status: 'completed' });
    expect(res.body).toEqual({ ok: true });
    expect(await camp(c.id)).toMatchObject({
      status: 'completed',
      sent_count: 2,
      delivered_count: 2,
      read_count: 1,
      failed_count: 1,
    });
    expect((await node('update-status', { campaignId: randomUUID() })).status).toBe(404);
  });

  it('a recipient’s status is written as reported, with its times, and the counters follow', async () => {
    const t = await api.signup('cb3');
    const c = await campaign(t, ['queued', 'queued']);
    const res = await node('update-contact-status', {
      campaignId: c.uuid,
      contactId: c.contactUuids[0],
      status: 'delivered',
      providerMessageId: 'wamid.ABC',
      sentAt: '2026-10-05T09:00:00.000Z',
      deliveredAt: '2026-10-05T09:00:03.000Z',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = await row(c.id, c.contactIds[0]!);
    expect(r).toMatchObject({ status: 'delivered', whatsapp_message_id: 'wamid.ABC' });
    expect(new Date(r.sent_at).toISOString()).toBe('2026-10-05T09:00:00.000Z');
    expect(new Date(r.delivered_at).toISOString()).toBe('2026-10-05T09:00:03.000Z');
    expect(await camp(c.id)).toMatchObject({ sent_count: 1, delivered_count: 1 });
    expect((await events('campaign.contact_status_updated'))[0]!.payload).toMatchObject({
      status: 'delivered',
      providerMessageId: 'wamid.ABC',
    });

    const failed = await node('update-contact-status', {
      campaignId: c.uuid,
      contactId: c.contactUuids[1],
      status: 'failed',
      errorMessage: 'Number not on WhatsApp',
    });
    expect(failed.status).toBe(200);
    expect(await row(c.id, c.contactIds[1]!)).toMatchObject({
      status: 'failed',
      error_message: 'Number not on WhatsApp',
    });
    expect(
      (
        await node('update-contact-status', {
          campaignId: c.uuid,
          contactId: randomUUID(),
          status: 'sent',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await node('update-contact-status', {
          campaignId: c.uuid,
          contactId: c.contactUuids[0],
          status: 'nope',
        })
      ).status,
    ).toBe(422);
  });

  it('a status by message id only moves a recipient forward; an unknown id is not an error', async () => {
    const t = await api.signup('cb4');
    const c = await campaign(t, ['sent']);
    const wamid = (await row(c.id, c.contactIds[0]!)).whatsapp_message_id as string;

    expect(
      (
        await node('update-status-by-id', {
          messageId: wamid,
          status: 'delivered',
          timestamp: '2026-10-05T09:00:00Z',
        })
      ).body,
    ).toEqual({ ok: true, matched: true });
    expect((await row(c.id, c.contactIds[0]!)).status).toBe('delivered');
    await node('update-status-by-id', {
      messageId: wamid,
      status: 'read',
      timestamp: '2026-10-05T09:05:00Z',
    });
    expect((await row(c.id, c.contactIds[0]!)).status).toBe('read');
    // A late delivered never takes a read back.
    await node('update-status-by-id', {
      messageId: wamid,
      status: 'delivered',
      timestamp: '2026-10-05T09:06:00Z',
    });
    const r = await row(c.id, c.contactIds[0]!);
    expect(r.status).toBe('read');
    expect(new Date(r.delivered_at).toISOString()).toBe('2026-10-05T09:00:00.000Z');
    expect(await camp(c.id)).toMatchObject({ delivered_count: 1, read_count: 1 });

    expect(
      (await node('update-status-by-id', { messageId: 'wamid.unknown', status: 'delivered' })).body,
    ).toEqual({ ok: true, matched: false });
    // A failed report after a delivery is the top of the order and applies.
    await node('update-status-by-id', { messageId: wamid, status: 'failed' });
    expect((await row(c.id, c.contactIds[0]!)).status).toBe('failed');
  });
});

describe('TW-CAMP-022: replies and opt-outs', () => {
  it('a reply stores the response and counts it', async () => {
    const t = await api.signup('cb5');
    const c = await campaign(t, ['delivered']);
    const res = await node('track-response', {
      campaignId: c.uuid,
      contactId: c.contactUuids[0],
      response: 'Yes please',
      respondedAt: '2026-10-05T10:00:00Z',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = await row(c.id, c.contactIds[0]!);
    expect(r.response).toBe('Yes please');
    expect(new Date(r.responded_at).toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect((await camp(c.id)).responded_count).toBe(1);
    expect((await events('campaign.contact_replied'))[0]!.payload).toMatchObject({
      response: 'Yes please',
    });
  });

  it('a STOP stamps the recipient, opts the contact out everywhere and announces it once', async () => {
    const t = await api.signup('cb6');
    const c = await campaign(t, ['delivered']);
    const digits = (
      await h.owner.query(
        `SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS d FROM contacts WHERE id = $1`,
        [c.contactIds[0]],
      )
    ).rows[0].d as string;
    const res = await node('unsubscribe', { campaignId: c.uuid, phone: `+${digits}` });
    expect(res.status).toBe(200);
    expect(await row(c.id, c.contactIds[0]!)).toMatchObject({
      status: 'unsubscribed',
      is_unsubscribed: true,
    });
    expect(
      (await h.owner.query(`SELECT is_unsubscribed FROM contacts WHERE id = $1`, [c.contactIds[0]]))
        .rows[0].is_unsubscribed,
    ).toBe(true);

    const before = (await events('contact.opt_in')).length;
    await node('unsubscribe', { campaignId: c.uuid, phone: digits });
    // The contact was already out: nothing new is announced.
    expect((await events('contact.opt_in')).length).toBe(before);
    // The last ten digits are enough to find the contact.
    const d = await campaign(t, ['delivered']);
    const other = (
      await h.owner.query(
        `SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS d FROM contacts WHERE id = $1`,
        [d.contactIds[0]],
      )
    ).rows[0].d as string;
    await node('unsubscribe', { campaignId: d.uuid, phone: other.slice(-10) });
    expect((await row(d.id, d.contactIds[0]!)).status).toBe('unsubscribed');
    // A number that is not on the campaign changes nothing, and an unknown campaign is not found.
    expect((await node('unsubscribe', { campaignId: d.uuid, phone: '15550001111' })).status).toBe(
      200,
    );
    expect(
      (await node('unsubscribe', { campaignId: randomUUID(), phone: '15550001111' })).status,
    ).toBe(404);
  });
});

describe('the drain tick', () => {
  it('answers with the number fired and whether anything is active; in the API process there is no sweeper', async () => {
    const res = await node('drain');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, campaigns_fired: 0, campaigns_active: false });
  });
});
