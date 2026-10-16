import { randomUUID } from 'node:crypto';
import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import {
  CapTally,
  PACING_SETTINGS,
  PacingRuntime,
  SenderLease,
  WALLET_GATE,
  type PacingSettingsSource,
  type WalletGate,
} from '../../../src/modules/broadcasts';
import { SendWindowService } from '../../../src/modules/compliance-center';
import { ConsentGate } from '../../../src/modules/contact-consent';
import { MergeTagService } from '../../../src/modules/crm';
import {
  OutboundRegistry,
  SenderResolver,
  type EngineTransport,
  type SendCommand,
} from '../../../src/modules/node-bridge-runtime';
import { WarmerService } from '../../../src/modules/scheduled-queue-warmer';
import { ScheduleMessageBuilder } from '../../../src/modules/scheduled-queue-warmer/schedule-message-builder.service';
import { ScheduledRunService } from '../../../src/modules/scheduled-queue-warmer/scheduled-run.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Quiet hours at the scheduled-message sender (BL-177): a marketing schedule DEFERS the recipients whose local time is inside the
 * workspace's quiet hours (they stay `pending` with the instant they may go), sends everyone else and pauses itself until the first of
 * them opens; the due sweep runs it again. On release the ConsentGate is asked again. A utility template is never held.
 * The real app and Postgres, a fake engine and a fixed clock.
 */
let h: Harness;
let api: Api;
let n = 0;
let runService: ScheduledRunService;
let window: SendWindowService;
let runtime: PacingRuntime;
let sent: Array<{ command: SendCommand }> = [];

const FUTURE = '2031-03-10';
/** 21:30 in India (quiet 21:00 to 09:00), 12:00 in New York (open). */
const EVENING = new Date('2026-10-15T16:00:00Z');
const MORNING = new Date('2026-10-16T03:31:00Z');
const OPENS = '2026-10-16T03:30:00.000Z';

const setClock = (d: Date) => {
  runtime.now = () => d;
  window.now = () => d;
};

const transport = (): EngineTransport => ({
  open: () =>
    Promise.resolve({
      send: async (command) => {
        sent.push({ command });
        return { providerMessageId: `wamid.${randomUUID()}` };
      },
    }),
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  runtime = h.app.get(PacingRuntime);
  runtime.sleep = () => Promise.resolve();
  window = h.app.get(SendWindowService);
  const pacing = h.app.get<PacingSettingsSource>(PACING_SETTINGS);
  pacing.get = () =>
    Promise.resolve({
      msgGapSeconds: 3,
      enableBatches: false,
      batchSize: 50,
      batchGapMinutes: 5,
      baileysDailyCap: 4000,
    });
  runService = new ScheduledRunService(
    h.app.get(DatabaseService),
    h.app.get(SenderResolver),
    h.app.get(OutboundRegistry),
    h.app.get(MergeTagService, { strict: false }),
    h.app.get(ScheduleMessageBuilder),
    pacing as never,
    runtime,
    h.app.get(CapTally),
    h.app.get(SenderLease),
    h.app.get(WarmerService),
    h.app.get(UNOFFICIAL_WHATSAPP_GATE),
    h.app.get(OutboxService),
    h.app.get<WalletGate>(WALLET_GATE as never, { strict: false }),
    h.app.get(ConsentGate),
    window,
  );
}, 900_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sent = [];
  h.app.get(OutboundRegistry).register('baileys', transport());
  setClock(EVENING);
});

async function arrange(label: string, o: { quietHours?: boolean } = {}) {
  const t: Tenant = await api.signup(label);
  const device = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Phone', '+91', $2, 'connected', true) RETURNING uuid`,
      [t.orgId, `98111${String(10000 + n++)}`],
    )
  ).rows[0];
  if (o.quietHours !== false) {
    await h.owner.query(
      `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end)
       VALUES ($1, true, '21:00', '09:00')`,
      [t.orgId],
    );
  }
  return { t, sender: `baileys:${device.uuid}` };
}

