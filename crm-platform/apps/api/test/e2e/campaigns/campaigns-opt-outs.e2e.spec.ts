import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, bearer, startHarness, type Harness } from '../contacts-attributes-tags/support';

/** The Opt-outs tab of a campaign (row 245): a contact who opts out after the message reached them is listed and counted. */
let h: Harness;
let api: Api;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

describe('opt-outs after a campaign send', () => {
  it('lists a recipient who opted out after the send, with or without a stored send time, and not one who was out before it', async () => {
    const t = await api.signup('oo1');
    const camp = (
      await h.owner.query(
        `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, schedule_type, timezone, total_recipients, completed_at)
         VALUES ($1,'Reply rate','text','completed','now','UTC',4, now()) RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const people = [
      {
        name: 'With send time',
        phone: '+919800000001',
        sentAt: '2026-10-26 11:36:00+00',
        outAt: '2026-10-26 12:05:00+00',
      },
      {
        name: 'No send time',
        phone: '+919800000002',
        sentAt: null,
        outAt: '2026-10-26 12:05:00+00',
      },
      {
        name: 'Out before',
        phone: '+919800000003',
        sentAt: '2026-10-26 11:36:00+00',
        outAt: '2026-10-20 09:00:00+00',
      },
      { name: 'Stays in', phone: '+919800000004', sentAt: '2026-10-26 11:36:00+00', outAt: null },
    ];
    const uuids = await api.seedContacts(
      t,
      people.map((p) => ({ name: p.name, phone: p.phone })),
    );
    for (const [i, p] of people.entries()) {
      const id = Number(
        (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuids[i]])).rows[0].id,
      );
      await h.owner.query(
        `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, whatsapp_message_id, sent_at, delivered_at)
         VALUES ($1,$2,$3,'delivered',$4,$5::timestamptz,'2026-10-26 11:37:00+00')`,
        [t.orgId, camp.id, id, `wamid.${i}`, p.sentAt],
      );
      if (p.outAt)
        await h.owner.query(
          `UPDATE contacts SET is_unsubscribed = true, unsubscribed_at = $2::timestamptz WHERE id = $1`,
          [id, p.outAt],
        );
    }
    const d = await api.http().get(`/v2/campaigns/${camp.uuid}`).set(bearer(t.admin));
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.optOutCount).toBe(2);
    expect(d.body.optOuts.map((o: { name: string }) => o.name).sort()).toEqual([
      'No send time',
      'With send time',
    ]);
  });
});
