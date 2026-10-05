import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Reading broadcasts (WD-BCAST-001, 002, 030 to 036): the list, the tiles, the detail page, its recipients and the live
 * counters, against a real Postgres. Rows are written straight into the tables so each case controls the numbers.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const get = (t: Tenant, path: string) => api.http().get(path).set(bearer(t.admin));

interface NewBroadcast {
  name?: string;
  status?: string;
  counters?: { success?: number; delivered?: number; read?: number; fail?: number };
  total?: number;
  createdAt?: string;
  templateId?: number | null;
  deviceId?: number | null;
  provider?: string | null;
  timezone?: string;
}

async function broadcast(t: Tenant, o: NewBroadcast = {}) {
  const c = o.counters ?? {};
  const res = await h.owner.query(
    `INSERT INTO broadcasts (org_id, name, status, provider, device_id, template_id, timezone, total_recipients,
                             success_count, delivered_count, read_count, fail_count, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13::timestamptz, now())) RETURNING id, uuid`,
    [
      t.orgId,
      o.name ?? 'B',
      o.status ?? 'completed',
      o.provider ?? null,
      o.deviceId ?? null,
      o.templateId ?? null,
      o.timezone ?? 'UTC',
      o.total ?? 0,
      c.success ?? 0,
      c.delivered ?? 0,
      c.read ?? 0,
      c.fail ?? 0,
      o.createdAt ?? null,
    ],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

let phone = 0;
async function recipient(
  t: Tenant,
  broadcastId: number,
  o: {
    status: string;
    name?: string | null;
    first?: string;
    last?: string;
    error?: string;
    sentAt?: string;
    deliveredAt?: string;
    readAt?: string;
    phone?: string;
  },
) {
  const [uuid] = await api.seedContacts(t, [
    {
      name: o.name === undefined ? `Person ${phone}` : (o.name as string),
      phone: o.phone ?? `+91984${String(phone++).padStart(7, '0')}`,
    },
  ]);
  const contact = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0]
    .id;
  if (o.first || o.last || o.name === null) {
    await h.owner.query(
      `UPDATE contacts SET name = $1, first_name = $2, last_name = $3 WHERE id = $4`,
      [o.name ?? '', o.first ?? null, o.last ?? null, contact],
    );
  }
  await h.owner.query(
    `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, error_message, sent_at, delivered_at, read_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      t.orgId,
      broadcastId,
      contact,
      o.status,
      o.error ?? null,
      o.sentAt ?? null,
      o.deliveredAt ?? null,
      o.readAt ?? null,
    ],
  );
  return { contact, uuid };
}

describe('WD-BCAST-001: the list', () => {
  it('includeTotal adds meta.total for the filter, not for the page; without it there is no meta', async () => {
    const t = await api.signup('l0');
    for (let i = 0; i < 15; i++)
      await broadcast(t, { name: `T${i}`, status: i < 4 ? 'failed' : 'completed' });
    const all = await get(t, '/v2/broadcasts?includeTotal=true');
    expect(all.body.data).toHaveLength(12);
    expect(all.body.meta).toEqual({ total: 15 });
    expect((await get(t, '/v2/broadcasts?includeTotal=true&status=failed')).body.meta).toEqual({
      total: 4,
    });
    expect((await get(t, '/v2/broadcasts?includeTotal=true&q=T1')).body.meta).toEqual({ total: 6 });
    expect((await get(t, '/v2/broadcasts')).body.meta).toBeUndefined();
    const other = await api.signup('l0b');
    expect((await get(other, '/v2/broadcasts?includeTotal=true')).body.meta).toEqual({ total: 0 });
  });

  it('30 broadcasts: 12 newest first, then the next pages by cursor', async () => {
    const t = await api.signup('l1');
    for (let i = 1; i <= 30; i++)
      await broadcast(t, {
        name: `B${String(i).padStart(2, '0')}`,
        createdAt: `2026-09-${String(Math.min(i, 28)).padStart(2, '0')}T10:00:00Z`,
      });
    const p1 = await get(t, '/v2/broadcasts');
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(p1.body.data).toHaveLength(12);
    expect(p1.body.page).toMatchObject({ hasMore: true, limit: 12 });
    // Newest first: the last two share a day, so id decides; B30 was inserted last.
    expect(p1.body.data[0].name).toBe('B30');

    const p2 = await get(t, `/v2/broadcasts?cursor=${p1.body.page.nextCursor}`);
    const p3 = await get(t, `/v2/broadcasts?cursor=${p2.body.page.nextCursor}`);
    expect(p2.body.data).toHaveLength(12);
    expect(p3.body.data).toHaveLength(6);
    expect(p3.body.page.hasMore).toBe(false);
    const names = [...p1.body.data, ...p2.body.data, ...p3.body.data].map(
      (b: { name: string }) => b.name,
    );
    expect(new Set(names).size).toBe(30);
    expect((await get(t, '/v2/broadcasts/summary')).body.stats.total).toBe(30);
  });

  it('a status and a name filter combine; the tiles do not change with the filter', async () => {
    const t = await api.signup('l2');
    await broadcast(t, { name: 'May sale', status: 'failed' });
    await broadcast(t, { name: 'MAYBE later', status: 'failed' });
    await broadcast(t, { name: 'May sale 2', status: 'completed' });
    await broadcast(t, { name: 'June', status: 'failed' });
    const before = (await get(t, '/v2/broadcasts/summary')).body;
    const res = await get(t, '/v2/broadcasts?status=failed&q=may');
    expect(res.body.data.map((b: { name: string }) => b.name).sort()).toEqual([
      'MAYBE later',
      'May sale',
    ]);
    expect((await get(t, '/v2/broadcasts/summary')).body).toEqual(before);
  });

  it('a name search treats % and _ as plain characters', async () => {
    const t = await api.signup('l3');
    await broadcast(t, { name: '100% off' });
    await broadcast(t, { name: 'plain' });
    expect(
      (await get(t, '/v2/broadcasts?q=%25')).body.data.map((b: { name: string }) => b.name),
    ).toEqual(['100% off']);
  });

  it('the range pills keep only recent broadcasts; unknown ranges are refused', async () => {
    const t = await api.signup('l4');
    await broadcast(t, { name: 'old', createdAt: '2020-01-01T00:00:00Z' });
    await broadcast(t, { name: 'new' });
    expect(
      (await get(t, '/v2/broadcasts?range=7d')).body.data.map((b: { name: string }) => b.name),
    ).toEqual(['new']);
    expect((await get(t, '/v2/broadcasts?range=all')).body.data).toHaveLength(2);
    expect((await get(t, '/v2/broadcasts?range=1y')).status).toBe(422);
  });

  it("another organization's broadcasts never show", async () => {
    const t = await api.signup('l5');
    const other = await api.signup('l5b');
    await broadcast(other, { name: 'theirs' });
    expect((await get(t, '/v2/broadcasts')).body.data).toEqual([]);
  });

  it('needs the read permission and a sign-in', async () => {
    const t = await api.signup('l6');
    const none = await api.member(t, 'nobody', []);
    expect((await api.http().get('/v2/broadcasts').set(bearer(none.token))).status).toBe(403);
    expect((await api.http().get('/v2/broadcasts')).status).toBe(401);
  });

  it('shows the template name and the sender the broadcast sends from', async () => {
    const t = await api.signup('l7');
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, status) VALUES ($1,'promo','x','approved') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const dev = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, phone_number, status, active) VALUES ($1,'Main','+919811100001','connected',true) RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    await broadcast(t, {
      templateId: Number(tpl.id),
      deviceId: Number(dev.id),
      provider: 'baileys',
    });
    const item = (await get(t, '/v2/broadcasts')).body.data[0];
    expect(item).toMatchObject({
      templateName: 'promo',
      templateId: tpl.uuid,
      senderKey: `baileys:${dev.uuid}`,
    });
  });
});

describe('WD-BCAST-002: the tiles', () => {
  it('sums the counters and derives the percentages', async () => {
    const t = await api.signup('s1');
    await broadcast(t, { total: 10, counters: { success: 10, delivered: 8, read: 4 } });
    await broadcast(t, { total: 5, counters: { success: 5, delivered: 4, read: 1 } });
    const { stats } = (await get(t, '/v2/broadcasts/summary')).body;
    expect(stats).toMatchObject({
      total: 2,
      recipients: 15,
      sent: 15,
      delivered: 12,
      read: 5,
      deliveryPct: 80,
      readPct: 41.7,
    });
  });

  it('a broadcast with 0 sent and 3 failed shows 0.0% failed (the base is sent)', async () => {
    const t = await api.signup('s2');
    await broadcast(t, { total: 3, counters: { fail: 3 } });
    const { stats } = (await get(t, '/v2/broadcasts/summary')).body;
    expect(stats).toMatchObject({ failed: 3, failedPct: 0 });
  });

  it('queued counts recipients still waiting (WaDesk always showed 0; the fix is intended)', async () => {
    const t = await api.signup('s3');
    const b = await broadcast(t, { status: 'processing', total: 3 });
    for (const status of ['pending', 'pending', 'sent']) await recipient(t, b.id, { status });
    const { stats } = (await get(t, '/v2/broadcasts/summary')).body;
    expect(stats.queued).toBe(2);
    expect(stats.processing).toBe(1);
  });

  it('counts broadcasts by status, with every pill present', async () => {
    const t = await api.signup('s4');
    await broadcast(t, { status: 'failed' });
    await broadcast(t, { status: 'completed' });
    await broadcast(t, { status: 'paused' });
    expect((await get(t, '/v2/broadcasts/summary')).body.statusCounts).toEqual({
      all: 3,
      scheduled: 0,
      processing: 0,
      completed: 1,
      completed_with_errors: 0,
      failed: 1,
      paused: 1,
    });
  });
});

describe('WD-BCAST-030, 031, 033, 034: the detail', () => {
  it('derives the header numbers from the recipient rows, with the cascade', async () => {
    const t = await api.signup('d1');
    const b = await broadcast(t, { status: 'completed_with_errors', total: 6 });
    for (const status of ['sent', 'delivered', 'delivered', 'read', 'failed', 'pending']) {
      await recipient(t, b.id, { status });
    }
    const d = (await get(t, `/v2/broadcasts/${b.uuid}`)).body;
    expect(d.counts).toEqual({
      total: 6,
      sent: 4,
      delivered: 3,
      read: 1,
      failed: 1,
      queued: 1,
      clicked: 0,
    });
    expect(d.pct).toEqual({ sent: 66.7, delivered: 50, read: 33.3, failed: 16.7, clicked: 0 });
    expect(d.donut).toEqual({
      labels: ['Sent', 'Delivered', 'Read', 'Queued', 'Failed'],
      series: [1, 2, 1, 1, 1],
      successPct: 67,
    });
    expect(d.events).toMatchObject({ status: 'completed_with_errors' });
  });

  it('builds the delivery curve in the broadcast zone and the failure histogram', async () => {
    const t = await api.signup('d2');
    const b = await broadcast(t, { timezone: 'Asia/Kolkata', createdAt: '2026-10-02T03:40:00Z' }); // 09:10 in Kolkata
    await recipient(t, b.id, {
      status: 'delivered',
      sentAt: '2026-10-02T03:45:00Z',
      deliveredAt: '2026-10-02T04:50:00Z',
    });
    await recipient(t, b.id, { status: 'failed', error: 'no phone' });
    await recipient(t, b.id, { status: 'failed', error: 'no phone' });
    await recipient(t, b.id, { status: 'failed' });
    const d = (await get(t, `/v2/broadcasts/${b.uuid}`)).body;
    expect(d.deliveryCurve.labels).toEqual(['9:00', '10:00']);
    expect(d.deliveryCurve.sent).toEqual([1, 0]);
    expect(d.deliveryCurve.delivered).toEqual([0, 1]);
    expect(d.failureReasons).toEqual([
      { reason: 'no phone', count: 2 },
      { reason: 'Unknown', count: 1 },
    ]);
  });

  it('includes the template and the sender; a deleted template or sender is simply absent', async () => {
    const t = await api.signup('d3');
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, category, meta_category, status) VALUES ($1,'promo','Hi {{1}}','marketing','UTILITY','approved') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const cfg = (
      await h.owner.query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label) VALUES ($1,'waba','connected','+919811100009','Acme') RETURNING id`,
        [t.orgId],
      )
    ).rows[0];
    const b = await broadcast(t, {
      templateId: Number(tpl.id),
      provider: 'waba',
      deviceId: Number(cfg.id),
    });
    const d = (await get(t, `/v2/broadcasts/${b.uuid}`)).body;
    expect(d.template).toMatchObject({
      id: tpl.uuid,
      name: 'promo',
      category: 'UTILITY',
      body: 'Hi {{1}}',
    });
    expect(d.sender).toEqual({ engine: 'waba', label: 'Acme', phone: '+919811100009' });
    const bare = await broadcast(t);
    const bd = (await get(t, `/v2/broadcasts/${bare.uuid}`)).body;
    expect(bd.template).toBeNull();
    expect(bd.sender).toBeNull();
  });

  it("another organization's broadcast is a 404, and a malformed id is a 400", async () => {
    const t = await api.signup('d4');
    const other = await api.signup('d4b');
    const theirs = await broadcast(other);
    expect((await get(t, `/v2/broadcasts/${theirs.uuid}`)).status).toBe(404);
    expect((await get(t, `/v2/broadcasts/${theirs.uuid}/recipients`)).status).toBe(404);
    expect((await get(t, `/v2/broadcasts/${theirs.uuid}/live`)).status).toBe(404);
    expect((await get(t, '/v2/broadcasts/not-a-uuid')).status).toBe(400);
  });
});

