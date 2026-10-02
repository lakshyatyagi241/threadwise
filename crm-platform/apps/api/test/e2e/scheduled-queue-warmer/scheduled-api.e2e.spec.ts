import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScheduleProducerService } from '../../../src/modules/scheduled-queue-warmer';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Scheduled messages and the warmer through the real API (TW-SCHED-001 to 019, 036 to 041): the gates and their order, the audience,
 * the multi-sender split, the warmer's budget reservation and its release, the lifecycle, and isolation. Real Postgres and Redis.
 */
let h: Harness;
let api: Api;
let n = 0;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

const FUTURE = '2031-03-10';

/** A workspace with `count` connected devices. */
async function arrange(label: string, count = 1) {
  const t: Tenant = await api.signup(label);
  const devices: Array<{ id: number; uuid: string; key: string }> = [];
  for (let i = 0; i < count; i++) {
    const r = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
         VALUES ($1, $2, '+91', $3, 'connected', true) RETURNING id, uuid`,
        [t.orgId, `Phone ${i + 1}`, `98111${String(10000 + n++)}`],
      )
    ).rows[0];
    devices.push({ id: Number(r.id), uuid: r.uuid, key: `baileys:${r.uuid}` });
  }
  return { t, devices };
}
const numbers = (k: number) =>
  Array.from({ length: k }, (_, i) => `+9198222${String(10000 + n++ + i)}`);
const body = (senders: string[], over: Record<string, unknown> = {}) => ({
  name: 'Diwali offer',
  scheduleType: 'once',
  sendDate: FUTURE,
  sendTime: '10:30',
  timezone: 'UTC',
  senders,
  messageType: 'plain',
  message: 'Hello {{name}}',
  recipientType: 'number',
  numbers: numbers(3),
  ...over,
});
const post = (t: Tenant, path: string, b: unknown = {}) =>
  api
    .as(t.admin)
    .post(path)
    .set('idempotency-key', `k${Math.random()}`)
    .send(b as object);
const get = (t: Tenant, path: string) => api.as(t.admin).get(path);
const row = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM scheduled_messages WHERE uuid = $1`, [uuid])).rows[0];
const ledger = async (deviceId: number, day = FUTURE) =>
  Number(
    (
      await h.owner.query(
        `SELECT count FROM warmer_daily_sends WHERE engine = 'baileys' AND device_id = $1 AND day = $2::date`,
        [deviceId, day],
      )
    ).rows[0]?.count ?? 0,
  );

