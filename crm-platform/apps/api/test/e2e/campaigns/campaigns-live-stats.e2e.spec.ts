import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignLiveSchema, campaignStatisticsSchema } from '@crm/contracts';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Live stats and Statistics of a campaign: the recipient rows are the truth, in a real Postgres. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let n = 0;
const phone = () => `+91970${String(n++).padStart(7, '0')}`;
const get = (t: Tenant | { admin: string }, id: string, path: string) =>
  api.http().get(`/v2/campaigns/${id}${path}`).set(bearer(t.admin));

/** A campaign straight into the table, one recipient per entry of `statuses`. */
async function campaign(
  t: Tenant,
  o: {
    status?: string;
    scheduleType?: string;
    statuses: string[];
    sendDate?: string;
    sendTime?: string;
  },
) {
  const camp = (
    await h.owner.query(
      `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, schedule_type, timezone, total_recipients,
                                send_date, send_time, completed_at)
       VALUES ($1,'C','text',$2,$3,'UTC',$4,$5::date,$6::time, CASE WHEN $2 IN ('completed','failed','cancelled') THEN now() END)
       RETURNING id, uuid`,
      [
        t.orgId,
        o.status ?? 'running',
        o.scheduleType ?? 'now',
        o.statuses.length,
        o.sendDate ?? null,
        o.sendTime ?? null,
      ],
    )
  ).rows[0];
  const contactUuids = await api.seedContacts(
    t,
    o.statuses.map((_, i) => ({ name: `Person ${n}-${i}`, phone: phone() })),
  );
  for (const [i, status] of o.statuses.entries()) {
    const c = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuids[i]])).rows[0]
        .id,
    );
    await h.owner.query(
      `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, sent_at, delivered_at, read_at, error_message)
       VALUES ($1,$2,$3,$4,
         CASE WHEN $4 IN ('sent','delivered','read','responded') THEN now() END,
         CASE WHEN $4 IN ('delivered','read','responded') THEN now() END,
         CASE WHEN $4 IN ('read','responded') THEN now() END,
         CASE WHEN $4 = 'failed' THEN 'boom' END)`,
      [t.orgId, camp.id, c, status],
    );
  }
  return { id: Number(camp.id), uuid: camp.uuid as string };
}