describe('WD-BCAST-032: the recipients', () => {
  it('names and numbers: the name, else first and last, else Unknown; the number with its country code', async () => {
    const t = await api.signup('r1');
    const b = await broadcast(t);
    await recipient(t, b.id, { status: 'sent', name: 'Ana Rao', phone: '+919876543210' });
    await recipient(t, b.id, {
      status: 'sent',
      name: '',
      first: 'Ravi',
      last: 'Kumar',
      phone: '+919876543211',
    });
    await recipient(t, b.id, { status: 'sent', name: '', phone: '+919876543212' });
    const rows = (await get(t, `/v2/broadcasts/${b.uuid}/recipients`)).body.data;
    expect(rows.map((r: { name: string; phone: string }) => [r.name, r.phone]).sort()).toEqual([
      ['Ana Rao', '+919876543210'],
      ['Ravi Kumar', '+919876543211'],
      ['Unknown contact', '+919876543212'],
    ]);
  });

  it('filters by status and by name or number, and pages by cursor, newest first', async () => {
    const t = await api.signup('r2');
    const b = await broadcast(t);
    for (let i = 0; i < 5; i++)
      await recipient(t, b.id, {
        status: i % 2 ? 'failed' : 'sent',
        name: `Cust ${i}`,
        phone: `+91990000000${i}`,
      });
    const failed = (await get(t, `/v2/broadcasts/${b.uuid}/recipients?status=failed`)).body.data;
    expect(failed).toHaveLength(2);
    expect(
      (await get(t, `/v2/broadcasts/${b.uuid}/recipients?q=cust%203`)).body.data.map(
        (r: { name: string }) => r.name,
      ),
    ).toEqual(['Cust 3']);
    expect(
      (await get(t, `/v2/broadcasts/${b.uuid}/recipients?q=9900000004`)).body.data.map(
        (r: { name: string }) => r.name,
      ),
    ).toEqual(['Cust 4']);

    const p1 = (await get(t, `/v2/broadcasts/${b.uuid}/recipients?limit=2`)).body;
    expect(p1.data.map((r: { name: string }) => r.name)).toEqual(['Cust 4', 'Cust 3']);
    const p2 = (
      await get(t, `/v2/broadcasts/${b.uuid}/recipients?limit=2&cursor=${p1.page.nextCursor}`)
    ).body;
    expect(p2.data.map((r: { name: string }) => r.name)).toEqual(['Cust 2', 'Cust 1']);
  });

  it('shows the error and the timestamps, and the clicks on the broadcast links', async () => {
    const t = await api.signup('r3');
    const b = await broadcast(t);
    const r = await recipient(t, b.id, {
      status: 'failed',
      error: '(#131026) undeliverable',
      sentAt: '2026-10-02T03:45:00Z',
    });
    await h.owner.query(
      `INSERT INTO wa_link_clicks (org_id, token, original_url, broadcast_id, contact_id, clicks, last_click_at) VALUES ($1,'tok1','https://x.test',$2,$3,3,'2026-10-02T05:00:00Z')`,
      [t.orgId, b.id, r.contact],
    );
    const row = (await get(t, `/v2/broadcasts/${b.uuid}/recipients`)).body.data[0];
    expect(row).toMatchObject({
      status: 'failed',
      error: '(#131026) undeliverable',
      sentAt: '2026-10-02T03:45:00.000Z',
      clicks: 3,
      lastClickAt: '2026-10-02T05:00:00.000Z',
    });
    expect(row.contactId).toBe(r.uuid);
  });
});

