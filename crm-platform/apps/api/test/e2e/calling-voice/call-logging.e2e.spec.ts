import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TELEPHONY_SIGNATURE_HEADER, TELEPHONY_TIMESTAMP_HEADER } from '@crm/contracts';
import { signTelephonyCallback } from '../../../src/infra/providers/telephony';
import { FakeTelephonyProvider } from '../../../src/infra/providers/telephony';
import { CallRecordingRetentionService } from '../../../src/modules/calling-voice/call-recording-retention.service';
import { CallLogRetentionService } from '../../../src/modules/calling-voice/logging/call-log-retention.service';
import {
  addNumber,
  enableRecording,
  saveRecordingRules,
  startCallPipeline,
  type CallPipeline,
  type Tenant,
} from './support';

/**
 * The call logging framework end to end: the real API, the worker side of the telephony callback in the same process, real Postgres
 * (restricted role) and Redis. What each spec states is a rule of docs/specs/call-logging.md.
 */
let p: CallPipeline;
beforeAll(async () => {
  p = await startCallPipeline();
}, 900_000);
afterAll(async () => {
  await p?.stop();
});

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
let seq = 0;
const phone = () => `+9198110${String(10000 + seq++)}`;

const post = (token: string, path: string, body: unknown) =>
  p.api
    .as(token)
    .post(path)
    .send(body as object);

const rows = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
  (await p.h.owner.query(sql, args)).rows as T[];

/** A workspace with an admin and one contact that has a phone. */
async function setup(
  label: string,
  contact: { name?: string; phone?: string; ownerId?: number | null } = {},
) {
  const t = await p.api.signup(label);
  const number = contact.phone ?? phone();
  const [contactId] = await p.api.seedContacts(t, [
    { name: contact.name ?? 'Asha Rao', phone: number, ownerId: contact.ownerId ?? null },
  ]);
  return { t, contactId: contactId!, number };
}

const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 150));
  }
};

describe('Log a call', () => {
  it('records the call, writes one timeline line, audits it and emits an event without the number or the notes', async () => {
    const { t, contactId, number } = await setup('lc1');
    const res = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 240,
      startedAt: iso(HOUR),
      notes: 'Wants the annual plan. Call back after the 20th.',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const e = res.body.entry;
    expect(e).toMatchObject({
      source: 'manual',
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 240,
      contactId,
      contactName: 'Asha Rao',
      customerPhone: number,
      handlerName: 'Admin Person',
      editable: true,
      hasRecordingRef: false,
    });
    expect(res.body).toMatchObject({ created: true, matchedByPhone: false, nudges: [] });

    const activities = await rows<{
      activity_type: string;
      title: string;
      body: string;
      source: string;
    }>(
      `SELECT a.activity_type, a.title, a.body, a.source FROM contact_activities a JOIN contacts c ON c.org_id = a.org_id AND c.id = a.contact_id
        WHERE a.org_id = $1 AND c.uuid = $2`,
      [t.orgId, contactId],
    );
    expect(activities).toEqual([
      {
        activity_type: 'call_manual',
        title: 'Outbound call, Connected, 4 min, by Admin Person',
        body: 'Wants the annual plan. Call back after the 20th.',
        source: 'user',
      },
    ]);
    const touched = await rows<{ last_activity_at: string | null }>(
      `SELECT last_activity_at FROM contacts WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, contactId],
    );
    expect(touched[0]!.last_activity_at).not.toBeNull();

    expect(await p.api.auditCount(t.orgId, 'call_log_entries', 'insert')).toBe(1);
    const events = await p.api.events(t.orgId, 'call.logged');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'manual', outcome: 'connected', contactId });
    expect(JSON.stringify(events[0])).not.toContain(number);
    expect(JSON.stringify(events[0])).not.toContain('annual plan');
    const audit = await rows<{ delta: unknown }>(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'call_log_entries'`,
      [t.orgId],
    );
    expect(JSON.stringify(audit)).not.toContain('annual plan');
    expect(JSON.stringify(audit)).not.toContain(number);
  });

  it('finds the contact by the canonical number when only a number is given', async () => {
    const { t, contactId } = await setup('lc2', { phone: '+919811200777' });
    const res = await post(t.admin, '/v2/calls/log', {
      customerPhone: '98112 00777',
      direction: 'inbound',
      outcome: 'no_answer',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.matchedByPhone).toBe(true);
    expect(res.body.entry.contactId).toBe(contactId);
    expect(res.body.entry.customerPhone).toBe('+919811200777');
  });

  it('keeps a call from an unknown number by its number alone and writes no timeline line', async () => {
    const { t } = await setup('lc3');
    const res = await post(t.admin, '/v2/calls/log', {
      customerPhone: '+14155550123',
      direction: 'inbound',
      outcome: 'wrong_number',
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.contactId).toBeNull();
    const n = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM contact_activities WHERE org_id = $1`,
      [t.orgId],
    );
    expect(n[0]!.n).toBe(0);
  });

  it('refuses a call with no contact and no number, a number that is not one, and a bad time', async () => {
    const { t } = await setup('lc4');
    const base = { direction: 'inbound', outcome: 'busy' };
    const none = await post(t.admin, '/v2/calls/log', base);
    expect(none.status).toBe(422);
    const junk = await post(t.admin, '/v2/calls/log', { ...base, customerPhone: 'anonymous' });
    expect(junk.status).toBe(422);
    expect(junk.body.code).toBe('CALL_LOG_CONTACT_REQUIRED');
    const future = await post(t.admin, '/v2/calls/log', {
      ...base,
      customerPhone: '+14155550123',
      startedAt: new Date(Date.now() + 2 * HOUR).toISOString(),
    });
    expect(future.status).toBe(422);
    expect(future.body.code).toBe('CALL_LOG_TIME_INVALID');
    const ancient = await post(t.admin, '/v2/calls/log', {
      ...base,
      customerPhone: '+14155550123',
      startedAt: iso(500 * 24 * HOUR),
    });
    expect(ancient.body.code).toBe('CALL_LOG_TIME_INVALID');
  });

  it('lands once when the client sends its own id twice', async () => {
    const { t, contactId } = await setup('lc5');
    const body = {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 30,
      externalId: 'offline-1',
    };
    const a = await post(t.admin, '/v2/calls/log', body);
    const b = await post(t.admin, '/v2/calls/log', { ...body, outcome: 'busy' });
    expect(a.body.created).toBe(true);
    expect(b.body.created).toBe(false);
    expect(b.body.entry.id).toBe(a.body.entry.id);
    expect(b.body.entry.outcome).toBe('connected');
    const n = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM call_log_entries WHERE org_id = $1`,
      [t.orgId],
    );
    expect(n[0]!.n).toBe(1);
  });

  it('makes a follow-up task for the contact with the due date and the assignee, in the same transaction', async () => {
    const { t, contactId } = await setup('lc6');
    const mate = await p.api.member(t, 'Mate', [['record.contacts.read'], ['record.tasks.read']]);
    const mateUuid = (
      await rows<{ uuid: string }>(`SELECT uuid FROM users WHERE id = $1`, [mate.userId])
    )[0]!.uuid;
    const due = new Date(Date.now() + 48 * HOUR).toISOString();
    const res = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 60,
      followUp: { dueAt: due, assigneeId: mateUuid },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.followUpTaskId).toBeTruthy();
    const task = await rows<{
      title: string;
      due_at: Date;
      assignee_id: string;
      contact_uuid: string;
      source: string;
    }>(
      `SELECT t.title, t.due_at, t.assignee_id, c.uuid AS contact_uuid, t.source
         FROM tasks t JOIN contacts c ON c.org_id = t.org_id AND c.id = t.contact_id
        WHERE t.org_id = $1 AND t.uuid = $2`,
      [t.orgId, res.body.followUpTaskId],
    );
    expect(task[0]).toMatchObject({
      title: 'Follow up on the call with Asha Rao',
      contact_uuid: contactId,
      source: 'manual',
    });
    expect(Number(task[0]!.assignee_id)).toBe(mate.userId);
    expect(task[0]!.due_at.toISOString()).toBe(due);
    const linked = await rows<{ follow_up_task_id: string | null }>(
      `SELECT follow_up_task_id FROM call_log_entries WHERE org_id = $1`,
      [t.orgId],
    );
    expect(linked[0]!.follow_up_task_id).not.toBeNull();
  });

  it('refuses a follow-up with no contact, and an assignee outside the workspace, and writes nothing', async () => {
    const { t, contactId } = await setup('lc7');
    const other = await setup('lc7b');
    const otherUser = (
      await rows<{ uuid: string }>(`SELECT uuid FROM users WHERE id = $1`, [other.t.adminUserId])
    )[0]!.uuid;
    const noContact = await post(t.admin, '/v2/calls/log', {
      customerPhone: '+14155550999',
      direction: 'outbound',
      outcome: 'connected',
      followUp: { dueAt: new Date(Date.now() + HOUR).toISOString() },
    });
    expect(noContact.status).toBe(422);
    expect(noContact.body.code).toBe('CALL_LOG_FOLLOW_UP_NEEDS_CONTACT');
    const stranger = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      followUp: { dueAt: new Date(Date.now() + HOUR).toISOString(), assigneeId: otherUser },
    });
    expect(stranger.status).toBeGreaterThanOrEqual(400);
    const n = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM call_log_entries WHERE org_id = $1`,
      [t.orgId],
    );
    expect(n[0]!.n).toBe(0);
    const tasks = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM tasks WHERE org_id = $1`,
      [t.orgId],
    );
    expect(tasks[0]!.n).toBe(0);
  });

  it('suggests the next lifecycle stage only when asked, and never applies it', async () => {
    const { t, contactId } = await setup('lc8');
    await p.h.owner.query(
      `DELETE FROM status_options WHERE org_id = $1 AND module_key = 'contacts' AND option_group = 'lifecycle_stage'`,
      [t.orgId],
    );
    await p.h.owner.query(
      `INSERT INTO status_options (org_id, module_key, option_group, value, label, position, is_default)
       VALUES ($1,'contacts','lifecycle_stage','new','New',0,true), ($1,'contacts','lifecycle_stage','contacted','Contacted',1,false)`,
      [t.orgId],
    );
    await p.h.owner.query(`UPDATE contacts SET lifecycle_stage = 'new' WHERE org_id = $1`, [
      t.orgId,
    ]);
    const quiet = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 5,
    });
    expect(quiet.body.nudges).toEqual([]);
    const asked = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 5,
      suggestStageNudge: true,
    });
    expect(asked.body.nudges).toEqual([
      {
        kind: 'lifecycle_stage',
        current: 'new',
        suggested: 'contacted',
        suggestedLabel: 'Contacted',
      },
    ]);
    const stage = await rows<{ lifecycle_stage: string }>(
      `SELECT lifecycle_stage FROM contacts WHERE org_id = $1`,
      [t.orgId],
    );
    expect(stage[0]!.lifecycle_stage).toBe('new');
    const missed = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'no_answer',
      suggestStageNudge: true,
    });
    expect(missed.body.nudges).toEqual([]);
  });

  it('is never refused by a consent rule: a number on the Do-Not-Call list is logged', async () => {
    const { t, contactId, number } = await setup('lc9');
    await p.h.owner.query(
      `INSERT INTO dnc_entries (org_id, phone, source) VALUES ($1, $2, 'manual')`,
      [t.orgId, number],
    );
    await p.h.owner.query(`UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1`, [
      t.orgId,
    ]);
    const res = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 20,
    });
    expect(res.status).toBe(201);
  });
});