describe('live stats', () => {
  it('counts what is waiting and what a run holds, with the funnel figures, while the campaign is in flight', async () => {
    const t = await api.signup('ls1');
    const c = await campaign(t, {
      statuses: ['queued', 'queued', 'pending', 'sent', 'delivered', 'read', 'failed'],
    });
    const res = await get(t, c.uuid, '/live');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const live = campaignLiveSchema.parse(res.body);
    expect(live).toMatchObject({
      status: 'running',
      inFlight: true,
      queued: 2,
      processing: 1,
      counts: { recipients: 7, sent: 3, delivered: 2, read: 1, failed: 1 },
    });
    expect(live.rates.failed).toBeCloseTo((1 / 7) * 100, 0);
    expect(live.failureSummary).toEqual([{ error: 'boom', count: 1 }]);
    expect(new Date(live.fetchedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('a campaign at rest is not in flight, and one whose recipients are all resolved settles to completed', async () => {
    const t = await api.signup('ls2');
    const done = await campaign(t, { status: 'completed', statuses: ['sent', 'failed'] });
    expect((await get(t, done.uuid, '/live')).body).toMatchObject({
      status: 'completed',
      inFlight: false,
      queued: 0,
    });
    const paused = await campaign(t, { status: 'paused', statuses: ['queued', 'sent'] });
    expect((await get(t, paused.uuid, '/live')).body).toMatchObject({
      status: 'paused',
      inFlight: false,
      queued: 1,
    });
    // A running campaign nobody is waiting on any more is settled by the read, as the detail page always did.
    const settled = await campaign(t, { statuses: ['sent', 'delivered'] });
    expect((await get(t, settled.uuid, '/live')).body).toMatchObject({
      status: 'completed',
      inFlight: false,
    });
    const scheduled = await campaign(t, {
      status: 'scheduled',
      scheduleType: 'scheduled',
      statuses: ['queued'],
      sendDate: '2099-01-02',
      sendTime: '09:30',
    });
    expect((await get(t, scheduled.uuid, '/live')).body).toMatchObject({
      status: 'scheduled',
      inFlight: true,
    });
  });
});

describe('statistics', () => {
  it('counts every recipient once at its status, so it adds up to the audience, next to the cumulative funnel', async () => {
    const t = await api.signup('ls3');
    const c = await campaign(t, {
      statuses: [
        'queued',
        'pending',
        'sent',
        'sent',
        'delivered',
        'read',
        'responded',
        'failed',
        'skipped',
        'unsubscribed',
      ],
    });
    const res = await get(t, c.uuid, '/statistics');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = campaignStatisticsSchema.parse(res.body);
    expect(s.total).toBe(10);
    expect(s.breakdown.map((b) => b.key)).toEqual([
      'queued',
      'pending',
      'sent',
      'delivered',
      'read',
      'responded',
      'failed',
      'unsubscribed',
      'skipped',
    ]);
    expect(Object.fromEntries(s.breakdown.map((b) => [b.key, b.count]))).toEqual({
      queued: 1,
      pending: 1,
      sent: 2,
      delivered: 1,
      read: 1,
      responded: 1,
      failed: 1,
      unsubscribed: 1,
      skipped: 1,
    });
    expect(s.breakdown.reduce((a, b) => a + b.count, 0)).toBe(s.total);
    expect(s.breakdown.find((b) => b.key === 'sent')!.pct).toBeCloseTo(20, 5);
    // The funnel is cumulative: a read message is also delivered and sent.
    expect(s.counts).toMatchObject({ recipients: 10, sent: 5, delivered: 3, read: 2, failed: 1 });
    expect(s.inFlight).toBe(true);
  });

  it('carries the timeline: created, the date it was set for, the first message, and when it finished', async () => {
    const t = await api.signup('ls4');
    const now = await campaign(t, { status: 'completed', statuses: ['sent'] });
    const a = campaignStatisticsSchema.parse((await get(t, now.uuid, '/statistics')).body);
    expect(a.lifecycle.scheduledFor).toBeNull();
    expect(a.lifecycle.firstSentAt).not.toBeNull();
    expect(a.lifecycle.completedAt).not.toBeNull();
    expect(a.inFlight).toBe(false);

    const later = await campaign(t, {
      status: 'scheduled',
      scheduleType: 'scheduled',
      statuses: ['queued'],
      sendDate: '2099-01-02',
      sendTime: '09:30',
    });
    const b = campaignStatisticsSchema.parse((await get(t, later.uuid, '/statistics')).body);
    expect(b.lifecycle.scheduledFor).toEqual({
      date: '2099-01-02',
      time: '09:30:00',
      timezone: 'UTC',
    });
    expect(b.lifecycle.firstSentAt).toBeNull();
    expect(b.lifecycle.completedAt).toBeNull();
  });
});

describe('access', () => {
  it('another workspace gets 404 and a reader without the key is refused', async () => {
    const t = await api.signup('ls5');
    const u = await api.signup('ls5b');
    const c = await campaign(t, { statuses: ['queued'] });
    for (const path of ['/live', '/statistics']) {
      expect((await get(u, c.uuid, path)).status).toBe(404);
      expect((await api.http().get(`/v2/campaigns/${c.uuid}${path}`)).status).toBe(401);
      const nobody = await api.member(t, `nobody${path.length}`, [['camp.campaigns.create']]);
      expect((await get({ admin: nobody.token }, c.uuid, path)).status).toBe(403);
      const reader = await api.member(t, `reader${path.length}`, [['camp.campaigns.read']]);
      expect((await get({ admin: reader.token }, c.uuid, path)).status).toBe(200);
    }
  });
});