describe('WD-BCAST-035, 036: live counters and statistics', () => {
  it('moves while the broadcast is in flight and stops when it is over', async () => {
    const t = await api.signup('v1');
    const b = await broadcast(t, { status: 'processing', total: 4 });
    for (const status of ['sent', 'delivered', 'pending', 'pending'])
      await recipient(t, b.id, { status });
    const live = (await get(t, `/v2/broadcasts/${b.uuid}/live`)).body;
    expect(live).toMatchObject({
      status: 'processing',
      total: 4,
      sent: 2,
      delivered: 1,
      queued: 2,
      inFlight: true,
    });
    expect(live.pct).toMatchObject({ sent: 50, delivered: 25 });
    expect(new Date(live.fetchedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    await h.owner.query(`UPDATE broadcasts SET status = 'completed' WHERE id = $1`, [b.id]);
    expect((await get(t, `/v2/broadcasts/${b.uuid}/live`)).body.inFlight).toBe(false);
  });

  it('the statistics are the same cascade, with the recipients being sent', async () => {
    const t = await api.signup('v2');
    const b = await broadcast(t, { total: 5 });
    for (const status of ['processing', 'sent', 'read', 'failed', 'pending'])
      await recipient(t, b.id, { status });
    expect((await get(t, `/v2/broadcasts/${b.uuid}/statistics`)).body).toEqual({
      sent: 2,
      delivered: 1,
      read: 1,
      failed: 1,
      processing: 1,
      queued: 1,
    });
  });
});
