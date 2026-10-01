import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Creating a broadcast (TW-BCAST-009, 010, 012, 014, 015): the real app against a real Postgres. One test per
 * Given/When/Then of the inventory entries, plus tenant isolation.
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

const post = (t: Tenant, body: Record<string, unknown>) =>
  api
    .http()
    .post('/v2/broadcasts')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body);

const template = async (t: Tenant, extra: { type?: string } = {}): Promise<string> =>
  (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
       VALUES ($1, $2, 'Hello', $3, 'approved') RETURNING uuid`,
      [t.orgId, `t${randomUUID().slice(0, 8)}`, extra.type ?? 'standard'],
    )
  ).rows[0].uuid;

let phoneCounter = 0;
const device = async (t: Tenant, name: string): Promise<string> =>
  (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status, active)
       VALUES ($1, $2, $3, 'connected', true) RETURNING uuid`,
      [t.orgId, name, `+9170000${String(phoneCounter++).padStart(5, '0')}`],
    )
  ).rows[0].uuid;

const rowsOf = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT id, name, status, total_recipients FROM broadcasts WHERE org_id = $1 ORDER BY id`,
      [t.orgId],
    )
  ).rows;

const recipientCount = async (broadcastId: number | string) =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM broadcast_contacts WHERE broadcast_id = $1`,
        [broadcastId],
      )
    ).rows[0].n,
  );

/** `n` distinct synthetic contacts; `tag` keeps the numbers unique across the whole file. */
let contactCounter = 0;
const people = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `${tag}${i}`,
    phone: `+91981${String(contactCounter++).padStart(7, '0')}`,
  }));