describe('who may log, edit and read', () => {
  it('needs call.logs.create to log and call.logs.read to read a contact’s calls', async () => {
    const { t, contactId } = await setup('pm1');
    const nobody = await p.api.member(t, 'Nobody', [['record.contacts.read']]);
    expect(
      (
        await post(nobody.token, '/v2/calls/log', {
          contactId,
          direction: 'inbound',
          outcome: 'busy',
        })
      ).status,
    ).toBe(403);
    expect((await p.api.as(nobody.token).get(`/v2/contacts/${contactId}/calls`)).status).toBe(403);
    expect((await p.api.as(nobody.token).get('/v2/calls/logging-settings')).status).toBe(403);
    expect((await p.api.as(nobody.token).get('/v2/calls/telephony/connections')).status).toBe(403);
  });

  it('logs only on a contact the person may read, and answers 404 for one they may not', async () => {
    const { t, contactId } = await setup('pm2');
    const rep = await p.api.member(t, 'Rep', [
      ['call.logs.create'],
      ['record.contacts.read', 'own'],
    ]);
    const res = await post(rep.token, '/v2/calls/log', {
      contactId,
      direction: 'inbound',
      outcome: 'busy',
    });
    expect(res.status).toBe(404);
    const noRead = await p.api.member(t, 'NoRead', [['call.logs.create']]);
    expect(
      (
        await post(noRead.token, '/v2/calls/log', {
          contactId,
          direction: 'inbound',
          outcome: 'busy',
        })
      ).status,
    ).toBe(403);
  });

  it('logs by number alone, with no link, when the number belongs to a contact the person may not read', async () => {
    const { t, number } = await setup('pm3');
    const rep = await p.api.member(t, 'Rep3', [
      ['call.logs.create'],
      ['record.contacts.read', 'own'],
    ]);
    const res = await post(rep.token, '/v2/calls/log', {
      customerPhone: number,
      direction: 'inbound',
      outcome: 'connected',
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.contactId).toBeNull();
    expect(res.body.matchedByPhone).toBe(false);
  });

  it('lets the person who logged it edit and delete it inside the window, and keeps the timeline line in step', async () => {
    const { t, contactId } = await setup('ed1');
    const rep = await p.api.member(t, 'Rep4', [
      ['call.logs.create'],
      ['record.contacts.read'],
      ['call.logs.read', 'own'],
    ]);
    const made = await post(rep.token, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'no_answer',
    });
    const id = made.body.entry.id as string;
    const patched = await p.api.as(rep.token).patch(`/v2/calls/log/${id}`).send({
      outcome: 'connected',
      durationSec: 90,
      notes: 'Reached her after all.',
      rowVersion: made.body.entry.rowVersion,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body).toMatchObject({
      outcome: 'connected',
      durationSec: 90,
      notes: 'Reached her after all.',
    });
    const line = await rows<{ title: string; body: string }>(
      `SELECT title, body FROM contact_activities WHERE org_id = $1`,
      [t.orgId],
    );
    expect(line).toEqual([
      { title: 'Outbound call, Connected, 2 min, by Rep4', body: 'Reached her after all.' },
    ]);
    expect(await p.api.auditCount(t.orgId, 'call_log_entries', 'update')).toBe(1);

    const stale = await p.api
      .as(rep.token)
      .patch(`/v2/calls/log/${id}`)
      .send({ outcome: 'busy', rowVersion: made.body.entry.rowVersion });
    expect(stale.status).toBe(409);

    const del = await p.api.as(rep.token).delete(`/v2/calls/log/${id}`);
    expect(del.status).toBe(204);
    expect((await rows(`SELECT 1 FROM call_log_entries WHERE org_id = $1`, [t.orgId])).length).toBe(
      0,
    );
    expect(
      (await rows(`SELECT 1 FROM contact_activities WHERE org_id = $1`, [t.orgId])).length,
    ).toBe(0);
    expect(await p.api.auditCount(t.orgId, 'call_log_entries', 'delete')).toBe(1);
  });

  it('answers 404 for another person’s entry, 403 once the window has closed, and lets call.logging.manage through', async () => {
    const { t, contactId } = await setup('ed2');
    const rep = await p.api.member(t, 'Rep5', [['call.logs.create'], ['record.contacts.read']]);
    const other = await p.api.member(t, 'Rep6', [['call.logs.create'], ['record.contacts.read']]);
    const made = await post(rep.token, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'busy',
    });
    const id = made.body.entry.id as string;
    expect((await p.api.as(other.token).delete(`/v2/calls/log/${id}`)).status).toBe(404);
    await p.h.owner.query(
      `UPDATE call_log_entries SET created_at = now() - interval '25 hours' WHERE org_id = $1`,
      [t.orgId],
    );
    const late = await p.api.as(rep.token).delete(`/v2/calls/log/${id}`);
    expect(late.status).toBe(403);
    expect(late.body.code).toBe('CALL_LOG_EDIT_WINDOW_CLOSED');
    const read = await p.api.as(t.admin).get(`/v2/calling/call-logs/${id}`);
    expect(read.status).toBe(200);
    // The row moved since it was made (the clock above was set by hand): read its version as the screen would.
    const version = Number(
      (
        await rows<{ row_version: number }>(
          `SELECT row_version FROM call_log_entries WHERE org_id = $1`,
          [t.orgId],
        )
      )[0]!.row_version,
    );
    const byAdmin = await p.api
      .as(t.admin)
      .patch(`/v2/calls/log/${id}`)
      .send({ outcome: 'connected', rowVersion: version });
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);
  });

  it('honours the workspace edit window', async () => {
    const { t, contactId } = await setup('ed3');
    const put = await p.api
      .as(t.admin)
      .put('/v2/calls/logging-settings')
      .send({ createContactsFromUnknownCallers: false, editWindowHours: 1 });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({
      editWindowHours: 1,
      createContactsFromUnknownCallers: false,
      rowVersion: 1,
    });
    const rep = await p.api.member(t, 'Rep7', [['call.logs.create'], ['record.contacts.read']]);
    const made = await post(rep.token, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'busy',
    });
    await p.h.owner.query(
      `UPDATE call_log_entries SET created_at = now() - interval '90 minutes' WHERE org_id = $1`,
      [t.orgId],
    );
    expect((await p.api.as(rep.token).delete(`/v2/calls/log/${made.body.entry.id}`)).status).toBe(
      403,
    );
    const stale = await p.api
      .as(t.admin)
      .put('/v2/calls/logging-settings')
      .send({ createContactsFromUnknownCallers: true, editWindowHours: 2 });
    expect(stale.status).toBe(409);
    const fine = await p.api
      .as(t.admin)
      .put('/v2/calls/logging-settings')
      .send({ createContactsFromUnknownCallers: true, editWindowHours: 2, rowVersion: 1 });
    expect(fine.body).toMatchObject({
      createContactsFromUnknownCallers: true,
      editWindowHours: 2,
      rowVersion: 2,
    });
    expect(await p.api.auditCount(t.orgId, 'call_logging_settings', 'update')).toBe(1);
  });
});

