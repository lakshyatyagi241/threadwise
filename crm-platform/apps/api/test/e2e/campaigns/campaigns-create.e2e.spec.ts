import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Creating, editing and reading campaigns (TW-CAMP-001 to 010, 019): the real app and a real Postgres. */
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
const post = (t: Tenant, path: string, body: object = {}) =>
  api
    .http()
    .post(`/v2/campaigns${path}`)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body);
const put = (t: Tenant, id: string, body: object) =>
  api.http().put(`/v2/campaigns/${id}`).set(bearer(t.admin)).send(body);
const get = (t: Tenant, path = '') => api.http().get(`/v2/campaigns${path}`).set(bearer(t.admin));
const code = (res: { body: { code?: string; error?: { code?: string } } }) =>
  res.body.code ?? res.body.error?.code;

const contacts = (t: Tenant, count: number, extra: { isUnsubscribed?: boolean } = {}) =>
  api.seedContacts(
    t,
    Array.from({ length: count }, (_, i) => ({
      name: `Person ${n}-${i}`,
      phone: phone(),
      ...extra,
    })),
  );
const template = async (t: Tenant, o: { type?: string; status?: string; name?: string } = {}) =>
  (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
       VALUES ($1, $2, 'Hello {{1}}', $3, $4) RETURNING uuid`,
      [
        t.orgId,
        o.name ?? `t${randomUUID().slice(0, 8)}`,
        o.type ?? 'standard',
        o.status ?? 'approved',
      ],
    )
  ).rows[0].uuid as string;
const device = async (t: Tenant, name = 'Phone') =>
  (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status, active)
       VALUES ($1, $2, $3, 'connected', true) RETURNING uuid`,
      [t.orgId, name, phone()],
    )
  ).rows[0].uuid as string;