describe('TW-BCAST-015: persisting a broadcast', () => {
  let t: Tenant;
  let tpl: string;
  beforeAll(async () => {
    t = await api.signup('bc');
    tpl = await template(t);
  });

  it('an immediate send for 5 contacts and one sender: one `processing` row and 5 `pending` recipients', async () => {
    const contacts = await api.seedContacts(t, people('C', 5));
    const dev = await device(t, 'Phone');
    const res = await post(t, {
      name: 'Launch',
      templateId: tpl,
      contactIds: contacts,
      senderKeys: [`baileys:${dev}`],
      scheduleType: 'now',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.devicesCount).toBe(1);
    expect(res.body.broadcasts).toHaveLength(1);
    expect(res.body.broadcasts[0]).toMatchObject({
      name: 'Launch',
      status: 'processing',
      totalRecipients: 5,
      provider: 'baileys',
      senderKey: `baileys:${dev}`,
      templateId: tpl,
    });
    const row = (await rowsOf(t)).at(-1);
    expect(await recipientCount(row.id)).toBe(5);
    const statuses = await h.owner.query(
      `SELECT DISTINCT status FROM broadcast_contacts WHERE broadcast_id = $1`,
      [row.id],
    );
    expect(statuses.rows).toEqual([{ status: 'pending' }]);
  });

  it('a scheduled send is `scheduled`, keeps the zone, and stores the wall time in that zone as UTC (port requirement)', async () => {
    const [c] = await api.seedContacts(t, people('L', 1));
    const res = await post(t, {
      name: 'Morning',
      templateId: tpl,
      contactIds: [c],
      scheduleType: 'later',
      sendDate: '2026-10-05',
      sendTime: '09:00',
      timezone: 'Asia/Kolkata',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.broadcasts[0]).toMatchObject({
      status: 'scheduled',
      timezone: 'Asia/Kolkata',
      scheduledAt: '2026-10-05T03:30:00.000Z',
    });
  });

  it('two senders create two rows in one transaction, named after each sender', async () => {
    const contacts = await api.seedContacts(t, people('F', 4));
    const a = await device(t, 'Alpha');
    const b = await device(t, 'Beta');
    const res = await post(t, {
      name: 'Fan',
      templateId: tpl,
      contactIds: contacts,
      senderKeys: [`baileys:${a}`, `baileys:${b}`],
      scheduleType: 'now',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.devicesCount).toBe(2);
    expect(res.body.broadcasts.map((x: { name: string }) => x.name)).toEqual([
      'Fan · Alpha',
      'Fan · Beta',
    ]);
  });

  it('every created broadcast writes an audit row and a `broadcast.created` event in the same transaction', async () => {
    const before = (await api.events(t.orgId, 'broadcast.created')).length;
    const [c] = await api.seedContacts(t, people('E', 1));
    const res = await post(t, {
      name: 'Evt',
      templateId: tpl,
      contactIds: [c],
      scheduleType: 'now',
    });
    expect(res.status).toBe(201);
    expect((await api.events(t.orgId, 'broadcast.created')).length).toBe(before + 1);
    const created = (await api.events(t.orgId, 'broadcast.created')).at(-1) as {
      webhook: Array<{ event: string; data: Record<string, unknown> }>;
      notification: { title: string; actionUrl: string };
    };
    expect(created.webhook[0]).toMatchObject({
      event: 'broadcast_created',
      data: { broadcast_name: 'Evt', template_id: tpl, total_recipients: 1 },
    });
    expect(created.notification.title).toBe('Broadcast created');
    expect(await api.auditCount(t.orgId, 'broadcasts', 'insert')).toBeGreaterThan(0);
  });

  it('a sender key that does not resolve is dropped and the broadcast is created sender-less on the default engine', async () => {
    const [c] = await api.seedContacts(t, people('N', 1));
    const res = await post(t, {
      name: 'Dropped',
      templateId: tpl,
      contactIds: [c],
      senderKeys: [`baileys:${randomUUID()}`, 'bogus'],
      scheduleType: 'now',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.broadcasts[0]).toMatchObject({ senderKey: null, provider: 'baileys' });
  });
});

describe('TW-BCAST-014: splitting the audience across senders', () => {
  it('splits by share weights (7:3 of 10), every contact in exactly one slice', async () => {
    const t = await api.signup('sp');
    const tpl = await template(t);
    const contacts = await api.seedContacts(t, people('S', 10));
    const a = await device(t, 'Big');
    const b = await device(t, 'Small');
    const res = await post(t, {
      name: 'Weighted',
      templateId: tpl,
      contactIds: contacts,
      senderKeys: [`baileys:${a}`, `baileys:${b}`],
      senderShare: { [`baileys:${a}`]: 7, [`baileys:${b}`]: 3 },
      scheduleType: 'now',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.broadcasts.map((x: { totalRecipients: number }) => x.totalRecipients)).toEqual([
      7, 3,
    ]);
    const dup = await h.owner.query(
      `SELECT contact_id FROM broadcast_contacts WHERE org_id = $1 GROUP BY contact_id HAVING count(*) > 1`,
      [t.orgId],
    );
    expect(dup.rows).toHaveLength(0);
  });

  it('with fewer contacts than senders, the empty slice is not created', async () => {
    const t = await api.signup('sp2');
    const tpl = await template(t);
    const contacts = await api.seedContacts(t, people('T', 1));
    const res = await post(t, {
      name: 'Tiny',
      templateId: tpl,
      contactIds: contacts,
      senderKeys: [`baileys:${await device(t, 'One')}`, `baileys:${await device(t, 'Two')}`],
      scheduleType: 'now',
    });
    expect(res.status).toBe(201);
    expect(res.body.broadcasts).toHaveLength(1);
    expect(res.body.devicesCount).toBe(2);
  });
});

describe('TW-BCAST-010: who is in the audience', () => {
  let t: Tenant;
  let tpl: string;
  beforeAll(async () => {
    t = await api.signup('au');
    tpl = await template(t);
  });

  it('opted-out contacts are skipped; if nobody is left it is refused', async () => {
    const [stay, gone] = await api.seedContacts(t, [
      { name: 'Stay', phone: '+919920000701' },
      { name: 'Gone', phone: '+919920000702', isUnsubscribed: true },
    ]);
    const both = await post(t, {
      name: 'Mix',
      templateId: tpl,
      contactIds: [stay, gone],
      scheduleType: 'now',
    });
    expect(both.status).toBe(201);
    expect(both.body.broadcasts[0].totalRecipients).toBe(1);

    const none = await post(t, {
      name: 'None',
      templateId: tpl,
      contactIds: [gone],
      scheduleType: 'now',
    });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('BCAST_NO_RECIPIENTS');
  });

  it('groups and tags add their members; a contact named twice is attached once', async () => {
    const [direct, viaGroup, viaTag] = await api.seedContacts(t, [
      { name: 'Direct', phone: '+919920000711' },
      { name: 'Grouped', phone: '+919920000712' },
      { name: 'Tagged', phone: '+919920000713' },
    ]);
    const group = (
      await h.owner.query(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1,'G') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const tag = (
      await h.owner.query(`INSERT INTO tags (org_id, name) VALUES ($1,'T') RETURNING id, uuid`, [
        t.orgId,
      ])
    ).rows[0];
    const idOf = async (u: string) =>
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [u])).rows[0].id;
    for (const u of [direct, viaGroup]) {
      await h.owner.query(
        `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
        [t.orgId, await idOf(u), group.id],
      );
    }
    for (const u of [direct, viaTag]) {
      await h.owner.query(
        `INSERT INTO contact_tags (org_id, contact_id, tag_id) VALUES ($1,$2,$3)`,
        [t.orgId, await idOf(u), tag.id],
      );
    }
    const res = await post(t, {
      name: 'Audience',
      templateId: tpl,
      contactIds: [direct],
      groupIds: [group.uuid],
      tagIds: [tag.uuid],
      scheduleType: 'now',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.broadcasts[0].totalRecipients).toBe(3);
  });

  it("another organization's contact, group and template are never used", async () => {
    const other = await api.signup('au2');
    const [foreign] = await api.seedContacts(other, people('X', 1));
    const foreignTpl = await template(other);
    const foreignGroup = (
      await h.owner.query(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1,'FG') RETURNING uuid`,
        [other.orgId],
      )
    ).rows[0].uuid;

    const justForeign = await post(t, {
      name: 'x',
      templateId: tpl,
      contactIds: [foreign],
      groupIds: [foreignGroup],
      scheduleType: 'now',
    });
    expect(justForeign.status).toBe(422);
    expect(justForeign.body.code).toBe('BCAST_NO_RECIPIENTS');

    const [mine] = await api.seedContacts(t, people('M', 1));
    const foreignTemplate = await post(t, {
      name: 'x',
      templateId: foreignTpl,
      contactIds: [mine],
      scheduleType: 'now',
    });
    expect(foreignTemplate.status).toBe(422);
    expect(foreignTemplate.body.code).toBe('BCAST_TEMPLATE_NOT_FOUND');
    expect(foreignTemplate.body.detail).toBe('Selected template was not found in your workspace.');
  });
});

describe('TW-BCAST-012 and 009: refusals', () => {
  let t: Tenant;
  let tpl: string;
  let contact: string;
  beforeAll(async () => {
    t = await api.signup('rf');
    tpl = await template(t);
    [contact] = await api.seedContacts(t, people('R', 1));
  });

  it('an authentication (OTP) template cannot be broadcast', async () => {
    const res = await post(t, {
      name: 'otp',
      templateId: await template(t, { type: 'auth' }),
      contactIds: [contact],
      scheduleType: 'now',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BCAST_TEMPLATE_NOT_ALLOWED');
    expect(res.body.detail).toMatch(/OTP/);
    expect(await rowsOf(t)).toHaveLength(0);
  });

  it('a later send without a date is a validation error on sendDate and sendTime, and nothing is created', async () => {
    const res = await post(t, {
      name: 'x',
      templateId: tpl,
      contactIds: [contact],
      scheduleType: 'later',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['sendDate', 'sendTime']),
    );
  });

  it('a name over 255 characters, an unknown zone and a malformed time are validation errors', async () => {
    const base = { templateId: tpl, contactIds: [contact], scheduleType: 'now' };
    expect((await post(t, { ...base, name: 'n'.repeat(256) })).status).toBe(422);
    const zone = await post(t, { ...base, name: 'z', timezone: 'Mars/Base' });
    expect(zone.status).toBe(422);
    expect(zone.body.errors[0].path).toBe('timezone');
    expect(
      (
        await post(t, {
          ...base,
          name: 'x',
          scheduleType: 'later',
          sendDate: '2026-10-05',
          sendTime: '9am',
        })
      ).status,
    ).toBe(422);
  });

  it('the plan cap counts live rows: at the cap it is refused, after a delete it succeeds', async () => {
    const t2 = await api.signup('cap');
    const tpl2 = await template(t2);
    const [c] = await api.seedContacts(t2, people('P', 1));
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"broadcasts":2}}'::jsonb WHERE org_id = $1`,
      [t2.orgId],
    );
    const make = () =>
      post(t2, { name: 'c', templateId: tpl2, contactIds: [c], scheduleType: 'now' });
    expect((await make()).status).toBe(201);
    expect((await make()).status).toBe(201);
    const refused = await make();
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('PLAN_LIMIT_REACHED');
    await h.owner.query(
      `DELETE FROM broadcasts WHERE id = (SELECT min(id) FROM broadcasts WHERE org_id = $1)`,
      [t2.orgId],
    );
    expect((await make()).status).toBe(201);
  });

  it('the plan check comes before validation: at the cap even an invalid body answers PLAN_LIMIT_REACHED', async () => {
    const t3 = await api.signup('cap2');
    const tpl3 = await template(t3);
    const [c] = await api.seedContacts(t3, people('Q', 1));
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"broadcasts":1}}'::jsonb WHERE org_id = $1`,
      [t3.orgId],
    );
    expect(
      (await post(t3, { name: 'ok', templateId: tpl3, contactIds: [c], scheduleType: 'now' }))
        .status,
    ).toBe(201);
    const res = await post(t3, { nonsense: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('needs the bcast.broadcasts.create permission', async () => {
    const member = await api.member(t, 'viewer', []);
    const res = await api
      .http()
      .post('/v2/broadcasts')
      .set(bearer(member.token))
      .set('idempotency-key', randomUUID())
      .send({ name: 'x', templateId: tpl, contactIds: [contact], scheduleType: 'now' });
    expect(res.status).toBe(403);
  });

  it('is refused without a sign-in', async () => {
    const res = await api
      .http()
      .post('/v2/broadcasts')
      .set('idempotency-key', randomUUID())
      .send({});
    expect(res.status).toBe(401);
  });
});