describe('the contact’s calls and the Call logs screen', () => {
  async function withWhatsAppCall(t: Tenant, contactUuid: string, handlerUserId: number | null) {
    const number = await addNumber(p, t);
    const contact = (
      await rows<{ id: string }>(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuid])
    )[0]!.id;
    await p.h.owner.query(
      `INSERT INTO wa_calls (org_id, provider, wa_provider_config_id, meta_call_id, direction, from_phone, to_phone, contact_id, status,
                             handler_type, handler_user_id, started_at, answered_at, ended_at, duration_sec, end_reason)
       VALUES ($1,'waba',$2,$3,'USER_INITIATED','919811011111',$4,$5,'ended',$6,$7,$8,$8,$8,75,'COMPLETED')`,
      [
        t.orgId,
        number.configId,
        `wacid.log.${Date.now()}.${seq++}`,
        number.phone.replace(/\D/g, ''),
        contact,
        handlerUserId ? 'operator' : 'none',
        handlerUserId,
        iso(30 * 60_000),
      ],
    );
  }

  it('lists the WhatsApp calls and the logged calls together, tells them apart by source, and filters by source', async () => {
    const { t, contactId } = await setup('lst1');
    await withWhatsAppCall(t, contactId, t.adminUserId);
    await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 100,
      startedAt: iso(HOUR),
      notes: 'Sent the brochure',
    });
    await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'inbound',
      outcome: 'no_answer',
      startedAt: iso(2 * HOUR),
      source: 'web_click_to_call',
    });

    const all = await p.api.as(t.admin).get(`/v2/contacts/${contactId}/calls`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.data.map((r: { source: string }) => r.source)).toEqual([
      'whatsapp',
      'manual',
      'web_click_to_call',
    ]);
    expect(all.body.data[1]).toMatchObject({
      outcome: 'connected',
      status: 'completed',
      notesPreview: 'Sent the brochure',
      durationSec: 100,
      direction: 'outbound',
    });
    expect(all.body.data[2]).toMatchObject({
      outcome: 'no_answer',
      status: 'no-answer',
      direction: 'inbound',
    });
    expect(all.body.page).toMatchObject({ hasMore: false, nextCursor: null });

    const wa = await p.api.as(t.admin).get(`/v2/contacts/${contactId}/calls?source=whatsapp`);
    expect(wa.body.data).toHaveLength(1);
    const manual = await p.api.as(t.admin).get(`/v2/contacts/${contactId}/calls?source=manual`);
    expect(manual.body.data.map((r: { source: string }) => r.source)).toEqual(['manual']);

    const page1 = await p.api.as(t.admin).get(`/v2/contacts/${contactId}/calls?limit=2`);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.page.hasMore).toBe(true);
    const page2 = await p.api
      .as(t.admin)
      .get(
        `/v2/contacts/${contactId}/calls?limit=2&cursor=${encodeURIComponent(page1.body.page.nextCursor)}`,
      );
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].id).toBe(all.body.data[2].id);
    expect(
      (await p.api.as(t.admin).get(`/v2/contacts/${contactId}/calls?cursor=nonsense`)).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it('puts both logs on the Call logs screen with a source filter, the cards and the analytics by source', async () => {
    const { t, contactId } = await setup('lst2');
    await withWhatsAppCall(t, contactId, t.adminUserId);
    await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 120,
      startedAt: iso(HOUR),
    });
    await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'inbound',
      outcome: 'no_answer',
      startedAt: iso(2 * HOUR),
    });
    await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'declined',
      startedAt: iso(3 * HOUR),
    });

    const list = await p.api.as(t.admin).get('/v2/calling/call-logs');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.total).toBe(4);
    expect(list.body.rows.map((r: { source: string }) => r.source).sort()).toEqual([
      'manual',
      'manual',
      'manual',
      'whatsapp',
    ]);
    expect(list.body.kpis.workspace).toMatchObject({ total: 4, completed: 2, failed: 1 });
    expect(list.body.kpis.selection).toMatchObject({ total: 4, answered: 2, missed: 1 });

    const onlyWa = await p.api.as(t.admin).get('/v2/calling/call-logs?source=whatsapp');
    expect(onlyWa.body.total).toBe(1);
    expect(onlyWa.body.rows[0]).toMatchObject({
      source: 'whatsapp',
      status: 'completed',
      durationSec: 75,
    });
    const declined = await p.api.as(t.admin).get('/v2/calling/call-logs?status=declined');
    expect(declined.body.rows.map((r: { outcome: string }) => r.outcome)).toEqual(['declined']);
    const inbound = await p.api
      .as(t.admin)
      .get('/v2/calling/call-logs?source=manual&direction=inbound');
    expect(inbound.body.total).toBe(1);

    const stats = await p.api.as(t.admin).get('/v2/calling/call-logs/analytics?range=7d');
    expect(stats.status, JSON.stringify(stats.body)).toBe(200);
    const by = Object.fromEntries(
      stats.body.bySource.map(
        (s: { source: string; calls: number; answered: number; missed: number }) => [s.source, s],
      ),
    );
    expect(by.manual).toMatchObject({ calls: 3, answered: 1, missed: 1 });
    expect(by.whatsapp).toMatchObject({ calls: 1, answered: 1, missed: 0 });
    const filtered = await p.api
      .as(t.admin)
      .get('/v2/calling/call-logs/analytics?range=7d&source=manual');
    expect(filtered.body.totals).toMatchObject({ total: 3, answered: 1, missed: 1 });
    expect(filtered.body.bySource.map((s: { source: string }) => s.source)).toEqual(['manual']);
  });

  it('shows a logged call in the detail without any recording to play', async () => {
    const { t, contactId } = await setup('lst3');
    const made = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 10,
      notes: 'Quote sent',
    });
    const d = await p.api.as(t.admin).get(`/v2/calling/call-logs/${made.body.entry.id}`);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.call).toMatchObject({
      source: 'manual',
      outcome: 'connected',
      notes: 'Quote sent',
      contactName: 'Asha Rao',
    });
    expect(d.body.recording.available).toBe(false);
    expect(d.body.timeline[0]).toMatchObject({ type: 'logged', note: 'manual' });
    expect(
      (
        await p.api
          .as(t.admin)
          .post(`/v2/calling/call-logs/${made.body.entry.id}/playback`)
          .send({})
      ).status,
    ).toBe(403); // no role holds call.recordings.play any more, so the refusal comes before the "nothing to play" check
  });

  it('applies the record scope of call.logs.read by who handled the call, on the list, the contact and the detail', async () => {
    const { t, contactId } = await setup('scp1');
    const a = await p.api.member(t, 'ScopeA', [
      ['call.logs.create'],
      ['call.logs.read', 'own'],
      ['record.contacts.read'],
    ]);
    const b = await p.api.member(t, 'ScopeB', [
      ['call.logs.create'],
      ['call.logs.read', 'own'],
      ['record.contacts.read'],
    ]);
    const mine = await post(a.token, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 5,
    });
    const theirs = await post(b.token, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'busy',
    });
    const seenByA = await p.api.as(a.token).get('/v2/calling/call-logs');
    expect(seenByA.body.rows.map((r: { id: string }) => r.id)).toEqual([mine.body.entry.id]);
    expect(seenByA.body.kpis.workspace.total).toBe(1);
    const contactA = await p.api.as(a.token).get(`/v2/contacts/${contactId}/calls`);
    expect(contactA.body.data.map((r: { id: string }) => r.id)).toEqual([mine.body.entry.id]);
    expect(
      (await p.api.as(a.token).get(`/v2/calling/call-logs/${theirs.body.entry.id}`)).status,
    ).toBe(404);
    const everything = await p.api.as(t.admin).get('/v2/calling/call-logs');
    expect(everything.body.total).toBe(2);
    const filters = await p.api.as(a.token).get('/v2/calling/call-logs/filters');
    expect(filters.body.agents.map((x: { name: string }) => x.name)).toEqual(['ScopeA']);
  });

  it('applies the team scope through the teams a person belongs to', async () => {
    const { t, contactId } = await setup('scp2');
    const lead = await p.api.member(t, 'TeamLead', [
      ['call.logs.create'],
      ['call.logs.read', 'team'],
      ['record.contacts.read'],
    ]);
    const mate = await p.api.member(t, 'TeamMate', [
      ['call.logs.create'],
      ['record.contacts.read'],
    ]);
    const away = await p.api.member(t, 'Away', [['call.logs.create'], ['record.contacts.read']]);
    const team = await rows<{ id: string }>(
      `INSERT INTO teams (org_id, name) VALUES ($1, 'Sales') RETURNING id`,
      [t.orgId],
    );
    for (const u of [lead.userId, mate.userId]) {
      await p.h.owner.query(
        `INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`,
        [t.orgId, team[0]!.id, u],
      );
    }
    const m = await post(mate.token, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'busy',
    });
    await post(away.token, '/v2/calls/log', { contactId, direction: 'outbound', outcome: 'busy' });
    const seen = await p.api.as(lead.token).get('/v2/calling/call-logs');
    expect(seen.body.rows.map((r: { id: string }) => r.id)).toEqual([m.body.entry.id]);
  });
});

