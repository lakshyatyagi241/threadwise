import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { BroadcastDispatchService } from '../../../src/modules/broadcasts/broadcast-dispatch.service';
import { BroadcastProgressService } from '../../../src/modules/broadcasts/broadcast-progress.service';
import { BroadcastResumeService } from '../../../src/modules/broadcasts/broadcast-resume.service';
import {
  EngineSenderRegistry,
  type OutgoingMessage,
} from '../../../src/modules/broadcasts/engine-senders';
import { PacingRuntime } from '../../../src/modules/broadcasts/send-safety';
import { SendWindowService } from '../../../src/modules/compliance-center';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Quiet hours at the broadcast sender (BL-177): a marketing broadcast DEFERS the recipients whose local time is inside the workspace's
 * quiet hours (they stay `pending` with the instant they may go), sends everyone else, pauses itself until the first of them opens, and
 * on release asks the ConsentGate again. A utility template is never held. The real app and Postgres; a fixed clock.
 */
let h: Harness;
let api: Api;
let runtime: PacingRuntime;
let window: SendWindowService;
let dispatch: BroadcastDispatchService;
let sweeper: BroadcastResumeService;
let sent: OutgoingMessage[] = [];

/** 2026-10-15 16:00 UTC: 21:30 in India (quiet 21:00 to 09:00), 12:00 in New York (open). */
const EVENING = new Date('2026-10-15T16:00:00Z');
/** The next morning in India, a minute past the end of the quiet hours (09:00 IST = 03:30 UTC). */
const MORNING = new Date('2026-10-16T03:31:00Z');
const OPENS = '2026-10-16T03:30:00.000Z';

const setClock = (d: Date) => {
  runtime.now = () => d;
  window.now = () => d;
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  runtime = h.app.get(PacingRuntime);
  window = h.app.get(SendWindowService);
  dispatch = h.app.get(BroadcastDispatchService);
  sweeper = new BroadcastResumeService(
    h.app.get(DatabaseService),
    h.app.get(BroadcastProgressService),
    h.app.get(OutboxService),
    { isHalted: () => Promise.resolve(false) } as never,
    runtime,
  );
  h.app.get(EngineSenderRegistry).register('baileys', {
    open: () =>
      Promise.resolve({
        send: (m: OutgoingMessage) => {
          sent.push(m);
          return Promise.resolve({ providerMessageId: `wamid.${sent.length}` });
        },
      }),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sent = [];
  runtime.sleep = () => Promise.resolve();
  runtime.random = () => 0.5;
  setClock(EVENING);
});

let counter = 0;
const phone = () => `+91983${String(counter++).padStart(7, '0')}`;

async function arrange(
  label: string,
  contacts: Array<{ name: string; zone?: string; phone?: string }>,
  opts: { category?: string; quietHours?: boolean } = {},
) {
  const t = await api.signup(label);
  const tpl = (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, language, status, category)
       VALUES ($1, 'promo_oct', 'Hello', 'en_US', 'approved', $2) RETURNING uuid`,
      [t.orgId, opts.category ?? 'marketing'],
    )
  ).rows[0].uuid as string;
  const dev = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Main', '+91', '9811100001', 'connected', true) RETURNING uuid`,
      [t.orgId],
    )
  ).rows[0].uuid as string;
  if (opts.quietHours !== false) {
    await h.owner.query(
      `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end)
       VALUES ($1, true, '21:00', '09:00')`,
      [t.orgId],
    );
  }
  const ids = await api.seedContacts(
    t,
    contacts.map((c) => ({
      name: c.name,
      phone: c.phone ?? phone(),
      ...(c.zone ? { data: { timezone: c.zone } } : {}),
    })),
  );
  return { t, tpl, senderKey: `baileys:${dev}`, ids };
}

