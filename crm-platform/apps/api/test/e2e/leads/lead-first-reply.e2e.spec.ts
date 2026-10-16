import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { AuditService } from '../../../src/kernel/audit/audit.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import type { OutboxEvent } from '../../../src/kernel/outbox/outbox-subscribers';
import { SendWindowService } from '../../../src/modules/compliance-center';
import { ConsentGate } from '../../../src/modules/contact-consent';
import { ContactActivitiesRepository, ContactsRepository } from '../../../src/modules/crm';
import { LeadEventsRepository } from '../../../src/modules/leads/lead-events.repository';
import { LeadFirstMessageLookups } from '../../../src/modules/leads/lead-first-message.lookups';
import type { Preparation } from '../../../src/modules/leads/lead-first-message.sender';
import { LeadFirstRepliesRepository } from '../../../src/modules/leads/lead-first-replies.repository';
import { LeadFirstReplyService } from '../../../src/modules/leads/lead-first-reply.service';
import { LeadSourcesRepository } from '../../../src/modules/leads/lead-sources.repository';
import {
  LEAD_READ,
  LeadsApi,
  startHarness,
  type CreatedSource,
  type Harness,
  type Tenant,
} from './support';

/**
 * Speed-to-lead (BL-014, L-16) against a real Postgres: the setting and its validation, the one row per lead ("never twice"), the
 * delay, the real ConsentGate in front of a send, the timeline entry, audit and outbox, and the table's isolation. The channel itself
 * (WhatsApp through the conversation core, SMS and email through the engines) is replaced by a recorder: there is no WhatsApp, SMS
 * or mail provider in a test, and what each channel does is the unit spec of the sender.
 */
let h: Harness;
let api: LeadsApi;
let svc: LeadFirstReplyService;
const delivered = vi.fn(async () => ({ kind: 'sent' as const }));
let purpose: 'marketing_messaging' | 'service_messaging' = 'marketing_messaging';

const readyMessage = (phone: string | null, email: string | null): Preparation => ({
  kind: 'ready',
  prepared: { purpose, target: { phone, email }, deliver: delivered },
});