async function group(t: Tenant, people: Array<{ name: string; zone?: string }>) {
  const uuids = await api.seedContacts(
    t,
    people.map((p) => ({
      name: p.name,
      phone: `+91961${String(1000000 + n++)}`,
      ...(p.zone ? { data: { timezone: p.zone } } : {}),
    })),
  );
  const g = (
    await h.owner.query(
      `INSERT INTO contact_groups (org_id, name) VALUES ($1, 'VIP') RETURNING id, uuid`,
      [t.orgId],
    )
  ).rows[0];
  for (const u of uuids) {
    await h.owner.query(
      `INSERT INTO contact_group_members (org_id, group_id, contact_id) SELECT $1, $2, id FROM contacts WHERE uuid = $3`,
      [t.orgId, g.id, u],
    );
  }
  return g.uuid as string;
}

const create = async (t: Tenant, over: Record<string, unknown>) => {
  const res = await api
    .as(t.admin)
    .post('/v2/scheduled')
    .set('idempotency-key', `k${Math.random()}`)
    .send({
      name: 'Spring offer',
      scheduleType: 'once',
      sendDate: FUTURE,
      sendTime: '10:30',
      timezone: 'UTC',
      messageType: 'plain',
      message: 'Hello',
      ...over,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.ids[0] as string;
};

const row = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM scheduled_messages WHERE uuid = $1`, [uuid])).rows[0];
const recipients = async (uuid: string) =>
  (
    await h.owner.query(
      `SELECT k.name, c.status, c.held_until, c.held_reason, c.error_message
         FROM scheduled_message_contacts c
         JOIN scheduled_messages m ON m.org_id = c.org_id AND m.id = c.scheduled_message_id
         LEFT JOIN contacts k ON k.org_id = c.org_id AND k.id = c.contact_id
        WHERE m.uuid = $1 ORDER BY c.id`,
      [uuid],
    )
  ).rows as Array<{
    name: string | null;
    status: string;
    held_until: Date | null;
    held_reason: string | null;
    error_message: string | null;
  }>;
const run = (t: Tenant, uuid: string) =>
  row(uuid).then((r) =>
    RequestContextStore.run(
      { requestId: `t-${uuid}`, orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () => runService.run(t.orgId, Number(r.id)),
    ),
  );

/** Time passes: the due sweep puts the paused schedule back to `scheduled` (here by hand) and the app clock is the morning. */
async function nextMorning(uuid: string) {
  await h.owner.query(
    `UPDATE scheduled_messages SET status = 'scheduled', next_attempt_at = NULL WHERE uuid = $1`,
    [uuid],
  );
  setClock(MORNING);
}

describe('BL-177: a marketing schedule is deferred, not denied, in the quiet hours', () => {
  it('sends whoever is awake, holds whoever is in their quiet hours, and pauses until the first opens', async () => {
    const { t, sender } = await arrange('sq1');
    const g = await group(t, [
      { name: 'Asha', zone: 'Asia/Kolkata' },
      { name: 'Ned', zone: 'America/New_York' },
      { name: 'Ravi' }, // read from the +91 number
    ]);
    const id = await create(t, { senders: [sender], recipientType: 'group', groupIds: [g] });

    expect(await run(t, id)).toBe('paused');

    const r = Object.fromEntries((await recipients(id)).map((x) => [x.name, x]));
    expect(r.Ned!.status).toBe('sent');
    expect(r.Asha).toMatchObject({ status: 'pending', held_reason: 'quiet_hours' });
    expect(r.Ravi).toMatchObject({ status: 'pending', held_reason: 'quiet_hours' });
    expect(r.Asha!.held_until!.toISOString()).toBe(OPENS);
    expect(sent).toHaveLength(1);

    const s = await row(id);
    expect(s.status).toBe('paused');
    expect(new Date(s.next_attempt_at).toISOString()).toBe(OPENS);
  });

  it('shows the held count and the reason on the recipient list', async () => {
    const { t, sender } = await arrange('sq2');
    const g = await group(t, [
      { name: 'Asha', zone: 'Asia/Kolkata' },
      { name: 'Ned', zone: 'America/New_York' },
    ]);
    const id = await create(t, { senders: [sender], recipientType: 'group', groupIds: [g] });
    await run(t, id);

    const res = await api.as(t.admin).get(`/v2/scheduled/${id}/recipients`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.counts).toMatchObject({ pending: 1, sent: 1, held: 1 });
    const held = res.body.items.find((x: { contactName: string }) => x.contactName === 'Asha');
    expect(held).toMatchObject({ status: 'pending', heldUntil: OPENS, heldReason: 'quiet_hours' });
  });

  it('sends the held recipients when the hours open, and completes', async () => {
    const { t, sender } = await arrange('sq3');
    const g = await group(t, [{ name: 'Asha', zone: 'Asia/Kolkata' }, { name: 'Ravi' }]);
    const id = await create(t, { senders: [sender], recipientType: 'group', groupIds: [g] });
    expect(await run(t, id)).toBe('paused');
    expect(sent).toHaveLength(0);

    await nextMorning(id);
    expect(await run(t, id)).toBe('finished');
    expect(sent).toHaveLength(2);
    const r = await recipients(id);
    expect(r.map((x) => x.status)).toEqual(['sent', 'sent']);
    expect(r.every((x) => x.held_until === null && x.held_reason === null)).toBe(true);
    expect((await row(id)).status).toBe('completed');
  });

  it('a contact who unsubscribed while the message waited is not messaged on release', async () => {
    const { t, sender } = await arrange('sq4');
    const g = await group(t, [{ name: 'Asha', zone: 'Asia/Kolkata' }, { name: 'Ravi' }]);
    const id = await create(t, { senders: [sender], recipientType: 'group', groupIds: [g] });
    expect(await run(t, id)).toBe('paused');

    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND name = 'Asha'`,
      [t.orgId],
    );
    await nextMorning(id);
    expect(await run(t, id)).toBe('finished');
    const r = Object.fromEntries((await recipients(id)).map((x) => [x.name, x]));
    expect(r.Asha).toMatchObject({ status: 'failed' });
    expect(r.Asha!.error_message).toMatch(/unsubscribed/);
    expect(r.Ravi!.status).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('a number typed in by hand (no contact) is read by its country code', async () => {
    const { t, sender } = await arrange('sq5');
    const id = await create(t, {
      senders: [sender],
      recipientType: 'number',
      numbers: ['+919822200001', '+14155550123'],
    });
    expect(await run(t, id)).toBe('paused');
    const r = await recipients(id);
    const india = r.find((x) => x.status === 'pending');
    expect(india).toMatchObject({ held_reason: 'quiet_hours' });
    // 16:00 UTC is 12:00 in New York but 04:00 in Honolulu: the +1 number waits for every zone of its country.
    expect(r.every((x) => x.status === 'pending')).toBe(true);
  });

  it('a utility template is never held', async () => {
    const { t, sender } = await arrange('sq6');
    const g = await group(t, [{ name: 'Asha', zone: 'Asia/Kolkata' }]);
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, category, meta_category, template_type, status, language)
         VALUES ($1, 'order_update', 'Your order shipped', 'utility', 'utility', 'standard', 'approved', 'en') RETURNING uuid`,
        [t.orgId],
      )
    ).rows[0].uuid as string;
    const id = await create(t, {
      senders: [sender],
      messageType: 'template',
      message: undefined,
      templateId: tpl,
      recipientType: 'group',
      groupIds: [g],
    });
    expect(await run(t, id)).toBe('finished');
    expect(sent).toHaveLength(1);
  });

  it('with the quiet hours off (the default) nothing is held', async () => {
    const { t, sender } = await arrange('sq7', { quietHours: false });
    const g = await group(t, [{ name: 'Asha', zone: 'Asia/Kolkata' }]);
    const id = await create(t, { senders: [sender], recipientType: 'group', groupIds: [g] });
    expect(await run(t, id)).toBe('finished');
    expect(sent).toHaveLength(1);
  });
});