describe('another workspace', () => {
  it('cannot read, edit, delete or attach to a call or contact of this one, and RLS hides the tables', async () => {
    const a = await setup('iso1');
    const b = await setup('iso2');
    const made = await post(a.t.admin, '/v2/calls/log', {
      contactId: a.contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 5,
    });
    const id = made.body.entry.id as string;
    expect((await p.api.as(b.t.admin).get(`/v2/calling/call-logs/${id}`)).status).toBe(404);
    expect(
      (
        await p.api
          .as(b.t.admin)
          .patch(`/v2/calls/log/${id}`)
          .send({ outcome: 'busy', rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await p.api.as(b.t.admin).delete(`/v2/calls/log/${id}`)).status).toBe(404);
    expect((await p.api.as(b.t.admin).get(`/v2/contacts/${a.contactId}/calls`)).status).toBe(404);
    expect(
      (
        await post(b.t.admin, '/v2/calls/log', {
          contactId: a.contactId,
          direction: 'inbound',
          outcome: 'busy',
        })
      ).status,
    ).toBe(404);
    expect((await p.api.as(b.t.admin).get('/v2/calling/call-logs')).body.total).toBe(0);
    const stillThere = await rows(`SELECT 1 FROM call_log_entries WHERE org_id = $1`, [a.t.orgId]);
    expect(stillThere).toHaveLength(1);

    for (const table of [
      'call_log_entries',
      'call_logging_settings',
      'telephony_connections',
      'telephony_click_calls',
    ]) {
      const asTenant = async (orgId: number | null): Promise<number> => {
        await p.h.owner.query('BEGIN');
        try {
          await p.h.owner.query('SET LOCAL ROLE crm_app_user');
          if (orgId !== null)
            await p.h.owner.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
          return Number((await p.h.owner.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
        } finally {
          await p.h.owner.query('ROLLBACK');
        }
      };
      expect(await asTenant(null), `${table} without a tenant`).toBe(0);
      const own = Number(
        (await p.h.owner.query(`SELECT count(*) AS n FROM ${table} WHERE org_id = $1`, [b.t.orgId]))
          .rows[0].n,
      );
      expect(await asTenant(b.t.orgId), `${table} for B`).toBe(own);
    }
    await p.h.owner.query('BEGIN');
    try {
      await p.h.owner.query('SET LOCAL ROLE crm_app_user');
      await p.h.owner.query(`SELECT set_config('app.org_id', $1, true)`, [String(b.t.orgId)]);
      await expect(
        p.h.owner.query(
          `INSERT INTO call_log_entries (org_id, source, direction, outcome, started_at) VALUES ($1,'manual','inbound','busy',now())`,
          [a.t.orgId],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await p.h.owner.query('ROLLBACK');
    }
  });

  it('a composite foreign key keeps an entry from pointing at another workspace’s contact', async () => {
    const a = await setup('fk1');
    const b = await setup('fk2');
    const foreign = (
      await rows<{ id: string }>(`SELECT id FROM contacts WHERE uuid = $1`, [b.contactId])
    )[0]!.id;
    await expect(
      p.h.owner.query(
        `INSERT INTO call_log_entries (org_id, source, direction, outcome, started_at, contact_id) VALUES ($1,'manual','inbound','busy',now(),$2)`,
        [a.t.orgId, foreign],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('the mobile app', () => {
  const entry = (n: number, over: Record<string, unknown> = {}) => ({
    deviceCallId: String(n),
    direction: 'inbound',
    startedAt: iso(n * 60_000 + 60_000),
    durationSec: 45,
    customerPhone: '+919811300001',
    deviceCallType: 'incoming',
    ...over,
  });
  const batch = (entries: unknown[], deviceId = 'pixel-7') => ({
    deviceId,
    platform: 'android',
    entries,
  });

  it('stores the calls of known contacts, once, whatever number of times the batch is sent', async () => {
    const { t, contactId } = await setup('mob1', { phone: '+919811300001' });
    const body = batch([
      entry(1),
      entry(2, { direction: 'outbound', deviceCallType: 'outgoing', durationSec: 0 }),
      entry(3, { deviceCallType: 'missed', durationSec: 0 }),
    ]);
    const first = await post(t.admin, '/v2/calls/ingest', body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.counts).toEqual({ created: 3, duplicate: 0, ignored: 0, rejected: 0 });
    expect(first.body.results.map((r: { contactId: string }) => r.contactId)).toEqual([
      contactId,
      contactId,
      contactId,
    ]);
    const stored = await rows<{
      source: string;
      outcome: string;
      direction: string;
      external_id: string;
    }>(
      `SELECT source, outcome, direction, external_id FROM call_log_entries WHERE org_id = $1 ORDER BY external_id`,
      [t.orgId],
    );
    expect(stored.map((r) => [r.source, r.outcome, r.external_id])).toEqual([
      ['mobile_app', 'connected', 'pixel-7:1'],
      ['mobile_app', 'no_answer', 'pixel-7:2'],
      ['mobile_app', 'no_answer', 'pixel-7:3'],
    ]);
    const again = await post(t.admin, '/v2/calls/ingest', body);
    expect(again.body.counts).toEqual({ created: 0, duplicate: 3, ignored: 0, rejected: 0 });
    expect(again.body.results.map((r: { id: string }) => r.id)).toEqual(
      first.body.results.map((r: { id: string }) => r.id),
    );
    const half = await post(
      t.admin,
      '/v2/calls/ingest',
      batch([entry(3, { deviceCallType: 'missed', durationSec: 0 }), entry(4)]),
    );
    expect(half.body.counts).toEqual({ created: 1, duplicate: 1, ignored: 0, rejected: 0 });
    // Another install's id 1 is another call.
    const other = await post(t.admin, '/v2/calls/ingest', batch([entry(1)], 'iphone-12'));
    expect(other.body.counts.created).toBe(1);
    const lines = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM contact_activities WHERE org_id = $1 AND activity_type = 'call_mobile_app'`,
      [t.orgId],
    );
    expect(lines[0]!.n).toBe(5);
    // Every entry is the signed-in person’s own.
    const handlers = await rows<{ handler_user_id: string }>(
      `SELECT DISTINCT handler_user_id FROM call_log_entries WHERE org_id = $1`,
      [t.orgId],
    );
    expect(handlers.map((h) => Number(h.handler_user_id))).toEqual([t.adminUserId]);
  });

  it('does not store a call from a number no contact owns, and does not create the contact', async () => {
    const { t } = await setup('mob2', { phone: '+919811300002' });
    const res = await post(
      t.admin,
      '/v2/calls/ingest',
      batch([entry(1, { customerPhone: '+14155550111' })]),
    );
    expect(res.body.counts).toEqual({ created: 0, duplicate: 0, ignored: 1, rejected: 0 });
    expect(res.body.results[0]).toMatchObject({
      status: 'ignored',
      reason: 'unknown_number',
      id: null,
    });
    expect((await rows(`SELECT 1 FROM call_log_entries WHERE org_id = $1`, [t.orgId])).length).toBe(
      0,
    );
    expect((await rows(`SELECT 1 FROM contacts WHERE org_id = $1`, [t.orgId])).length).toBe(1);
  });

  it('creates the contact of an unknown caller when the workspace asked for it, owned by the person', async () => {
    const { t } = await setup('mob3');
    await p.api
      .as(t.admin)
      .put('/v2/calls/logging-settings')
      .send({ createContactsFromUnknownCallers: true, editWindowHours: 24 });
    const res = await post(
      t.admin,
      '/v2/calls/ingest',
      batch([entry(1, { customerPhone: '+14155550112' })]),
    );
    expect(res.body.counts.created).toBe(1);
    const c = await rows<{ owner_id: string; source: string; phone: string }>(
      `SELECT owner_id, source, phone FROM contacts WHERE org_id = $1 AND phone = '+14155550112'`,
      [t.orgId],
    );
    expect(c).toHaveLength(1);
    expect(Number(c[0]!.owner_id)).toBe(t.adminUserId);
    expect(c[0]!.source).toBe('mobile_app');
    expect(res.body.results[0].contactId).toBeTruthy();
    // The same stranger again is the same contact.
    const again = await post(
      t.admin,
      '/v2/calls/ingest',
      batch([entry(2, { customerPhone: '+14155550112' })]),
    );
    expect(again.body.results[0].contactId).toBe(res.body.results[0].contactId);
    expect(
      (await rows(`SELECT 1 FROM contacts WHERE org_id = $1 AND phone = '+14155550112'`, [t.orgId]))
        .length,
    ).toBe(1);
  });

  it('does not let a person without record.contacts.create make contacts, even with the switch on', async () => {
    const { t } = await setup('mob4');
    await p.api
      .as(t.admin)
      .put('/v2/calls/logging-settings')
      .send({ createContactsFromUnknownCallers: true, editWindowHours: 24 });
    const rep = await p.api.member(t, 'MobRep', [['call.logs.create'], ['record.contacts.read']]);
    const res = await post(
      rep.token,
      '/v2/calls/ingest',
      batch([entry(1, { customerPhone: '+14155550113' })]),
    );
    expect(res.body.results[0]).toMatchObject({ status: 'ignored', reason: 'unknown_number' });
  });

  it('answers each entry on its own: a bad one is rejected and the others are kept', async () => {
    const { t } = await setup('mob5', { phone: '+919811300001' });
    const res = await post(
      t.admin,
      '/v2/calls/ingest',
      batch([
        entry(1),
        entry(2, { customerPhone: 'private' }),
        entry(3, { startedAt: new Date(Date.now() + 3 * HOUR).toISOString() }),
        entry(4, { deviceCallType: 'blocked' }),
        entry(5, { contactId: '3f2b8c1a-0d7e-4a55-9b3c-1c2d3e4f5a6b' }),
        entry(6, { outcome: 'wrong_number' }),
      ]),
    );
    expect(res.status).toBe(200);
    expect(
      res.body.results.map((r: { status: string; reason: string | null }) => [r.status, r.reason]),
    ).toEqual([
      ['created', null],
      ['rejected', 'unusable_phone'],
      ['rejected', 'invalid_time'],
      ['ignored', 'blocked'],
      ['rejected', 'contact_not_found'],
      ['created', null],
    ]);
    expect(res.body.counts).toEqual({ created: 2, duplicate: 0, ignored: 1, rejected: 3 });
    const outcomes = await rows<{ outcome: string }>(
      `SELECT outcome FROM call_log_entries WHERE org_id = $1 ORDER BY external_id`,
      [t.orgId],
    );
    expect(outcomes.map((o) => o.outcome)).toEqual(['connected', 'wrong_number']);
  });

  it('takes at most 100 entries, and needs call.logs.create', async () => {
    const { t } = await setup('mob6');
    const hundred = Array.from({ length: 100 }, (_, i) =>
      entry(i, { customerPhone: '+14155550114' }),
    );
    expect((await post(t.admin, '/v2/calls/ingest', batch(hundred))).status).toBe(200);
    expect((await post(t.admin, '/v2/calls/ingest', batch([...hundred, entry(101)]))).status).toBe(
      422,
    );
    expect((await post(t.admin, '/v2/calls/ingest', batch([]))).status).toBe(422);
    const nobody = await p.api.member(t, 'MobNobody', [['record.contacts.read']]);
    expect((await post(nobody.token, '/v2/calls/ingest', batch([entry(1)]))).status).toBe(403);
    const anon = await p.api
      .http()
      .post('/v2/calls/ingest')
      .send(batch([entry(1)]));
    expect(anon.status).toBe(401);
  });

  it('does not let a person log a call on a contact they cannot read', async () => {
    const { t, contactId } = await setup('mob7', { phone: '+919811300001' });
    const rep = await p.api.member(t, 'MobScoped', [
      ['call.logs.create'],
      ['record.contacts.read', 'own'],
    ]);
    const res = await post(rep.token, '/v2/calls/ingest', batch([entry(1, { contactId })]));
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', reason: 'contact_not_found' });
    // By number alone the call is kept without the link, so it is not lost and the contact is not revealed.
    const byNumber = await post(rep.token, '/v2/calls/ingest', batch([entry(2)]));
    expect(byNumber.body.results[0]).toMatchObject({ status: 'created', contactId: null });
  });
});

describe('telephony', () => {
  const SECRET_RE = /^tws_[0-9a-f]{64}$/;

  async function connect(t: Tenant, over: Record<string, unknown> = {}) {
    const res = await post(t.admin, '/v2/calls/telephony/connections', {
      provider: 'fake',
      label: 'Sales line',
      numbers: ['+918012345678'],
      ...over,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return {
      id: res.body.connection.id as string,
      secret: res.body.secret as string,
      path: res.body.connection.webhookPath as string,
    };
  }

  const callbackBody = (over: Record<string, unknown> = {}, eventId = `evt-${seq++}`) =>
    JSON.stringify({
      id: eventId,
      type: 'call.completed',
      call: {
        id: `CA${seq++}`,
        direction: 'inbound',
        status: 'completed',
        from: '+919811400001',
        to: '+918012345678',
        startedAt: iso(10 * 60_000),
        durationSec: 125,
        ...over,
      },
    });

  const send = (path: string, raw: string, secret: string, at = Date.now(), tamper = false) => {
    const stamp = String(Math.floor(at / 1000));
    return p.api
      .http()
      .post(path)
      .set('content-type', 'application/json')
      .set(TELEPHONY_TIMESTAMP_HEADER, stamp)
      .set(
        TELEPHONY_SIGNATURE_HEADER,
        signTelephonyCallback(secret, stamp, Buffer.from(tamper ? `${raw} ` : raw)),
      )
      .send(raw);
  };

  const entriesOf = (t: Tenant) =>
    rows<{
      source: string;
      outcome: string;
      direction: string;
      contact_id: string | null;
      handler_user_id: string | null;
      number_label: string | null;
      duration_sec: number;
      recording_ref: string | null;
      external_id: string;
    }>(
      `SELECT source, outcome, direction, contact_id, handler_user_id, number_label, duration_sec, recording_ref, external_id FROM call_log_entries WHERE org_id = $1 ORDER BY id`,
      [t.orgId],
    );

  it('manages connections: the secret is shown once, kept encrypted, and the providers are listed', async () => {
    const { t } = await setup('tel1');
    const providers = await p.api.as(t.admin).get('/v2/calls/telephony/providers');
    expect(providers.body.rows.map((r: { key: string }) => r.key).sort()).toEqual([
      'fake',
      'generic',
    ]);
    expect(
      providers.body.rows.find((r: { key: string }) => r.key === 'generic').supportsClickToCall,
    ).toBe(false);
    const c = await connect(t);
    expect(c.secret).toMatch(SECRET_RE);
    expect(c.path).toBe(`/v2/public/webhooks/telephony/${c.id}`);
    const list = await p.api.as(t.admin).get('/v2/calls/telephony/connections');
    expect(list.body.rows).toHaveLength(1);
    expect(list.body.rows[0]).toMatchObject({
      id: c.id,
      provider: 'fake',
      label: 'Sales line',
      status: 'active',
      secretHint: c.secret.slice(-4),
    });
    expect(JSON.stringify(list.body)).not.toContain(c.secret);
    const stored = await rows<{ webhook_secret_cipher: string }>(
      `SELECT webhook_secret_cipher FROM telephony_connections WHERE org_id = $1`,
      [t.orgId],
    );
    expect(stored[0]!.webhook_secret_cipher).not.toContain(c.secret);
    const unknown = await post(t.admin, '/v2/calls/telephony/connections', {
      provider: 'knowlarity',
      label: 'x',
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('TELEPHONY_PROVIDER_UNKNOWN');
    expect(await p.api.auditCount(t.orgId, 'telephony_connections', 'insert')).toBe(1);
    expect(
      JSON.stringify(
        await rows(
          `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'telephony_connections'`,
          [t.orgId],
        ),
      ),
    ).not.toContain(c.secret);
    const gone = await p.api.as(t.admin).delete(`/v2/calls/telephony/connections/${c.id}`);
    expect(gone.status).toBe(204);
  });

  it('logs a finished call from a signed callback: acknowledged at once, applied by the worker, matched to the contact by number', async () => {
    const { t, contactId } = await setup('tel2', { phone: '+919811400001' });
    const c = await connect(t);
    const res = await send(c.path, callbackBody(), c.secret);
    expect(res.status).toBe(204);
    const [e] = await waitFor(async () => {
      const r = await entriesOf(t);
      return r.length ? r : false;
    });
    expect(e).toMatchObject({
      source: 'telephony',
      outcome: 'connected',
      direction: 'inbound',
      duration_sec: 125,
      number_label: 'Sales line',
      handler_user_id: null,
    });
    expect(e!.contact_id).not.toBeNull();
    const line = await rows<{ title: string; source: string; activity_type: string }>(
      `SELECT title, source, activity_type FROM contact_activities WHERE org_id = $1`,
      [t.orgId],
    );
    expect(line).toEqual([
      {
        title: 'Inbound call, Connected, 2 min',
        source: 'system',
        activity_type: 'call_telephony',
      },
    ]);
    const shown = await p.api.as(t.admin).get(`/v2/contacts/${contactId}/calls`);
    expect(shown.body.data[0]).toMatchObject({
      source: 'telephony',
      numberLabel: 'Sales line',
      outcome: 'connected',
    });
    const conn = await rows<{ last_event_at: string | null }>(
      `SELECT last_event_at FROM telephony_connections WHERE org_id = $1`,
      [t.orgId],
    );
    expect(conn[0]!.last_event_at).not.toBeNull();
    // A call from a number nobody knows is still logged: the line is the business’s own.
    await send(
      c.path,
      callbackBody({ from: '+14155550188', status: 'no_answer', durationSec: 0 }),
      c.secret,
    );
    const all = await waitFor(async () => {
      const r = await entriesOf(t);
      return r.length === 2 ? r : false;
    });
    expect(all[1]).toMatchObject({ outcome: 'no_answer', contact_id: null });
    expect(
      await p.api
        .as(t.admin)
        .get('/v2/calling/call-logs?source=telephony')
        .then((r) => r.body.total),
    ).toBe(2);
  });

  it('applies a retried callback once', async () => {
    const { t } = await setup('tel3', { phone: '+919811400001' });
    const c = await connect(t);
    const raw = callbackBody({ id: 'CA-same' }, 'evt-same');
    expect((await send(c.path, raw, c.secret)).status).toBe(204);
    expect((await send(c.path, raw, c.secret)).status).toBe(204);
    // The provider reports the same call under a new event id (a different retry path): still one entry.
    expect(
      (await send(c.path, callbackBody({ id: 'CA-same' }, 'evt-other'), c.secret)).status,
    ).toBe(204);
    await waitFor(async () => ((await entriesOf(t)).length >= 1 ? true : false));
    await new Promise((r) => setTimeout(r, 1500));
    expect(await entriesOf(t)).toHaveLength(1);
    expect(await p.api.events(t.orgId, 'call.logged')).toHaveLength(1);
  });

  it('refuses what is not proven: a wrong secret, a changed body, a replay, an unknown connection, no headers', async () => {
    const { t } = await setup('tel4', { phone: '+919811400001' });
    const c = await connect(t);
    const raw = callbackBody();
    expect((await send(c.path, raw, 'tws_not_the_secret')).status).toBe(401);
    expect((await send(c.path, raw, c.secret, Date.now(), true)).status).toBe(401);
    expect((await send(c.path, raw, c.secret, Date.now() - 10 * 60_000)).status).toBe(401);
    expect(
      (
        await send(
          '/v2/public/webhooks/telephony/3f2b8c1a-0d7e-4a55-9b3c-1c2d3e4f5a6b',
          raw,
          c.secret,
        )
      ).status,
    ).toBe(401);
    expect((await send('/v2/public/webhooks/telephony/not-a-uuid', raw, c.secret)).status).toBe(
      401,
    );
    const bare = await p.api.http().post(c.path).set('content-type', 'application/json').send(raw);
    expect(bare.status).toBe(401);
    // Another workspace's secret does not open this connection.
    const other = await setup('tel4b');
    const otherConn = await connect(other.t);
    expect((await send(c.path, raw, otherConn.secret)).status).toBe(401);
    await new Promise((r) => setTimeout(r, 800));
    expect(await entriesOf(t)).toHaveLength(0);
    expect(await entriesOf(other.t)).toHaveLength(0);
  });

  it('acknowledges but ignores a disabled connection, and stops honouring a rotated secret', async () => {
    const { t } = await setup('tel5', { phone: '+919811400001' });
    const c = await connect(t);
    const off = await p.api
      .as(t.admin)
      .patch(`/v2/calls/telephony/connections/${c.id}`)
      .send({ status: 'disabled' });
    expect(off.body.status).toBe('disabled');
    expect((await send(c.path, callbackBody(), c.secret)).status).toBe(204);
    await new Promise((r) => setTimeout(r, 800));
    expect(await entriesOf(t)).toHaveLength(0);
    await p.api
      .as(t.admin)
      .patch(`/v2/calls/telephony/connections/${c.id}`)
      .send({ status: 'active' });
    const rotated = await p.api
      .as(t.admin)
      .post(`/v2/calls/telephony/connections/${c.id}/rotate-secret`)
      .send({});
    expect(rotated.status).toBe(200);
    expect(rotated.body.secret).toMatch(SECRET_RE);
    expect(rotated.body.secret).not.toBe(c.secret);
    expect((await send(c.path, callbackBody(), c.secret)).status).toBe(401);
    expect((await send(c.path, callbackBody(), rotated.body.secret)).status).toBe(204);
    await waitFor(async () => ((await entriesOf(t)).length === 1 ? true : false));
  });

  it('needs call.logging.manage to run connections', async () => {
    const { t } = await setup('tel6');
    const rep = await p.api.member(t, 'TelRep', [['call.logs.create'], ['record.contacts.read']]);
    expect(
      (await post(rep.token, '/v2/calls/telephony/connections', { provider: 'fake', label: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (
        await p.api
          .as(rep.token)
          .put('/v2/calls/logging-settings')
          .send({ createContactsFromUnknownCallers: true, editWindowHours: 5 })
      ).status,
    ).toBe(403);
    expect((await p.api.as(rep.token).get('/v2/calls/logging-settings')).status).toBe(200);
  });

  it('places a click-to-call, then logs the finished call under the person and the contact who placed it', async () => {
    const { t, contactId, number } = await setup('ctc1', { phone: '+919811400001' });
    const c = await connect(t);
    const fake = p.h.app.get(FakeTelephonyProvider, { strict: false });
    fake.placed.length = 0;
    const res = await post(t.admin, '/v2/calls/click-to-call', {
      connectionId: c.id,
      contactId,
      agentPhone: '+919000000001',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.contactId).toBe(contactId);
    expect(fake.placed).toHaveLength(1);
    expect(fake.placed[0]).toMatchObject({
      agentNumber: '+919000000001',
      customerNumber: number,
      ourNumber: '+918012345678',
    });
    const kept = await rows(`SELECT 1 FROM telephony_click_calls WHERE org_id = $1`, [t.orgId]);
    expect(kept).toHaveLength(1);

    const done = callbackBody({
      id: res.body.callRef,
      direction: 'outbound',
      from: '+918012345678',
      to: number,
      durationSec: 200,
    });
    expect((await send(c.path, done, c.secret)).status).toBe(204);
    const [e] = await waitFor(async () => {
      const r = await entriesOf(t);
      return r.length ? r : false;
    });
    expect(e).toMatchObject({
      source: 'web_click_to_call',
      outcome: 'connected',
      direction: 'outbound',
      duration_sec: 200,
    });
    expect(Number(e!.handler_user_id)).toBe(t.adminUserId);
    const line = await rows<{ title: string }>(
      `SELECT title FROM contact_activities WHERE org_id = $1`,
      [t.orgId],
    );
    expect(line[0]!.title).toBe('Outbound call, Connected, 3 min, by Admin Person');
    expect(
      await rows(`SELECT 1 FROM telephony_click_calls WHERE org_id = $1`, [t.orgId]),
    ).toHaveLength(0);
    expect(await p.api.events(t.orgId, 'call.click_to_call.placed')).toHaveLength(1);
    // A call the provider reports as edited-by-nobody is not editable by the person who placed it.
    const entryId = (await p.api.as(t.admin).get(`/v2/contacts/${contactId}/calls`)).body.data[0]
      .id as string;
    const mate = await p.api.member(t, 'Placer', [['call.logs.create'], ['record.contacts.read']]);
    expect((await p.api.as(mate.token).delete(`/v2/calls/log/${entryId}`)).status).toBe(404);
  });

  it('refuses a click-to-call a provider cannot place, a disabled connection, and a provider refusal, without logging anything', async () => {
    const { t, contactId } = await setup('ctc2', { phone: '+919811400001' });
    const generic = await connect(t, { provider: 'generic', label: 'Relay' });
    const noBridge = await post(t.admin, '/v2/calls/click-to-call', {
      connectionId: generic.id,
      contactId,
      agentPhone: '+919000000001',
    });
    expect(noBridge.status).toBe(422);
    expect(noBridge.body.code).toBe('TELEPHONY_CLICK_UNSUPPORTED');
    const fakeConn = await connect(t);
    const noAgent = await post(t.admin, '/v2/calls/click-to-call', {
      connectionId: fakeConn.id,
      contactId,
    });
    expect(noAgent.status).toBe(422);
    expect(noAgent.body.code).toBe('CALL_LOG_CONTACT_REQUIRED');
    const fake = p.h.app.get(FakeTelephonyProvider, { strict: false });
    fake.refuse = 'The number is blocked by the carrier.';
    try {
      const refused = await post(t.admin, '/v2/calls/click-to-call', {
        connectionId: fakeConn.id,
        contactId,
        agentPhone: '+919000000001',
      });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('TELEPHONY_CALL_FAILED');
    } finally {
      fake.refuse = null;
    }
    await p.api
      .as(t.admin)
      .patch(`/v2/calls/telephony/connections/${fakeConn.id}`)
      .send({ status: 'disabled' });
    expect(
      (
        await post(t.admin, '/v2/calls/click-to-call', {
          connectionId: fakeConn.id,
          contactId,
          agentPhone: '+919000000001',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post(t.admin, '/v2/calls/click-to-call', {
          connectionId: '3f2b8c1a-0d7e-4a55-9b3c-1c2d3e4f5a6b',
          contactId,
          agentPhone: '+919000000001',
        })
      ).status,
    ).toBe(404);
    expect(
      await rows(`SELECT 1 FROM telephony_click_calls WHERE org_id = $1`, [t.orgId]),
    ).toHaveLength(0);
    expect(await entriesOf(t)).toHaveLength(0);
  });

  it('refuses a marketing call to a Do-Not-Call number before the provider is asked, and still allows a service call and logging', async () => {
    const { t, contactId, number } = await setup('dnc1', { phone: '+919811400009' });
    const c = await connect(t);
    const fake = p.h.app.get(FakeTelephonyProvider, { strict: false });
    fake.placed.length = 0;
    await p.h.owner.query(
      `INSERT INTO dnc_entries (org_id, phone, source) VALUES ($1, $2, 'manual')`,
      [t.orgId, number],
    );

    const checkMarketing = await post(t.admin, '/v2/calls/check', {
      contactId,
      purpose: 'marketing',
    });
    expect(checkMarketing.body).toEqual({ decision: 'deny', reason: 'on_dnc_list' });
    const checkByNumber = await post(t.admin, '/v2/calls/check', {
      customerPhone: number,
      purpose: 'marketing',
    });
    expect(checkByNumber.body).toEqual({ decision: 'deny', reason: 'on_dnc_list' });
    const checkService = await post(t.admin, '/v2/calls/check', { contactId });
    expect(checkService.body).toMatchObject({ decision: 'allow' });

    const marketing = await post(t.admin, '/v2/calls/click-to-call', {
      connectionId: c.id,
      contactId,
      agentPhone: '+919000000001',
      purpose: 'marketing',
    });
    expect(marketing.status).toBe(422);
    expect(marketing.body.code).toBe('CONSENT_OPTED_OUT');
    expect(marketing.body.errors).toEqual([{ path: 'reason', message: 'on_dnc_list' }]);
    const byNumber = await post(t.admin, '/v2/calls/click-to-call', {
      connectionId: c.id,
      customerPhone: number,
      agentPhone: '+919000000001',
      purpose: 'marketing',
    });
    expect(byNumber.status).toBe(422);
    expect(fake.placed).toHaveLength(0);
    expect(
      await rows(`SELECT 1 FROM telephony_click_calls WHERE org_id = $1`, [t.orgId]),
    ).toHaveLength(0);

    const service = await post(t.admin, '/v2/calls/click-to-call', {
      connectionId: c.id,
      contactId,
      agentPhone: '+919000000001',
    });
    expect(service.status, JSON.stringify(service.body)).toBe(200);
    expect(fake.placed).toHaveLength(1);
    const logged = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 12,
    });
    expect(logged.status).toBe(201);
  });

  it('refuses a marketing call to someone who unsubscribed, but not a service call', async () => {
    const { t, contactId } = await setup('dnc2', { phone: '+919811400010' });
    await p.h.owner.query(`UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(
      (await post(t.admin, '/v2/calls/check', { contactId, purpose: 'marketing' })).body,
    ).toEqual({ decision: 'deny', reason: 'withdrawn' });
    expect((await post(t.admin, '/v2/calls/check', { contactId })).body.decision).toBe('allow');
  });

  describe('a reference to a recording', () => {
    const recorded = (t: Tenant) =>
      rows<{
        recording_ref: string | null;
        recording_consent_status: string | null;
        recording_consent_method: string | null;
        recording_notice_version: number | null;
      }>(
        `SELECT recording_ref, recording_consent_status, recording_consent_method, recording_notice_version FROM call_log_entries WHERE org_id = $1 ORDER BY id`,
        [t.orgId],
      );

    it('is not kept while recording is switched off, however the callback is signed', async () => {
      const { t } = await setup('rec1', { phone: '+919811400001' });
      const c = await connect(t, { playsRecordingNotice: true });
      await send(c.path, callbackBody({ recordingRef: 'rec-secret-1' }), c.secret);
      await waitFor(async () => ((await entriesOf(t)).length === 1 ? true : false));
      expect((await recorded(t))[0]).toMatchObject({
        recording_ref: null,
        recording_consent_status: null,
      });
      const e = (await p.api.as(t.admin).get('/v2/calling/call-logs')).body.rows[0];
      expect(e.hasRecording).toBe(false);
    });

    it('is not kept when the connection does not attest that its notice is played, even with recording on', async () => {
      const { t } = await setup('rec2', { phone: '+919811400001' });
      const n = await addNumber(p, t);
      void n;
      await enableRecording(p, t, { mode: 'announcement' });
      const c = await connect(t, { playsRecordingNotice: false });
      await send(c.path, callbackBody({ recordingRef: 'rec-secret-2' }), c.secret);
      await waitFor(async () => ((await entriesOf(t)).length === 1 ? true : false));
      expect((await recorded(t))[0]!.recording_ref).toBeNull();
    });

    it('is not kept in the "confirmed" mode, where a spoken yes would be needed', async () => {
      const { t } = await setup('rec3', { phone: '+919811400001' });
      await enableRecording(p, t, { mode: 'confirmed' });
      const c = await connect(t, { playsRecordingNotice: true });
      await send(c.path, callbackBody({ recordingRef: 'rec-secret-3' }), c.secret);
      await waitFor(async () => ((await entriesOf(t)).length === 1 ? true : false));
      expect((await recorded(t))[0]!.recording_ref).toBeNull();
    });

    it('refuses to switch recording on without a notice, the rule the PUT route applies', async () => {
      const { t } = await setup('recnone', { phone: '+919811400002' });
      await expect(
        saveRecordingRules(p, t, {
          enabled: true,
          consentMode: 'confirmed',
          retentionDays: 90,
          noticeText: '  ',
        }),
      ).rejects.toThrow(
        'Write the recording notice (at least 10 characters) before switching recording on.',
      );
      const rows = await p.h.owner.query(
        `SELECT enabled FROM call_recording_settings WHERE org_id = $1`,
        [t.orgId],
      );
      expect(rows.rows).toEqual([]);
    });

    it('is kept with its consent evidence once recording is on, the mode is "announcement" and the connection plays the notice; then it is cleared after the retention window', async () => {
      const { t } = await setup('rec4', { phone: '+919811400001' });
      const settings = await enableRecording(p, t, { mode: 'announcement', retentionDays: 30 });
      const c = await connect(t, { playsRecordingNotice: true });
      await send(c.path, callbackBody({ recordingRef: 'rec-ok-1' }), c.secret);
      await waitFor(async () => ((await entriesOf(t)).length === 1 ? true : false));
      expect((await recorded(t))[0]).toEqual({
        recording_ref: 'rec-ok-1',
        recording_consent_status: 'granted',
        recording_consent_method: 'announcement_continue',
        recording_notice_version: settings.noticeVersion,
      });
      const row = (await p.api.as(t.admin).get('/v2/calling/call-logs')).body.rows[0];
      expect(row.hasRecording).toBe(true);
      expect(JSON.stringify(row)).not.toContain('rec-ok-1');
      const detail = await p.api.as(t.admin).get(`/v2/calling/call-logs/${row.id}`);
      expect(JSON.stringify(detail.body)).not.toContain('rec-ok-1');
      expect(
        (await p.api.as(t.admin).post(`/v2/calling/call-logs/${row.id}/playback`).send({})).status,
      ).toBe(403); // no role holds call.recordings.play any more

      // The database itself refuses a reference with no consent behind it.
      for (const change of [
        `recording_consent_status = NULL`,
        `recording_consent_status = 'declined'`,
        `recording_notice_version = NULL`,
      ]) {
        await expect(
          p.h.owner.query(`UPDATE call_log_entries SET ${change} WHERE org_id = $1`, [t.orgId]),
        ).rejects.toThrow(/recording_needs_consent|recording_consent/);
      }

      const sweep = p.h.app.get(CallLogRetentionService, { strict: false });
      await sweep.sweep();
      expect((await recorded(t))[0]!.recording_ref).toBe('rec-ok-1');
      await p.h.owner.query(
        `UPDATE call_log_entries SET recording_stored_at = now() - interval '31 days' WHERE org_id = $1`,
        [t.orgId],
      );
      await sweep.sweep();
      expect((await recorded(t))[0]!.recording_ref).toBeNull();
      const cleared = await rows<{ recording_deleted_at: string | null }>(
        `SELECT recording_deleted_at FROM call_log_entries WHERE org_id = $1`,
        [t.orgId],
      );
      expect(cleared[0]!.recording_deleted_at).not.toBeNull();
      expect(p.h.app.get(CallRecordingRetentionService, { strict: false })).toBeDefined();
    });
  });
});

describe('the database rules', () => {
  it('holds (source, external id) unique per workspace and lets NULL external ids repeat', async () => {
    const { t } = await setup('db1');
    const ins = (ext: string | null) =>
      p.h.owner.query(
        `INSERT INTO call_log_entries (org_id, source, direction, outcome, started_at, external_id) VALUES ($1,'telephony','inbound','busy',now(),$2)`,
        [t.orgId, ext],
      );
    await ins('x-1');
    await expect(ins('x-1')).rejects.toThrow(/uq_call_log_entries_external/);
    await ins(null);
    await ins(null);
    const other = await setup('db2');
    await p.h.owner.query(
      `INSERT INTO call_log_entries (org_id, source, direction, outcome, started_at, external_id) VALUES ($1,'telephony','inbound','busy',now(),'x-1')`,
      [other.t.orgId],
    );
  });

  it('refuses values outside the vocabularies, a phone that is not E.164 and notes over the cap', async () => {
    const { t } = await setup('db3');
    const bad = (cols: string, vals: unknown[]) =>
      p.h.owner.query(
        `INSERT INTO call_log_entries (org_id, started_at, ${cols}) VALUES ($1, now(), ${vals.map((_, i) => `$${i + 2}`).join(',')})`,
        [t.orgId, ...vals],
      );
    await expect(
      bad('source, direction, outcome', ['carrier_pigeon', 'inbound', 'busy']),
    ).rejects.toThrow(/ck_call_log_entries_source/);
    await expect(bad('source, direction, outcome', ['manual', 'sideways', 'busy'])).rejects.toThrow(
      /ck_call_log_entries_direction/,
    );
    await expect(bad('source, direction, outcome', ['manual', 'inbound', 'maybe'])).rejects.toThrow(
      /ck_call_log_entries_outcome/,
    );
    await expect(
      bad('source, direction, outcome, customer_phone', [
        'manual',
        'inbound',
        'busy',
        '9811300001',
      ]),
    ).rejects.toThrow(/ck_call_log_entries_phone/);
    await expect(
      bad('source, direction, outcome, notes', ['manual', 'inbound', 'busy', 'x'.repeat(2001)]),
    ).rejects.toThrow(/ck_call_log_entries_notes/);
    await expect(
      bad('source, direction, outcome, duration_sec', ['manual', 'inbound', 'busy', 90000]),
    ).rejects.toThrow(/ck_call_log_entries_duration/);
  });
});