beforeAll(async () => {
  h = await startHarness();
  api = new LeadsApi(h);
  const get = <T>(token: abstract new (...a: never[]) => T): T =>
    h.app.get(token, { strict: false });
  svc = new LeadFirstReplyService(
    get(DatabaseService),
    new LeadFirstRepliesRepository(),
    get(LeadSourcesRepository),
    get(LeadEventsRepository),
    {
      prepare: async (
        _o: number,
        _r: unknown,
        _c: unknown,
        contact: { phone: string | null; email: string | null },
      ) => readyMessage(contact.phone, contact.email),
    } as never,
    new LeadFirstMessageLookups(),
    get(ConsentGate),
    get(SendWindowService),
    get(ContactsRepository),
    get(ContactActivitiesRepository),
    get(AuditService),
    get(OutboxService),
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function leadCreatedEvents(orgId: number): Promise<OutboxEvent[]> {
  const res = await h.owner.query(
    `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
     WHERE org_id = $1 AND event_type = 'lead.created' ORDER BY id`,
    [orgId],
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    orgId: Number(r.org_id),
    aggregateModule: r.aggregate_module,
    aggregateId: String(r.aggregate_id),
    eventType: r.event_type,
    payload: r.payload,
  }));
}

/** What the worker's drain does: every `lead.created` of the workspace goes to the consumer. */
async function drain(orgId: number): Promise<void> {
  for (const e of await leadCreatedEvents(orgId)) await svc.schedule(e);
}

const replies = (orgId: number) =>
  api.rows(orgId, `SELECT * FROM lead_first_replies WHERE org_id = $1 ORDER BY id`);

async function emailTemplate(t: Tenant, name: string): Promise<string> {
  const res = await api
    .as(t.admin)
    .post('/v2/email/templates')
    .send({ name, subject: 'Welcome {{first_name}}', bodyHtml: '<p>Hello {{first_name}}</p>' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

const speed = (templateId: string, patch: Record<string, unknown> = {}) => ({
  defaults: {
    countryCode: '91',
    speedToLead: { enabled: true, channel: 'email', templateId, delayMinutes: 0, ...patch },
  },
});

describe('the setting', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('stlset');
  });

  it('is off by default and comes back in the source', async () => {
    const s = await api.source(t.admin, { name: 'Plain', defaults: { countryCode: '91' } });
    expect(s.defaults).toMatchObject({
      speedToLead: {
        enabled: false,
        channel: 'whatsapp',
        delayMinutes: 0,
        businessHoursOnly: false,
      },
    });
    const get = await api.as(t.admin).get(`/v2/lead-sources/${s.id}`);
    expect(get.body.defaults.speedToLead.enabled).toBe(false);
  });

  it('switched on, it needs a template the channel can really send (422 LEAD_DEFAULTS_INVALID)', async () => {
    const none = await api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({
        name: 'No template',
        defaults: { speedToLead: { enabled: true, channel: 'email' } },
      });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('LEAD_DEFAULTS_INVALID');
    expect(none.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'defaults.speedToLead.templateId', message: 'template_required' },
      ]),
    );

    const ghost = await api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Ghost', ...speed('00000000-0000-4000-8000-000000000999') });
    expect(ghost.status).toBe(422);
    expect(ghost.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'defaults.speedToLead.templateId', message: 'template_not_found' },
      ]),
    );

    // an email template is not a WhatsApp or an SMS template
    const tpl = await emailTemplate(t, 'Mail only');
    for (const channel of ['whatsapp', 'sms']) {
      const wrong = await api
        .as(t.admin)
        .post('/v2/lead-sources')
        .send({ name: `Wrong ${channel}`, ...speed(tpl, { channel }) });
      expect(wrong.status, channel).toBe(422);
    }
  });

  it('a named sender must be a connected one of the workspace', async () => {
    const tpl = await emailTemplate(t, 'Mail for sender check');
    const res = await api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({
        name: 'Unknown mailbox',
        ...speed(tpl, { senderId: '00000000-0000-4000-8000-000000000998' }),
      });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'defaults.speedToLead.senderId', message: 'sender_not_found' },
      ]),
    );
  });

  it('is accepted with a shared email template, and the delay is bounded to an hour', async () => {
    const tpl = await emailTemplate(t, 'Mail ok');
    const ok = await api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Mail first', ...speed(tpl, { delayMinutes: 60 }) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.defaults.speedToLead).toMatchObject({
      enabled: true,
      channel: 'email',
      delayMinutes: 60,
    });
    const long = await api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Too slow', ...speed(tpl, { delayMinutes: 61 }) });
    expect(long.status).toBe(422);
    expect(long.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('the pickers of the setting', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('stlopts');
  });

  it('lists the shared email templates by name and none of the personal ones, with the manage permission alone', async () => {
    const shared = await emailTemplate(t, 'Shared welcome');
    const mine = await api
      .as(t.admin)
      .post('/v2/email/templates')
      .send({ name: 'My own', subject: 'Hi', bodyHtml: '<p>Hi</p>', scope: 'mine' });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);

    const res = await api.as(t.admin).get('/v2/lead-sources/speed-to-lead/options?channel=email');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.templates.map((x: { id: string }) => x.id)).toEqual([shared]);
    expect(res.body.templates[0]).toMatchObject({
      name: 'Shared welcome',
      preview: 'Welcome {{first_name}}',
    });
    expect(res.body.senders).toEqual([]);
  });

  it('has nothing to offer for WhatsApp or SMS in a workspace without such templates, and refuses a channel it does not know', async () => {
    for (const channel of ['whatsapp', 'sms']) {
      const res = await api
        .as(t.admin)
        .get(`/v2/lead-sources/speed-to-lead/options?channel=${channel}`);
      expect(res.status, channel).toBe(200);
      expect(res.body).toEqual({ templates: [], senders: [] });
    }
    const bad = await api.as(t.admin).get('/v2/lead-sources/speed-to-lead/options?channel=fax');
    expect(bad.status).toBe(422);
  });

  it('a member who may only read lead sources cannot open it', async () => {
    const reader = await api.member(t, 'stlreader', LEAD_READ);
    const res = await api
      .as(reader.token)
      .get('/v2/lead-sources/speed-to-lead/options?channel=email');
    expect(res.status).toBe(403);
  });
});