async function create(a: { t: Tenant; tpl: string; senderKey: string; ids: string[] }) {
  const res = await api
    .http()
    .post('/v2/broadcasts')
    .set(bearer(a.t.admin))
    .set('idempotency-key', randomUUID())
    .send({
      name: 'Promo',
      templateId: a.tpl,
      contactIds: a.ids,
      senderKeys: [a.senderKey],
      scheduleType: 'now',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const uuid = res.body.broadcasts[0].id as string;
  const row = (await h.owner.query(`SELECT id FROM broadcasts WHERE uuid = $1`, [uuid])).rows[0];
  return { uuid, id: Number(row.id) };
}

const run = (t: Tenant, id: number) =>
  RequestContextStore.run(
    { requestId: `qh-${id}`, orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    () => dispatch.run(t.orgId, id),
  );

const rows = async (id: number) =>
  (
    await h.owner.query(
      `SELECT c.name, bc.status, bc.held_until, bc.held_reason, bc.error_message
         FROM broadcast_contacts bc JOIN contacts c ON c.org_id = bc.org_id AND c.id = bc.contact_id
        WHERE bc.broadcast_id = $1 ORDER BY bc.id`,
      [id],
    )
  ).rows as Array<{
    name: string;
    status: string;
    held_until: Date | null;
    held_reason: string | null;
    error_message: string | null;
  }>;

const broadcast = async (id: number) =>
  (await h.owner.query(`SELECT status, messages_log FROM broadcasts WHERE id = $1`, [id])).rows[0];

describe('BL-177: a marketing broadcast is deferred, not denied, in the quiet hours', () => {
  it('sends whoever is awake, holds whoever is in their quiet hours, and pauses until the first opens', async () => {
    const a = await arrange('qh1', [
      { name: 'Asha', zone: 'Asia/Kolkata' },
      { name: 'Ned', zone: 'America/New_York' },
      { name: 'Ravi' }, // no zone: read from the +91 number
    ]);
    const b = await create(a);

    expect(await run(a.t, b.id)).toBe('paused');

    const r = await rows(b.id);
    const byName = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(byName.Ned!.status).toBe('sent');
    expect(byName.Asha).toMatchObject({ status: 'pending', held_reason: 'quiet_hours' });
    expect(byName.Ravi).toMatchObject({ status: 'pending', held_reason: 'quiet_hours' });
    expect(byName.Asha!.held_until!.toISOString()).toBe(OPENS);
    expect(sent).toHaveLength(1);

    const row = await broadcast(b.id);
    expect(row.status).toBe('paused');
    expect(row.messages_log.pause).toMatchObject({ reason: 'quiet_hours', resumeAfter: OPENS });
  });

  it('shows the held count and the reason on the detail, live counters and recipients', async () => {
    const a = await arrange('qh2', [
      { name: 'Asha', zone: 'Asia/Kolkata' },
      { name: 'Ned', zone: 'America/New_York' },
    ]);
    const b = await create(a);
    await run(a.t, b.id);

    const detail = await api.http().get(`/v2/broadcasts/${b.uuid}`).set(bearer(a.t.admin));
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.counts).toMatchObject({ total: 2, sent: 1, queued: 1, held: 1 });
    expect(detail.body.pause).toMatchObject({ reason: 'quiet_hours', resumeAfter: OPENS });

    const live = await api.http().get(`/v2/broadcasts/${b.uuid}/live`).set(bearer(a.t.admin));
    expect(live.body).toMatchObject({ queued: 1, held: 1 });

    const rec = await api.http().get(`/v2/broadcasts/${b.uuid}/recipients`).set(bearer(a.t.admin));
    const held = rec.body.data.find((x: { name: string }) => x.name === 'Asha');
    expect(held).toMatchObject({ status: 'pending', heldUntil: OPENS, heldReason: 'quiet_hours' });
  });

  it('does not resume before the hours open, resumes by itself after, and sends the held recipients', async () => {
    const a = await arrange('qh3', [{ name: 'Asha', zone: 'Asia/Kolkata' }, { name: 'Ravi' }]);
    const b = await create(a);
    expect(await run(a.t, b.id)).toBe('paused');
    expect(sent).toHaveLength(0);

    expect(await sweeper.sweep()).toBe(0); // still the evening
    expect((await broadcast(b.id)).status).toBe('paused');

    setClock(MORNING);
    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(1);
    expect((await broadcast(b.id)).status).toBe('processing');

    expect(await run(a.t, b.id)).toBe('finished');
    expect(sent).toHaveLength(2);
    const r = await rows(b.id);
    expect(r.map((x) => x.status)).toEqual(['sent', 'sent']);
    expect(r.every((x) => x.held_until === null)).toBe(true);
    expect((await broadcast(b.id)).status).toBe('completed');
  });

  it('a contact who unsubscribed while the message waited is not messaged on release', async () => {
    const a = await arrange('qh4', [{ name: 'Asha', zone: 'Asia/Kolkata' }, { name: 'Ravi' }]);
    const b = await create(a);
    expect(await run(a.t, b.id)).toBe('paused');

    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND name = 'Asha'`,
      [a.t.orgId],
    );
    setClock(MORNING);
    await sweeper.sweep();
    expect(await run(a.t, b.id)).toBe('finished');

    const r = await rows(b.id);
    expect(r.find((x) => x.name === 'Asha')).toMatchObject({ status: 'failed' });
    expect(r.find((x) => x.name === 'Asha')!.error_message).toMatch(/unsubscribed/);
    expect(r.find((x) => x.name === 'Ravi')!.status).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('a utility template is never held', async () => {
    const a = await arrange('qh5', [{ name: 'Asha', zone: 'Asia/Kolkata' }], {
      category: 'utility',
    });
    const b = await create(a);
    expect(await run(a.t, b.id)).toBe('finished');
    expect((await rows(b.id))[0]!.status).toBe('sent');
  });

  it('with the quiet hours off (the default) nothing is held', async () => {
    const a = await arrange('qh6', [{ name: 'Asha', zone: 'Asia/Kolkata' }], { quietHours: false });
    const b = await create(a);
    expect(await run(a.t, b.id)).toBe('finished');
    expect((await rows(b.id))[0]!.status).toBe('sent');
  });
});