describe('creating a schedule (TW-SCHED-003)', () => {
  it('saves it for typed numbers, with one pending recipient row each, and the list and detail show it', async () => {
    const { t, devices } = await arrange('sa1');
    const list = numbers(3);
    const res = await post(t, '/v2/scheduled', body([devices[0]!.key], { numbers: list }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      sendersCount: 1,
      totalRecipients: 3,
      message: 'Schedule created.',
    });
    const r = await row(res.body.ids[0]);
    expect(r).toMatchObject({
      status: 'scheduled',
      provider: 'baileys',
      template_type: 'text',
      total_recipients: 3,
      timezone: 'UTC',
    });
    expect(new Date(r.next_run_at).toISOString()).toBe('2031-03-10T10:30:00.000Z');
    expect(r.from_number).toBe(
      `91${(await h.owner.query(`SELECT phone_number FROM devices WHERE id = $1`, [devices[0]!.id])).rows[0].phone_number}`,
    );

    const l = await get(t, '/v2/scheduled');
    expect(l.body.stats).toMatchObject({ all: 1, upcoming: 1, running: 0, completed: 0 });
    expect(l.body.items[0]).toMatchObject({
      name: 'Diwali offer',
      status: 'scheduled',
      totalRecipients: 3,
      senderLabel: 'Phone 1',
    });
    expect(l.body.upNext.id).toBe(res.body.ids[0]);
    const d = await get(t, `/v2/scheduled/${res.body.ids[0]}`);
    expect(d.body.breakdown).toEqual({ pending: 3 });
    expect(d.body.recipients).toHaveLength(3);
    const s = await get(t, '/v2/scheduled?tab=upcoming&q=diwali');
    expect(s.body.total).toBe(1);
    expect((await get(t, '/v2/scheduled?tab=failed')).body.total).toBe(0);
  });

  it('refuses a time under 2 minutes ahead, a bad zone, an empty audience, a forged sender and an empty message, and creates nothing', async () => {
    const { t, devices } = await arrange('sa2');
    const k = devices[0]!.key;
    const soon = new Date(Date.now() + 60_000);
    const date = soon.toISOString().slice(0, 10);
    const time = soon.toISOString().slice(11, 16);
    const bad = [
      [body([k], { sendDate: date, sendTime: time }), /2 minutes/],
      [body([k], { timezone: 'Mars/Phobos' }), /timezone/i],
      [
        body([k], { recipientType: 'number', numbers: ['12345', 'call me'] }),
        /recipients are empty/,
      ],
      [
        body([k], { recipientType: 'group', groupIds: ['00000000-0000-4000-8000-000000000000'] }),
        /recipients are empty/,
      ],
      [body(['baileys:00000000-0000-4000-8000-000000000000']), /No valid senders/],
      [body([k], { message: '   ' }), /Write the message/],
      [body([k], { scheduleType: 'recurring', repeatInterval: 'weekly' }), /days of the week/],
    ] as const;
    for (const [b, re] of bad) {
      const res = await post(t, '/v2/scheduled', b);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toMatch(re);
    }
    expect((await get(t, '/v2/scheduled')).body.total).toBe(0);
  });

  it("leaves out opted-out contacts, whichever audience names them, and counts a person once (Reference's gap, fixed)", async () => {
    const { t, devices } = await arrange('sa3');
    const [asha, ravi, out] = await api.seedContacts(t, [
      { name: 'Asha', phone: '+919822000001' },
      { name: 'Ravi', phone: '+919822000002' },
      { name: 'Opted out', phone: '+919822000003', isUnsubscribed: true },
    ]);
    const g1 = (
      await h.owner.query(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1, 'VIP') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const g2 = (
      await h.owner.query(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1, 'Newsletter') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    for (const [g, uuid] of [
      [g1, asha],
      [g1, ravi],
      [g1, out],
      [g2, asha],
    ] as const) {
      await h.owner.query(
        `INSERT INTO contact_group_members (org_id, group_id, contact_id) SELECT $1, $2, id FROM contacts WHERE uuid = $3`,
        [t.orgId, g.id, uuid],
      );
    }
    const res = await post(
      t,
      '/v2/scheduled',
      body([devices[0]!.key], {
        recipientType: 'group',
        groupIds: [g1.uuid, g2.uuid],
        numbers: undefined,
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.totalRecipients).toBe(2);
    const d = await get(t, `/v2/scheduled/${res.body.ids[0]}`);
    expect(d.body.recipients.map((r: { phone: string }) => r.phone).sort()).toEqual([
      '919822000001',
      '919822000002',
    ]);
    // A typed number that belongs to an opted-out contact is honoured too.
    const typed = await post(
      t,
      '/v2/scheduled',
      body([devices[0]!.key], { numbers: ['+919822000003', '+919822000009'] }),
    );
    expect(typed.body.totalRecipients).toBe(1);
    const preview = await post(t, '/v2/scheduled/audience-preview', {
      recipientType: 'group',
      groupIds: [g1.uuid],
    });
    expect(preview.body).toMatchObject({ total: 2, optedOut: 1 });
  });

  it('splits the audience between senders, one person to one sender, and names each schedule after its sender (TW-SCHED-005)', async () => {
    const { t, devices } = await arrange('sa4', 3);
    const res = await post(
      t,
      '/v2/scheduled',
      body(
        devices.map((d) => d.key),
        { numbers: numbers(9) },
      ),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      sendersCount: 3,
      totalRecipients: 9,
      message: '3 schedules created across 3 senders.',
    });
    const rows = await Promise.all(res.body.ids.map(row));
    expect(rows.map((r) => r.total_recipients)).toEqual([3, 3, 3]);
    expect(rows.map((r) => r.schedule_name).sort()).toEqual([
      'Diwali offer (Phone 1)',
      'Diwali offer (Phone 2)',
      'Diwali offer (Phone 3)',
    ]);
    const all = (
      await h.owner.query(`SELECT phone FROM scheduled_message_contacts WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows.map((r) => r.phone);
    expect(new Set(all).size).toBe(9);
  });
});

describe('plan gates and permissions (TW-SCHED-019)', () => {
  it('a plan without scheduled messages is refused, and the limit counts every schedule and frees a slot on delete', async () => {
    const { t, devices } = await arrange('sa5');
    const k = devices[0]!.key;
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"scheduled_messages":false}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const off = await post(t, '/v2/scheduled', body([k]));
    expect(off.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(off.body)).toMatch(/Scheduled messages|plan/i);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"scheduled_messages":1}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const first = await post(t, '/v2/scheduled', body([k]));
    expect(first.status).toBe(201);
    const second = await post(t, '/v2/scheduled', body([k]));
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect((await post(t, `/v2/scheduled/${first.body.ids[0]}/cancel`)).status).toBe(200);
    // The cap is a live count of every status: only deleting frees the slot.
    expect((await post(t, '/v2/scheduled', body([k]))).status).toBeGreaterThanOrEqual(400);
    expect((await api.as(t.admin).delete(`/v2/scheduled/${first.body.ids[0]}`)).status).toBe(204);
    expect((await post(t, '/v2/scheduled', body([k]))).status).toBe(201);
  });

  it('only a role holding the key may read or change schedules', async () => {
    const { t, devices } = await arrange('sa6');
    const reader = await api.member(t, 'reader', [['sched.schedules.read']]);
    const nobody = await api.member(t, 'nobody', []);
    const created = await post(t, '/v2/scheduled', body([devices[0]!.key]));
    const asReader = (m: 'get' | 'post', path: string, b?: object) =>
      api
        .http()
        [m](path)
        .set('authorization', `Bearer ${reader.token}`)
        .set('idempotency-key', `k${Math.random()}`)
        .send(b ?? {});
    expect((await asReader('get', '/v2/scheduled')).status).toBe(200);
    expect((await asReader('post', '/v2/scheduled', body([devices[0]!.key]))).status).toBe(403);
    expect((await asReader('post', `/v2/scheduled/${created.body.ids[0]}/cancel`)).status).toBe(
      403,
    );
    expect(
      (await api.http().get('/v2/scheduled').set('authorization', `Bearer ${nobody.token}`)).status,
    ).toBe(403);
  });

  it("another workspace's schedule is a 404 for every action", async () => {
    const a = await arrange('sa7a');
    const b = await api.signup('sa7b');
    const made = await post(a.t, '/v2/scheduled', body([a.devices[0]!.key]));
    const id = made.body.ids[0];
    for (const res of [
      await get(b, `/v2/scheduled/${id}`),
      await post(b, `/v2/scheduled/${id}/pause`),
      await post(b, `/v2/scheduled/${id}/cancel`),
      await post(b, `/v2/scheduled/${id}/run-now`),
      await api.as(b.admin).delete(`/v2/scheduled/${id}`),
    ]) {
      expect(res.status).toBe(404);
    }
    expect((await row(id)).status).toBe('scheduled');
  });
});

describe('the warmer (TW-SCHED-008, 036 to 041)', () => {
  const profile = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    dailyBase: 20,
    stepPct: 0,
    stepDays: 1,
    maxDaily: 20,
    gapMin: 1,
    gapMax: 2,
    activeStart: 0,
    activeEnd: 0,
    spintax: false,
    ...over,
  });

  it('lists every number with its budget and health, and keeps the ramp start when a profile is saved again', async () => {
    const { t, devices } = await arrange('sw1');
    const before = await get(t, '/v2/warmer');
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.items).toHaveLength(1);
    expect(before.body.items[0]).toMatchObject({
      key: devices[0]!.key,
      engine: 'baileys',
      budget: 20,
      sentToday: 0,
    });
    expect(before.body.items[0].health).toBeGreaterThan(0);
    const saved = await api
      .as(t.admin)
      .put(`/v2/warmer/${devices[0]!.key}`)
      .send(profile({ dailyBase: 5, maxDaily: 50 }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ budget: 5, profile: { enabled: true, dailyBase: 5 } });
    const started = saved.body.startedAt;
    expect(started).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await h.owner.query(
      `UPDATE devices SET warmer_config = jsonb_set(warmer_config, '{startedAt}', '"2020-01-01"') WHERE id = $1`,
      [devices[0]!.id],
    );
    const again = await api
      .as(t.admin)
      .put(`/v2/warmer/${devices[0]!.key}`)
      .send(profile({ dailyBase: 6, maxDaily: 50 }));
    expect(again.body.startedAt).toBe('2020-01-01');
    expect(
      (
        await api
          .as(t.admin)
          .put(`/v2/warmer/${devices[0]!.key}`)
          .send(profile({ dailyBase: 30, maxDaily: 10 }))
      ).status,
    ).toBe(422);
  });

  it("holds a send that does not fit the day's budget, reserves one that does, and gives the reservation back on cancel", async () => {
    const { t, devices } = await arrange('sw2');
    const d = devices[0]!;
    await api.as(t.admin).put(`/v2/warmer/${d.key}`).send(profile());
    const first = await post(t, '/v2/scheduled', body([d.key], { numbers: numbers(15) }));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(await ledger(d.id)).toBe(15);
    const held = await post(t, '/v2/scheduled', body([d.key], { numbers: numbers(10) }));
    expect(held.status).toBe(422);
    expect(JSON.stringify(held.body)).toMatch(/only 5 of its 20-message budget/);
    expect(await ledger(d.id)).toBe(15);
    const fits = await post(t, '/v2/scheduled', body([d.key], { numbers: numbers(5) }));
    expect(fits.status).toBe(201);
    expect(await ledger(d.id)).toBe(20);
    const full = await post(t, '/v2/scheduled', body([d.key], { numbers: numbers(1) }));
    expect(JSON.stringify(full.body)).toMatch(/already reserved/);

    expect((await post(t, `/v2/scheduled/${first.body.ids[0]}/cancel`)).status).toBe(200);
    expect(await ledger(d.id)).toBe(5);
    expect((await api.as(t.admin).delete(`/v2/scheduled/${fits.body.ids[0]}`)).status).toBe(204);
    expect(await ledger(d.id)).toBe(0);
  });

  it('does not reserve for a recurring schedule or for a number that is not warming', async () => {
    const { t, devices } = await arrange('sw3', 2);
    await api.as(t.admin).put(`/v2/warmer/${devices[0]!.key}`).send(profile());
    const recurring = await post(
      t,
      '/v2/scheduled',
      body([devices[0]!.key], {
        scheduleType: 'recurring',
        repeatInterval: 'daily',
        numbers: numbers(40),
      }),
    );
    expect(recurring.status, JSON.stringify(recurring.body)).toBe(201);
    expect(await ledger(devices[0]!.id)).toBe(0);
    const plain = await post(
      t,
      '/v2/scheduled',
      body([devices[1]!.key], { numbers: numbers(500) }),
    );
    expect(plain.status).toBe(201);
    expect(await ledger(devices[1]!.id)).toBe(0);
  });

  it('is behind the plan flag and the warmer permission', async () => {
    const { t } = await arrange('sw4');
    const member = await api.member(t, 'sched-only', [['sched.schedules.manage']]);
    expect(
      (await api.http().get('/v2/warmer').set('authorization', `Bearer ${member.token}`)).status,
    ).toBe(403);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"whatsapp_warmer":false}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    expect((await get(t, '/v2/warmer')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('what a person does to a schedule (TW-SCHED-013 to 018)', () => {
  it('pauses, resumes, runs now, edits with a version check, and refuses the wrong status', async () => {
    const { t, devices } = await arrange('sl1');
    const made = await post(t, '/v2/scheduled', body([devices[0]!.key]));
    const id = made.body.ids[0];
    expect((await post(t, `/v2/scheduled/${id}/resume`)).status).toBe(409);
    expect((await post(t, `/v2/scheduled/${id}/pause`)).body.status).toBe('paused');
    expect((await post(t, `/v2/scheduled/${id}/pause`)).status).toBe(409);
    expect((await post(t, `/v2/scheduled/${id}/resume`)).body.status).toBe('scheduled');

    const detail = (await get(t, `/v2/scheduled/${id}`)).body;
    const edited = await api
      .as(t.admin)
      .patch(`/v2/scheduled/${id}`)
      .send({ name: 'Renamed', sendTime: '4:15 PM', rowVersion: detail.rowVersion });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ name: 'Renamed', sendTime: '16:15' });
    expect(new Date(edited.body.nextRunAt).toISOString()).toBe('2031-03-10T16:15:00.000Z');
    const stale = await api
      .as(t.admin)
      .patch(`/v2/scheduled/${id}`)
      .send({ name: 'Again', rowVersion: detail.rowVersion });
    expect(stale.status).toBe(409);
    const tooSoon = await api
      .as(t.admin)
      .patch(`/v2/scheduled/${id}`)
      .send({ sendDate: '2020-01-01', rowVersion: edited.body.rowVersion });
    expect(tooSoon.status).toBe(422);

    const now = await post(t, `/v2/scheduled/${id}/run-now`);
    expect(now.status).toBe(200);
    expect(new Date((await row(id)).next_run_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('cancels, will not cancel twice, retries a failed schedule with failed recipients only, and deletes', async () => {
    const { t, devices } = await arrange('sl2');
    const made = await post(t, '/v2/scheduled', body([devices[0]!.key], { numbers: numbers(3) }));
    const id = made.body.ids[0];
    expect((await post(t, `/v2/scheduled/${id}/cancel`)).body.status).toBe('cancelled');
    expect((await post(t, `/v2/scheduled/${id}/cancel`)).status).toBe(409);
    expect((await post(t, `/v2/scheduled/${id}/run-now`)).status).toBe(409);

    // A failed run: one recipient sent, two failed.
    const r = await row(id);
    await h.owner.query(
      `UPDATE scheduled_messages SET status = 'failed', last_error = 'boom', failure_reason = 'boom', failed_at = now() WHERE id = $1`,
      [r.id],
    );
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET status = CASE WHEN id = (SELECT min(id) FROM scheduled_message_contacts WHERE scheduled_message_id = $1) THEN 'sent' ELSE 'failed' END, error_message = 'x' WHERE scheduled_message_id = $1`,
      [r.id],
    );
    const retry = await post(t, `/v2/scheduled/${id}/retry`, {
      sendDate: FUTURE,
      sendTime: '09:00',
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body).toMatchObject({ status: 'scheduled', lastError: null, sendAttempts: 0 });
    expect(retry.body.breakdown).toEqual({ sent: 1, pending: 2 });
    expect(
      (await post(t, `/v2/scheduled/${id}/retry`, { sendDate: '2020-01-01', sendTime: '09:00' }))
        .status,
    ).toBe(422);

    expect((await api.as(t.admin).delete(`/v2/scheduled/${id}`)).status).toBe(204);
    expect((await get(t, `/v2/scheduled/${id}`)).status).toBe(404);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM scheduled_message_contacts WHERE scheduled_message_id = $1`,
          [r.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('offers the composer its pickers: connected senders with their warm state, groups, tags and the lead time', async () => {
    const { t, devices } = await arrange('sl3', 2);
    await api.as(t.admin).put(`/v2/warmer/${devices[1]!.key}`).send({
      enabled: true,
      dailyBase: 10,
      stepPct: 0,
      stepDays: 1,
      maxDaily: 10,
      gapMin: 1,
      gapMax: 2,
      activeStart: 0,
      activeEnd: 0,
      spintax: false,
    });
    const o = (await get(t, '/v2/scheduled/options')).body;
    expect(o.minLeadMinutes).toBe(2);
    expect(o.senders.map((s: { key: string; warming: boolean }) => [s.key, s.warming])).toEqual([
      [devices[0]!.key, false],
      [devices[1]!.key, true],
    ]);
    expect(o.groups).toEqual([]);
  });
});

describe('schedules made by other domains (TW-SCHED-030)', () => {
  it('writes an ordinary, visible schedule labelled with its source, and a second call under the same key replaces it', async () => {
    const { t } = await arrange('sp1');
    const producer = h.app.get(ScheduleProducerService);
    const at = new Date(Date.now() + 3_600_000);
    const first = await producer.produce({
      orgId: t.orgId,
      key: 'cart:42',
      source: 'cart_recovery',
      name: 'Cart recovery · Acme',
      phones: ['+919822100001', 'not a number', '+919822100001'],
      message: 'You left something behind',
      runAt: at,
    });
    expect(first.replaced).toBe(false);
    const list = (await get(t, '/v2/scheduled')).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      name: 'Cart recovery · Acme',
      source: 'cart_recovery',
      status: 'scheduled',
      totalRecipients: 1,
    });

    const again = await producer.produce({
      orgId: t.orgId,
      key: 'cart:42',
      source: 'cart_recovery',
      name: 'Cart recovery · Acme',
      phones: ['+919822100001'],
      message: 'Still there?',
      runAt: new Date(at.getTime() + 3_600_000),
    });
    expect(again.replaced).toBe(true);
    const after = (await get(t, '/v2/scheduled')).body;
    expect(after.stats).toMatchObject({ all: 2, upcoming: 1, failed: 1 });
    expect((await row(first.id)).status).toBe('cancelled');
    expect((await row(again.id)).message_content).toBe('Still there?');

    expect(await producer.cancel(t.orgId, 'cart:42')).toBe(true);
    expect(await producer.cancel(t.orgId, 'cart:42')).toBe(false);
    expect((await row(again.id)).status).toBe('cancelled');
  });

  it('refuses a send with no valid number, no message or no connected sender', async () => {
    const { t } = await arrange('sp2');
    const bare = await api.signup('sp3');
    const producer = h.app.get(ScheduleProducerService);
    const base = {
      orgId: t.orgId,
      key: 'k',
      source: 'appointment_reminder',
      name: 'Reminder',
      phones: ['+919822100002'],
      message: 'See you at 4',
      runAt: new Date(Date.now() + 3_600_000),
    };
    await expect(producer.produce({ ...base, phones: ['abc'] })).rejects.toThrow(/valid phone/);
    await expect(producer.produce({ ...base, message: '  ' })).rejects.toThrow(/empty/);
    await expect(producer.produce({ ...base, orgId: bare.orgId })).rejects.toThrow(
      /connected number/,
    );
  });
});