describe('one first message per lead (never twice)', () => {
  let t: Tenant;
  let src: CreatedSource;
  beforeAll(async () => {
    t = await api.signup('stlone');
    src = await api.source(t.admin, {
      name: 'Mail first',
      ...speed(await emailTemplate(t, 'Welcome')),
    });
  });

  it('a new lead is scheduled once, sent at once, and a redelivered event or a second drain does nothing more', async () => {
    delivered.mockClear();
    purpose = 'service_messaging';
    const res = await api.hook(src.hookPath, {
      name: 'Ada One',
      email: 'ada.one@example.test',
      phone: '98000 31001',
    });
    expect(res.status).toBe(200);

    await drain(t.orgId);
    await drain(t.orgId);
    await drain(t.orgId);

    const rows = await replies(t.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', channel: 'email', reason: null, attempts: 1 });
    expect(rows[0]!.sent_at).not.toBeNull();
    expect(delivered).toHaveBeenCalledTimes(1);

    // audit and outbox, in the lead's own right
    const audit = await api.rows(
      t.orgId,
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'lead_first_replies' ORDER BY id`,
    );
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update']);
    const events = await api.rows(
      t.orgId,
      `SELECT event_type FROM event_outbox WHERE org_id = $1 AND event_type LIKE 'lead.first_reply.%' ORDER BY id`,
    );
    expect(events.map((e) => e.event_type)).toEqual([
      'lead.first_reply.scheduled',
      'lead.first_reply.sent',
    ]);

    // and on the contact's timeline: the outcome, never the message or an address
    const timeline = await api.rows(
      t.orgId,
      `SELECT activity_type, title, body, source FROM contact_activities WHERE org_id = $1 AND activity_type = 'speed_to_lead'`,
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ title: 'First message sent by email', source: 'system' });
    expect(JSON.stringify(timeline) + JSON.stringify(audit)).not.toContain('example.test');
  });

  it('the event list and detail of the lead carry where its first message stands', async () => {
    const list = await api.as(t.admin).get(`/v2/lead-sources/${src.id}/events`);
    expect(list.status).toBe(200);
    expect(list.body.data[0].firstReply).toMatchObject({
      channel: 'email',
      status: 'sent',
      reason: null,
    });
  });

  it('a returning contact (lead.updated) and a test lead get none', async () => {
    delivered.mockClear();
    const again = await api.hook(src.hookPath, {
      name: 'Ada One',
      email: 'ada.one@example.test',
      phone: '98000 31001',
      note: 'second form',
    });
    expect(again.status).toBe(200);
    const test = await api.as(t.admin).post(`/v2/lead-sources/${src.id}/test`).send({});
    expect(test.status).toBe(200);
    await drain(t.orgId);
    expect(await replies(t.orgId)).toHaveLength(1);
    expect(delivered).not.toHaveBeenCalled();
  });

  it('a source with the setting off schedules nothing', async () => {
    const off = await api.source(t.admin, { name: 'Off', defaults: { countryCode: '91' } });
    await api.hook(off.hookPath, { name: 'Off Lead', phone: '98000 31002' });
    await drain(t.orgId);
    const rows = await api.rows(
      t.orgId,
      `SELECT f.id FROM lead_first_replies f JOIN lead_events e ON e.org_id = f.org_id AND e.id = f.lead_event_id
       JOIN lead_sources s ON s.org_id = e.org_id AND s.id = e.source_id WHERE f.org_id = $1 AND s.uuid = $2::uuid`,
      [off.id],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('the delay', () => {
  it('waits for its time, and the sweep sends it when it has come', async () => {
    const t = await api.signup('stldelay');
    const src = await api.source(t.admin, {
      name: 'Slow',
      ...speed(await emailTemplate(t, 'Slow welcome'), { delayMinutes: 30 }),
    });
    delivered.mockClear();
    purpose = 'service_messaging';
    await api.hook(src.hookPath, { name: 'Slow Lead', email: 'slow@example.test' });
    await drain(t.orgId);

    const [row] = await replies(t.orgId);
    expect(row).toMatchObject({ status: 'scheduled', attempts: 0 });
    const wait = new Date(row!.due_at).getTime() - Date.now();
    expect(wait).toBeGreaterThan(28 * 60_000);
    expect(wait).toBeLessThan(31 * 60_000);
    expect(delivered).not.toHaveBeenCalled();

    await h.owner.query(
      `UPDATE lead_first_replies SET due_at = now() - interval '1 minute' WHERE org_id = $1`,
      [t.orgId],
    );
    expect(await svc.processDue()).toBeGreaterThanOrEqual(1);
    expect((await replies(t.orgId))[0]).toMatchObject({ status: 'sent', attempts: 1 });
    expect(delivered).toHaveBeenCalledTimes(1);
    // nothing left to do
    expect(await svc.processDue()).toBe(0);
  });

  it('a claim a dead worker left behind is freed: an email is never sent again blindly, a WhatsApp message may be', async () => {
    const t = await api.signup('stlstale');
    const src = await api.source(t.admin, {
      name: 'Stale',
      ...speed(await emailTemplate(t, 'Stale welcome')),
    });
    await api.hook(src.hookPath, { name: 'Stale Lead', email: 'stale@example.test' });
    const [ev] = await leadCreatedEvents(t.orgId);
    delivered.mockClear();
    // an enabled source, a row claimed twenty minutes ago and never finished
    await h.owner.query(
      `INSERT INTO lead_first_replies (org_id, lead_event_id, contact_id, channel, status, due_at, expires_at, attempts, claimed_at)
       SELECT e.org_id, e.id, e.contact_id, 'email', 'sending', now(), now() + interval '1 day', 1, now() - interval '20 minutes'
       FROM lead_events e WHERE e.org_id = $1 AND e.uuid = $2::uuid`,
      [t.orgId, ev!.payload.leadEventId],
    );
    await svc.processDue();
    const [row] = await replies(t.orgId);
    expect(row).toMatchObject({ status: 'failed', reason: 'interrupted' });
    expect(delivered).not.toHaveBeenCalled();

    await h.owner.query(
      `UPDATE lead_first_replies SET channel = 'whatsapp', status = 'sending', reason = NULL, claimed_at = now() - interval '20 minutes' WHERE org_id = $1`,
      [t.orgId],
    );
    await h.owner.query(`SELECT 1`);
    // a WhatsApp message is put back; the sweep in the same call takes it again (it is due now) and works on it
    await svc.processDue();
    expect(delivered).toHaveBeenCalledTimes(1);
  });
});

describe('the real consent gate', () => {
  it('a contact who opted out is not messaged: blocked as opted_out, nothing delivered, and said on the timeline', async () => {
    const t = await api.signup('stlconsent');
    const src = await api.source(t.admin, {
      name: 'Consent',
      ...speed(await emailTemplate(t, 'Consent welcome'), { delayMinutes: 5 }),
    });
    await api.hook(src.hookPath, { name: 'Out Lead', email: 'out@example.test' });
    await drain(t.orgId);
    // the person opts out before the delay has passed
    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND email = 'out@example.test'`,
      [t.orgId],
    );
    await h.owner.query(
      `UPDATE lead_first_replies SET due_at = now() - interval '1 second' WHERE org_id = $1`,
      [t.orgId],
    );
    delivered.mockClear();
    purpose = 'marketing_messaging';
    await svc.processDue();

    const [row] = await replies(t.orgId);
    expect(row).toMatchObject({ status: 'blocked', reason: 'opted_out' });
    expect(delivered).not.toHaveBeenCalled();
    const timeline = await api.rows(
      t.orgId,
      `SELECT title, body FROM contact_activities WHERE org_id = $1 AND activity_type = 'speed_to_lead'`,
    );
    expect(timeline).toEqual([
      { title: 'First message by email not sent', body: 'Blocked: the contact opted out' },
    ]);
  });
});

describe('the table', () => {
  let a: Tenant;
  let b: Tenant;
  let app: Client;
  beforeAll(async () => {
    a = await api.signup('stldba');
    b = await api.signup('stldbb');
    const src = await api.source(a.admin, {
      name: 'Iso',
      ...speed(await emailTemplate(a, 'Iso welcome')),
    });
    purpose = 'service_messaging';
    await api.hook(src.hookPath, { name: 'Iso Lead', email: 'iso@example.test' });
    await drain(a.orgId);
    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  it('row-level security is forced: no tenant sees none, another tenant sees none, its own sees its row', async () => {
    expect((await app.query(`SELECT count(*)::int AS n FROM lead_first_replies`)).rows[0].n).toBe(
      0,
    );
    for (const [org, expected] of [
      [b.orgId, 0],
      [a.orgId, 1],
    ] as const) {
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      const n = (await app.query(`SELECT count(*)::int AS n FROM lead_first_replies`)).rows[0].n;
      await app.query('ROLLBACK');
      expect(n).toBe(expected);
    }
  });

  it("a row cannot point at another workspace's lead event or contact, and there is one row per lead event", async () => {
    const [ev] = await api.rows(
      a.orgId,
      `SELECT id, source_id FROM lead_events WHERE org_id = $1 LIMIT 1`,
    );
    const fresh = (
      await h.owner.query(
        `INSERT INTO lead_events (org_id, source_id, external_id) VALUES ($1, $2, 'fk-check') RETURNING id`,
        [a.orgId, ev!.source_id],
      )
    ).rows[0];
    const [bContact] = (
      await h.owner.query(
        `INSERT INTO contacts (org_id, name) VALUES ($1, 'B only') RETURNING id`,
        [b.orgId],
      )
    ).rows;
    // another workspace's lead event
    await expect(
      h.owner.query(
        `INSERT INTO lead_first_replies (org_id, lead_event_id, channel, due_at, expires_at) VALUES ($1, $2, 'sms', now(), now())`,
        [b.orgId, fresh.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    // another workspace's contact
    await expect(
      h.owner.query(
        `INSERT INTO lead_first_replies (org_id, lead_event_id, contact_id, channel, due_at, expires_at) VALUES ($1, $2, $3, 'sms', now(), now())`,
        [a.orgId, fresh.id, bContact.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    // a second message for a lead that already has one
    await expect(
      h.owner.query(
        `INSERT INTO lead_first_replies (org_id, lead_event_id, channel, due_at, expires_at) VALUES ($1, $2, 'sms', now(), now())`,
        [a.orgId, ev!.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('deleting the source takes the first messages with it; deleting the contact keeps the record without the link', async () => {
    const t = await api.signup('stlcascade');
    const src = await api.source(t.admin, {
      name: 'Cascade',
      ...speed(await emailTemplate(t, 'Cascade welcome')),
    });
    purpose = 'service_messaging';
    await api.hook(src.hookPath, { name: 'Cascade Lead', email: 'cascade@example.test' });
    await drain(t.orgId);
    expect(await replies(t.orgId)).toHaveLength(1);
    await h.owner.query(
      `DELETE FROM contacts WHERE org_id = $1 AND email = 'cascade@example.test'`,
      [t.orgId],
    );
    const [kept] = await replies(t.orgId);
    expect(kept).toMatchObject({ status: 'sent', contact_id: null });
    const del = await api.as(t.admin).delete(`/v2/lead-sources/${src.id}`);
    expect(del.status).toBe(204);
    expect(await replies(t.orgId)).toHaveLength(0);
  });
});