const base = (over: object = {}) => ({
  name: 'Diwali offer',
  type: 'text',
  customMessage: 'Hello there',
  scheduleType: 'now',
  ...over,
});
const row = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM wpcampaigns WHERE uuid = $1`, [uuid])).rows[0];
const recipients = async (uuid: string) =>
  (
    await h.owner.query(
      `SELECT r.status, r.variant, c.phone FROM wp_campaign_contacts r
       JOIN wpcampaigns w ON w.org_id = r.org_id AND w.id = r.campaign_id
       JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
       WHERE w.uuid = $1 ORDER BY r.id`,
      [uuid],
    )
  ).rows as Array<{ status: string; variant: string | null; phone: string }>;

describe('TW-CAMP-003, 004: create and the audience', () => {
  it('a "send now" campaign is running with one queued row per contact', async () => {
    const t = await api.signup('cc1');
    const ids = await contacts(t, 3);
    const res = await post(t, '', base({ contactIds: ids }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.message).toBe('Campaign launched.');
    expect(res.body.campaign).toMatchObject({
      name: 'Diwali offer',
      type: 'text',
      status: 'running',
      counts: { recipients: 3, sent: 0 },
    });
    const rows = await recipients(res.body.campaign.id);
    expect(rows.map((r) => r.status)).toEqual(['queued', 'queued', 'queued']);
    // The message is encrypted at rest.
    expect((await row(res.body.campaign.id)).custom_message).not.toContain('Hello');
  });

  it('the audience is the union of contacts, groups, tags, typed numbers and a CSV, each person once', async () => {
    const t = await api.signup('cc2');
    const [direct, grouped, tagged] = await contacts(t, 3);
    const groupId = (
      await h.owner.query(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1,'VIP') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const gContact = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [grouped])).rows[0].id,
    );
    await h.owner.query(
      `INSERT INTO contact_group_members (org_id, group_id, contact_id) VALUES ($1,$2,$3)`,
      [t.orgId, groupId.id, gContact],
    );
    const tag = (
      await h.owner.query(`INSERT INTO tags (org_id, name) VALUES ($1,'warm') RETURNING id, uuid`, [
        t.orgId,
      ])
    ).rows[0];
    const tContact = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [tagged])).rows[0].id,
    );
    await h.owner.query(`INSERT INTO contact_tags (org_id, contact_id, tag_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      tContact,
      tag.id,
    ]);

    const res = await post(
      t,
      '',
      base({
        contactIds: [direct, grouped],
        groupIds: [groupId.uuid],
        tagIds: [tag.uuid],
        manualNumbers: '919812345670, 919812345671;919812345670',
        csvText: 'name,phone,promo code\nAsha,919812345672,SAVE10\nBharat,919812345671,X\n',
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // 3 contacts + 919812345670, 919812345671, 919812345672 = 6 people, the repeated numbers counted once.
    expect(res.body.campaign.counts.recipients).toBe(6);

    // A CSV row's own name and columns land on the contact it made; an existing number keeps its row.
    const asha = (
      await h.owner.query(
        `SELECT name, data FROM contacts WHERE org_id = $1 AND phone = '+919812345672'`,
        [t.orgId],
      )
    ).rows[0];
    expect(asha.name).toBe('Asha');
    expect(asha.data).toMatchObject({ 'promo code': 'SAVE10', promo_code: 'SAVE10' });
    const typed = (
      await h.owner.query(
        `SELECT name FROM contacts WHERE org_id = $1 AND phone = '+919812345670'`,
        [t.orgId],
      )
    ).rows[0];
    expect(typed.name).toBe('Recipient · 5670');
  });

  it("another workspace's contacts, groups and tags are dropped, and nobody left is refused", async () => {
    const t = await api.signup('cc3');
    const u = await api.signup('cc3b');
    const foreign = await contacts(u, 2);
    const res = await post(t, '', base({ contactIds: foreign }));
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CAMP_NO_RECIPIENTS');

    const draft = await post(t, '', base({ contactIds: foreign, status: 'draft' }));
    expect(draft.status).toBe(201);
    expect(draft.body.campaign).toMatchObject({ status: 'draft', counts: { recipients: 0 } });
  });

  it('opted-out contacts stay on the list: the run stamps them, as Reference does', async () => {
    const t = await api.signup('cc4');
    const ids = [...(await contacts(t, 1)), ...(await contacts(t, 1, { isUnsubscribed: true }))];
    const res = await post(t, '', base({ contactIds: ids }));
    expect(res.body.campaign.counts.recipients).toBe(2);
  });

  it('A/B testing splits the recipients exactly and keeps the assignment on the rows', async () => {
    const t = await api.signup('cc5');
    const ids = await contacts(t, 10);
    const res = await post(
      t,
      '',
      base({ contactIds: ids, abTesting: true, abSplit: 30, customMessageB: 'Hello other' }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await recipients(res.body.campaign.id);
    expect(rows.filter((r) => r.variant === 'A')).toHaveLength(3);
    expect(rows.filter((r) => r.variant === 'B')).toHaveLength(7);
  });

  it('the sender picked sets the engine and the number together; an unknown one is refused', async () => {
    const t = await api.signup('cc6');
    const ids = await contacts(t, 1);
    const dev = await device(t);
    const ok = await post(t, '', base({ contactIds: ids, senderKey: `baileys:${dev}` }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.campaign.provider).toBe('baileys');
    const stored = await row(ok.body.campaign.id);
    expect(Number(stored.device_id)).toBeGreaterThan(0);
    const cfg = await get(t, `/${ok.body.campaign.id}/config`);
    expect(cfg.body.senderKey).toBe(`baileys:${dev}`);

    const bad = await post(t, '', base({ contactIds: ids, senderKey: `baileys:${randomUUID()}` }));
    expect(bad.status).toBe(422);
  });
});

describe('TW-CAMP-005, 006, 007: template gate, custom message, media', () => {
  it('a template of another workspace is not found; an OTP template and an unapproved one on the Cloud API are refused', async () => {
    const t = await api.signup('cc7');
    const u = await api.signup('cc7b');
    const ids = await contacts(t, 1);
    const foreign = await template(u);
    expect(
      (
        await post(
          t,
          '',
          base({ type: 'template', templateId: foreign, customMessage: null, contactIds: ids }),
        )
      ).status,
    ).toBe(422);

    const otp = await template(t, { type: 'auth' });
    const refused = await post(
      t,
      '',
      base({ type: 'template', templateId: otp, customMessage: null, contactIds: ids }),
    );
    expect(refused.status).toBe(422);
    expect(code(refused)).toBe('CAMP_TEMPLATE_NOT_ALLOWED');

    // On a Cloud API workspace only an approved template is allowed.
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, default_engine) VALUES ($1, 'waba') ON CONFLICT DO NOTHING`,
      [t.orgId],
    );
    await h.owner.query(`UPDATE workspace_settings SET default_engine = 'waba' WHERE org_id = $1`, [
      t.orgId,
    ]);
    const pending = await template(t, { status: 'pending' });
    const waba = await post(
      t,
      '',
      base({ type: 'template', templateId: pending, customMessage: null, contactIds: ids }),
    );
    expect(waba.status).toBe(422);
    expect(code(waba)).toBe('CAMP_TEMPLATE_NOT_ALLOWED');
    expect(waba.body.detail ?? waba.body.message).toContain(
      'WABA engine requires a Meta-approved template',
    );
  });

  it("variant B's template or flow of another workspace is refused", async () => {
    const t = await api.signup('cc8');
    const u = await api.signup('cc8b');
    const ids = await contacts(t, 1);
    const foreign = await template(u);
    const res = await post(t, '', base({ contactIds: ids, abTesting: true, templateIdB: foreign }));
    expect(res.status).toBe(422);
  });

  it('a named variable is stored positional with its map, and the form gets it back', async () => {
    const t = await api.signup('cc9');
    const ids = await contacts(t, 1);
    const res = await post(
      t,
      '',
      base({ contactIds: ids, customMessage: 'Hi {{first_name}}, order {{order_id}}' }),
    );
    expect(res.status).toBe(201);
    const cfg = await get(t, `/${res.body.campaign.id}/config`);
    expect(cfg.body.customMessage).toBe('Hi {{1}}, order {{2}}');
    expect(cfg.body.variableMap).toEqual({ '1': 'first_name', '2': 'order_id' });
  });

  it('one media: an image goes to the image column, an unsupported kind is refused', async () => {
    const t = await api.signup('cc10');
    const ids = await contacts(t, 1);
    const ok = await post(
      t,
      '',
      base({ contactIds: ids, type: 'media', mediaUrl: 'https://cdn.example.com/p.png' }),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await row(ok.body.campaign.id)).custom_image).toBe('https://cdn.example.com/p.png');
    const bad = await post(
      t,
      '',
      base({ contactIds: ids, type: 'media', mediaUrl: 'https://cdn.example.com/p.mp3' }),
    );
    expect(bad.status).toBe(422);
  });
});

describe('TW-CAMP-008, 009: schedule and Smart Delivery', () => {
  it('a scheduled campaign needs its date and time; the end date must be after the send date', async () => {
    const t = await api.signup('cc11');
    const ids = await contacts(t, 1);
    const noDate = await post(t, '', base({ contactIds: ids, scheduleType: 'scheduled' }));
    expect(noDate.status).toBe(422);

    const early = await post(
      t,
      '',
      base({
        contactIds: ids,
        scheduleType: 'scheduled',
        sendDate: '2026-12-05',
        sendTime: '09:00',
        timezone: 'Asia/Kolkata',
        expiresAt: '2026-12-05T09:00',
      }),
    );
    expect(early.status).toBe(422);
    expect(code(early)).toBe('CAMP_EXPIRY_BEFORE_SEND');

    const ok = await post(
      t,
      '',
      base({
        contactIds: ids,
        scheduleType: 'scheduled',
        sendDate: '2026-12-05',
        sendTime: '09:00',
        timezone: 'Asia/Kolkata',
        expiresAt: '2026-12-06T09:00',
      }),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.message).toBe('Campaign scheduled.');
    expect(ok.body.campaign).toMatchObject({
      status: 'scheduled',
      sendDate: '2026-12-05',
      sendTime: '09:00',
    });
    // The end date is stored as the UTC instant it names in the campaign's zone.
    expect(new Date((await row(ok.body.campaign.id)).expires_at).toISOString()).toBe(
      '2026-12-06T03:30:00.000Z',
    );
    const cfg = await get(t, `/${ok.body.campaign.id}/config`);
    expect(cfg.body.expiresAtLocal).toBe('2026-12-06T09:00');
  });

  it('recurring defaults to weekly; Smart Delivery fields are validated and kept', async () => {
    const t = await api.signup('cc12');
    const ids = await contacts(t, 1);
    const res = await post(
      t,
      '',
      base({
        contactIds: ids,
        scheduleType: 'recurring',
        sendDate: '2026-12-05',
        sendTime: '09:00',
        throttleMinSec: 5,
        throttleMaxSec: 9,
        batchSize: 20,
        batchPauseMin: 2,
        dailyLimit: 100,
        windowStart: '09:00',
        windowEnd: '18:00',
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.message).toBe('Recurring campaign saved.');
    expect(res.body.campaign.repeatInterval).toBe('weekly');
    const cfg = await get(t, `/${res.body.campaign.id}/config`);
    expect(cfg.body).toMatchObject({
      throttleMinSec: 5,
      throttleMaxSec: 9,
      batchSize: 20,
      dailyLimit: 100,
      windowStart: '09:00',
    });

    const bad = await post(t, '', base({ contactIds: ids, throttleMinSec: 9, throttleMaxSec: 5 }));
    expect(bad.status).toBe(422);
    expect((await post(t, '', base({ contactIds: ids, customMessage: '' }))).status).toBe(422);
  });
});

describe('TW-CAMP-010: edit', () => {
  it('only a draft, scheduled or paused campaign can change; the audience is rebuilt only when sent', async () => {
    const t = await api.signup('cc13');
    const ids = await contacts(t, 3);
    const made = await post(
      t,
      '',
      base({
        contactIds: ids,
        scheduleType: 'scheduled',
        sendDate: '2026-12-05',
        sendTime: '09:00',
      }),
    );
    const id = made.body.campaign.id as string;

    const renamed = await put(
      t,
      id,
      base({
        name: 'Renamed',
        scheduleType: 'scheduled',
        sendDate: '2026-12-05',
        sendTime: '09:00',
      }),
    );
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.campaign.name).toBe('Renamed');
    expect((await recipients(id)).length).toBe(3);

    const rebuilt = await put(
      t,
      id,
      base({
        scheduleType: 'scheduled',
        sendDate: '2026-12-05',
        sendTime: '09:00',
        contactIds: [ids[0]],
      }),
    );
    expect(rebuilt.status).toBe(200);
    expect((await recipients(id)).length).toBe(1);
    expect((await row(id)).total_recipients).toBe(1);

    await h.owner.query(`UPDATE wpcampaigns SET status = 'running' WHERE uuid = $1`, [id]);
    const locked = await put(t, id, base({ scheduleType: 'now' }));
    expect(locked.status).toBe(422);
    expect(code(locked)).toBe('CAMP_NOT_EDITABLE');
  });
});

describe('TW-CAMP-001, 019: list and detail', () => {
  it('lists with filters, counts from the recipient rows, and finishes a campaign whose recipients are all resolved', async () => {
    const t = await api.signup('cc14');
    const ids = await contacts(t, 2);
    const a = await post(t, '', base({ name: 'Alpha sale', contactIds: ids }));
    const b = await post(
      t,
      '',
      base({
        name: 'Beta flow',
        type: 'template',
        templateId: await template(t),
        customMessage: null,
        contactIds: ids,
      }),
    );

    // Alpha's two recipients are done: one delivered, one failed. The list says so and completes the campaign.
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status = 'delivered', sent_at = now(), delivered_at = now()
       WHERE campaign_id = (SELECT id FROM wpcampaigns WHERE uuid = $1) AND id = (SELECT min(id) FROM wp_campaign_contacts WHERE campaign_id = (SELECT id FROM wpcampaigns WHERE uuid = $1))`,
      [a.body.campaign.id],
    );
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status = 'failed', error_message = 'boom'
       WHERE campaign_id = (SELECT id FROM wpcampaigns WHERE uuid = $1) AND status = 'queued'`,
      [a.body.campaign.id],
    );

    const list = await get(t);
    expect(list.status).toBe(200);
    const alpha = list.body.data.find((c: { name: string }) => c.name === 'Alpha sale');
    expect(alpha).toMatchObject({
      status: 'completed',
      counts: { recipients: 2, sent: 1, delivered: 1, failed: 1 },
    });
    expect(list.body.stats).toMatchObject({ total: 2, running: 1, completed: 1, sentTotal: 1 });
    expect(list.body.messageTypes).toEqual({ text: 1, template: 1, flow: 0 });
    expect(list.body.deliveryHealth).toMatchObject({ avgDeliveryRate: 100, status: 'healthy' });

    const tpl = await get(t).query({ type: 'template' });
    expect(tpl.body.data.map((c: { name: string }) => c.name)).toEqual(['Beta flow']);
    const done = await get(t).query({ status: 'completed' });
    expect(done.body.data.map((c: { name: string }) => c.name)).toEqual(['Alpha sale']);
    const found = await get(t).query({ q: 'beta' });
    expect(found.body.data.map((c: { name: string }) => c.name)).toEqual(['Beta flow']);
    expect(b.status).toBe(201);
  });

  it('the detail has rates, funnel, outcomes, audience, failures and replies, all from the rows', async () => {
    const t = await api.signup('cc15');
    const ids = await contacts(t, 4);
    const made = await post(t, '', base({ contactIds: ids }));
    const id = made.body.campaign.id as string;
    const cid = Number((await row(id)).id);
    const rs = (
      await h.owner.query(
        `SELECT id FROM wp_campaign_contacts WHERE campaign_id = $1 ORDER BY id`,
        [cid],
      )
    ).rows;
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status='read', sent_at=now(), delivered_at=now(), read_at=now() WHERE id=$1`,
      [rs[0].id],
    );
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status='responded', sent_at=now(), delivered_at=now(), read_at=now(), responded_at=now(), response='Yes please' WHERE id=$1`,
      [rs[1].id],
    );
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status='delivered', sent_at=now(), delivered_at=now(), clicked=true, clicked_at=now() WHERE id=$1`,
      [rs[2].id],
    );
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status='failed', error_message='Number not on WhatsApp' WHERE id=$1`,
      [rs[3].id],
    );

    const d = await get(t, `/${id}`);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.campaign.counts).toMatchObject({
      recipients: 4,
      sent: 3,
      delivered: 3,
      read: 2,
      replies: 1,
      clicks: 1,
      failed: 1,
    });
    expect(d.body.rates).toMatchObject({
      delivered: 75,
      read: 66.7,
      replies: 25,
      clicks: 25,
      failed: 25,
    });
    expect(d.body.funnel.map((f: { count: number }) => f.count)).toEqual([4, 3, 3, 2, 1]);
    expect(d.body.failedCount).toBe(1);
    expect(d.body.deliveryIssueReason).toBe('Number not on WhatsApp');
    expect(d.body.failureSummary).toEqual([{ error: 'Number not on WhatsApp', count: 1 }]);
    expect(d.body.replies[0]).toMatchObject({ response: 'Yes please' });
    expect(d.body.audience).toMatchObject({ uploaded: 4, finalList: 4, label: 'Ungrouped' });
    expect(d.body.hourly).toHaveLength(24);
    expect(d.body.preview.body).toBe('Hello there');
    // The stored counters were brought in line with the rows by opening the page.
    expect(Number((await row(id)).sent_count)).toBe(3);

    const live = await get(t, `/${id}/live`);
    expect(live.body.counts.sent).toBe(3);

    const page = await get(t, `/${id}/recipients`).query({ status: 'failed' });
    expect(page.body.page.total).toBe(1);
    expect(page.body.data[0]).toMatchObject({ status: 'failed', error: 'Number not on WhatsApp' });
    const all = await get(t, `/${id}/recipients`);
    expect(all.body.data).toHaveLength(4);
  });

  it('the detail carries engagement, top buttons from real clicks, segments by group and who opted out', async () => {
    const t = await api.signup('cc15b');
    const ids = await contacts(t, 3);
    const dev = await device(t, 'Buttons phone');
    const made = await post(
      t,
      '',
      base({
        contactIds: ids,
        senderKey: `baileys:${dev}`,
        type: 'button',
        customButtons: [
          { type: 'url', text: 'Shop', url: 'https://shop.test/a', value: 'https://shop.test/a' },
          { type: 'quick_reply', text: 'Yes', value: 'Yes' },
        ],
      }),
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.campaign.id as string;
    const cid = Number((await row(id)).id);
    const rs = (
      await h.owner.query(
        `SELECT id FROM wp_campaign_contacts WHERE campaign_id = $1 ORDER BY id`,
        [cid],
      )
    ).rows;
    const g = (
      await h.owner.query(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1,'VIP') RETURNING id`,
        [t.orgId],
      )
    ).rows[0];
    await h.owner.query(
      `INSERT INTO contact_group_members (org_id, group_id, contact_id)
       SELECT $1, $2, contact_id FROM wp_campaign_contacts WHERE campaign_id = $3`,
      [t.orgId, g.id, cid],
    );
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status='read', sent_at=now(), delivered_at=now(), read_at=now() WHERE id=$1`,
      [rs[0].id],
    );
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status='delivered', sent_at=now(), delivered_at=now(), clicked=true WHERE id=$1`,
      [rs[1].id],
    );
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status='unsubscribed', is_unsubscribed=true, unsubscribed_at=now() WHERE id=$1`,
      [rs[2].id],
    );
    await h.owner.query(
      `INSERT INTO wa_link_clicks (org_id, token, original_url, campaign_id, clicks) VALUES ($1,'tok1','https://shop.test/a',$2,3)`,
      [t.orgId, cid],
    );

    const d = await get(t, `/${id}`);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.segments).toEqual([
      { name: 'VIP', recipients: 3, replies: 0, optOuts: 1, readPct: 33.3 },
    ]);
    expect(d.body.buttonRows).toEqual([
      { label: 'Shop', count: 3, trackable: true, pct: 100 },
      { label: 'Yes', count: null, trackable: false, pct: 0 },
    ]);
    expect(d.body.engagement).toMatchObject({ openedCount: 1, optOutCount: 1, optOutPct: 33.3 });
    expect(d.body.optOuts).toHaveLength(1);
    expect(d.body.optOuts[0].at).toEqual(expect.any(String));
  });

  it('the builder lists senders, templates, groups with counts, tags with counts and flows', async () => {
    const t = await api.signup('cc16');
    await device(t, 'Sales phone');
    const tpl = await template(t, { name: 'welcome' });
    const [c1] = await contacts(t, 1);
    const g = (
      await h.owner.query(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1,'VIP') RETURNING id`,
        [t.orgId],
      )
    ).rows[0];
    await h.owner.query(
      `INSERT INTO contact_group_members (org_id, group_id, contact_id) SELECT $1, $2, id FROM contacts WHERE uuid = $3`,
      [t.orgId, g.id, c1],
    );
    const b = await get(t, '/builder');
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.senders.map((s: { label: string }) => s.label)).toContain('Sales phone');
    expect(b.body.templates.map((x: { id: string }) => x.id)).toContain(tpl);
    expect(b.body.groups).toEqual([expect.objectContaining({ name: 'VIP', members: 1 })]);
    expect(b.body.requiresApprovedTemplates).toBe(false);
  });

  it('the sample CSV downloads with its header and two rows', async () => {
    const t = await api.signup('cc17');
    const res = await get(t, '/sample-csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('campaign-recipients-sample.csv');
    expect(res.text).toBe(
      'name,country_code,phone\nAarav Sharma,91,9812345678\nPriya Patel,91,9898765432\n',
    );
  });
});

describe('isolation and permissions', () => {
  it("another workspace's campaign is 404 everywhere, and each route needs its permission", async () => {
    const t = await api.signup('cc18');
    const u = await api.signup('cc18b');
    const ids = await contacts(t, 1);
    const made = await post(t, '', base({ contactIds: ids }));
    const id = made.body.campaign.id as string;
    for (const path of ['', '/config', '/live', '/recipients']) {
      expect((await get(u, `/${id}${path}`)).status).toBe(404);
    }
    expect((await put(u, id, base())).status).toBe(404);

    const viewer = await api.member(t, 'viewer', []);
    expect((await api.http().get('/v2/campaigns').set(bearer(viewer.token))).status).toBe(403);
    const reader = await api.member(t, 'reader', [['camp.campaigns.read']]);
    expect((await api.http().get('/v2/campaigns').set(bearer(reader.token))).status).toBe(200);
    const denied = await api
      .http()
      .post('/v2/campaigns')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send(base({ contactIds: ids }));
    expect(denied.status).toBe(403);
    expect((await api.http().get('/v2/campaigns')).status).toBe(401);
  });
});
