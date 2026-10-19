import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type {
  AppointmentMessenger,
  BookingMessage,
  BookingMessageResult,
} from '../../../src/infra/providers/appointments-booking';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { AppointmentMessageConsumer } from '../../../src/modules/appointments-booking/appointment-message.consumer';
import { AppointmentsRepository } from '../../../src/modules/appointments-booking/appointments.repository';
import { AppointmentsSupport } from '../../../src/modules/appointments-booking/appointments.support';
import { BookingTypesRepository } from '../../../src/modules/appointments-booking/booking-types.repository';
import { AppointmentsApi, bearer, startHarness, type Harness, type Tenant } from './support';

/**
 * Owner-enabled appointment channels and the predefined message library end to end (BL-350..BL-352): the real API, a real Postgres with
 * row-level security. Only Meta Graph is faked, at the HTTP edge (`WabaHttp.fetchImpl`), so a WhatsApp template really goes through the
 * platform's own template machinery (lint, plan cap, submission); Meta's decision is simulated by writing the status the sync would
 * write. NOT verified against the real Meta.
 */
Object.assign(process.env, {
  META_APP_ID: 'app-1',
  META_APP_SECRET: 'app-secret-1',
  META_EMBEDDED_CONFIG_ID: 'cfg-1',
});

let h: Harness;
let api: AppointmentsApi;
let db: DatabaseService;

interface Call {
  method: string;
  url: string;
  json: unknown;
}
let calls: Call[] = [];

beforeAll(async () => {
  h = await startHarness();
  api = new AppointmentsApi(h);
  db = h.app.get(DatabaseService);
  const http = h.app.get(WabaHttp);
  const fake: FetchLike = async (url, init) => {
    const call: Call = {
      method: String(init?.method),
      url,
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const path = new URL(url).pathname;
    if (call.method === 'POST' && /\/message_templates$/.test(path)) {
      return new Response(JSON.stringify({ id: 'M-APPT', status: 'PENDING', category: 'UTILITY' }), {
        status: 200,
      });
    }
    if (call.method === 'GET' && /\/message_templates$/.test(path)) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: 'unstubbed', code: 1 } }), { status: 404 });
  };
  http.fetchImpl = fake;
}, 900_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls = [];
});

afterEach(async () => {
  // One Meta number lives in one workspace (a unique index): release what a test connected.
  await h.owner.query(`DELETE FROM appointment_message_templates`);
  await h.owner.query(`DELETE FROM wa_templates`);
  await h.owner.query(`DELETE FROM wa_provider_configs WHERE provider IN ('waba', 'sms')`);
});

let seq = 0;
async function seedWaba(t: Tenant): Promise<{ id: number; uuid: string }> {
  const n = ++seq;
  const crypto = h.app.get(CryptoService, { strict: false });
  const res = await h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, credentials_json, meta_json, phone_number, display_label, is_primary, connected_at)
     VALUES ($1, 'waba', 'connected', $2, $3::jsonb, '+919112290122', 'Front desk', true, now()) RETURNING id, uuid`,
    [
      t.orgId,
      crypto.encrypt(JSON.stringify({ access_token: 'TOKEN-1' })),
      JSON.stringify({ waba_id: `7000${Date.now() % 100000}${n}`, phone_number_id: `8000${n}`, provider: 'meta' }),
    ],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

async function seedSms(t: Tenant, label = 'Sales SMS'): Promise<{ id: number; uuid: string }> {
  const res = await h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, is_primary, connected_at)
     VALUES ($1, 'sms', 'connected', $3, $2, false, now()) RETURNING id, uuid`,
    [t.orgId, label, `+1415555${String(1000 + ++seq)}`],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

const put = (token: string, path: string, body: unknown) =>
  api.http().put(path).set(bearer(token)).set('Idempotency-Key', crypto.randomUUID()).send(body as object);
const patch = (token: string, path: string, body: unknown) =>
  api.http().patch(path).set(bearer(token)).set('Idempotency-Key', crypto.randomUUID()).send(body as object);
const del = (token: string, path: string) =>
  api.http().delete(path).set(bearer(token)).set('Idempotency-Key', crypto.randomUUID());

const channelOf = (body: { data: Array<{ channel: string }> }, c: string) =>
  body.data.find((x) => x.channel === c) as Record<string, unknown>;

describe('the channels the owner allows (BL-350)', () => {
  it('a new workspace has chosen nothing; voice is listed as coming soon', async () => {
    const t = await api.signupUndecided('chn');
    const res = await api.as(t.admin).get('/v2/appointment-channels');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((c: { channel: string }) => c.channel)).toEqual(['email', 'whatsapp', 'sms', 'voice']);
    for (const c of ['email', 'whatsapp', 'sms']) {
      expect(channelOf(res.body, c)).toMatchObject({ enabled: false, decided: false, source: null, usable: false });
    }
    expect(channelOf(res.body, 'voice')).toMatchObject({ connection: 'coming_soon', enabled: false, usable: false });
  });

  it('the owner switches a channel on; it is usable only once a sender is connected', async () => {
    const t = await api.signupUndecided('chn');
    const on = await put(t.admin, '/v2/appointment-channels/sms', { enabled: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toMatchObject({ channel: 'sms', enabled: true, decided: true, source: 'owner', connection: 'not_connected', usable: false });

    await seedSms(t);
    const list = await api.as(t.admin).get('/v2/appointment-channels');
    expect(channelOf(list.body, 'sms')).toMatchObject({ enabled: true, connection: 'connected', usable: true });
    // Connected but not chosen is not usable either.
    await seedWaba(t);
    const again = await api.as(t.admin).get('/v2/appointment-channels');
    expect(channelOf(again.body, 'whatsapp')).toMatchObject({ enabled: false, connection: 'connected', usable: false });
  });

  it('voice cannot be switched on (reserved for the Voice bot)', async () => {
    const t = await api.signupUndecided('chn');
    const res = await put(t.admin, '/v2/appointment-channels/voice', { enabled: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('APPT_CHANNEL_COMING_SOON');
    const rows = await h.owner.query(`SELECT 1 FROM appointment_channel_settings WHERE org_id = $1 AND channel = 'voice'`, [t.orgId]);
    expect(rows.rowCount).toBe(0);
    // The database refuses it too.
    await expect(
      h.owner.query(`INSERT INTO appointment_channel_settings (org_id, channel, enabled) VALUES ($1, 'voice', true)`, [t.orgId]),
    ).rejects.toThrow(/chk_appointment_channel_settings_voice_off/);
    expect((await put(t.admin, '/v2/appointment-channels/fax', { enabled: true })).status).toBe(422);
  });

  it('a default sender must be a connected sender of that channel; null goes back to the first one', async () => {
    const t = await api.signupUndecided('chn');
    const a = await seedSms(t, 'First');
    const b = await seedSms(t, 'Second');
    const bad = await put(t.admin, '/v2/appointment-channels/sms', { enabled: true, defaultSenderId: crypto.randomUUID() });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('APPT_CHANNEL_SENDER_INVALID');
    const ok = await put(t.admin, '/v2/appointment-channels/sms', { enabled: true, defaultSenderId: b.uuid });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.defaultSenderId).toBe(b.uuid);
    expect(ok.body.senders.map((s: { id: string }) => s.id)).toEqual([a.uuid, b.uuid]);
    // Switching it off keeps the chosen sender (left out = unchanged); null clears it.
    const off = await put(t.admin, '/v2/appointment-channels/sms', { enabled: false });
    expect(off.body).toMatchObject({ enabled: false, defaultSenderId: b.uuid });
    const cleared = await put(t.admin, '/v2/appointment-channels/sms', { enabled: false, defaultSenderId: null });
    expect(cleared.body.defaultSenderId).toBeNull();
    // A sender of another workspace is not a sender here.
    const other = await api.signupUndecided('chn2');
    const foreign = await seedSms(other);
    const x = await put(t.admin, '/v2/appointment-channels/sms', { enabled: true, defaultSenderId: foreign.uuid });
    expect(x.status).toBe(422);
  });

  it('reading is for whoever can see booking types; changing is for the owner and the admin; every change is audited', async () => {
    const t = await api.signupUndecided('chn');
    const reader = await api.member(t, 'reader', [['record.booking-types.read']]);
    const plain = await api.member(t, 'plain', []);
    const manager = await api.member(t, 'manager', [['appointments.channels.manage']]);
    expect((await api.as(reader.token).get('/v2/appointment-channels')).status).toBe(200);
    expect((await api.as(plain.token).get('/v2/appointment-channels')).status).toBe(403);
    expect((await put(reader.token, '/v2/appointment-channels/email', { enabled: true })).status).toBe(403);
    expect((await put(manager.token, '/v2/appointment-channels/email', { enabled: true })).status).toBe(200);
    expect(await api.auditCount(t.orgId, 'appointment_channel_settings', 'insert')).toBe(1);
    await put(t.admin, '/v2/appointment-channels/email', { enabled: false });
    expect(await api.auditCount(t.orgId, 'appointment_channel_settings', 'update')).toBe(1);
  });

  it("another workspace's choice is invisible (row-level security)", async () => {
    const a = await api.signupUndecided('chn');
    const b = await api.signupUndecided('chn');
    await put(a.admin, '/v2/appointment-channels/email', { enabled: true });
    const res = await api.as(b.admin).get('/v2/appointment-channels');
    expect(channelOf(res.body, 'email')).toMatchObject({ enabled: false, decided: false });
  });

  it('a workspace with a plan without appointment booking is refused', async () => {
    const t = await api.signupUndecided('chn');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"appointment_booking":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await api.as(t.admin).get('/v2/appointment-channels');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
  });
});

describe('the predefined messages and the library (BL-351)', () => {
  it('lists the built-in set with which ones are adopted', async () => {
    const t = await api.signup('lib');
    const before = await api.as(t.admin).get('/v2/appointment-message-templates/predefined');
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.data).toHaveLength(10);
    expect(before.body.data.every((p: { adoptedId: string | null }) => p.adoptedId === null)).toBe(true);
    expect(before.body.whatsappPlaceholders).toEqual(['name', 'type', 'date', 'time', 'location', 'join_link', 'manage_link']);
    const adopt = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'confirmation', channel: 'email' });
    expect(adopt.status, JSON.stringify(adopt.body)).toBe(201);
    const after = await api.as(t.admin).get('/v2/appointment-message-templates/predefined');
    const entry = after.body.data.find((p: { key: string; channel: string }) => p.key === 'confirmation' && p.channel === 'email');
    expect(entry.adoptedId).toBe(adopt.body.template.id);
  });

  it('adopting an email message puts it in the library at once, usable, and once only', async () => {
    const t = await api.signup('lib');
    const res = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'reminder', channel: 'email' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.metaError).toBeNull();
    expect(res.body.template).toMatchObject({
      kind: 'reminder',
      channel: 'email',
      language: 'en',
      status: 'approved',
      usable: true,
      predefinedKey: 'reminder',
      waTemplateId: null,
    });
    expect(res.body.template.subject).toContain('{{type}}');
    expect(res.body.template.variables).toEqual(expect.arrayContaining(['type', 'name', 'date', 'time']));
    const again = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'reminder', channel: 'email' });
    expect(again.status).toBe(409);
    expect(calls).toHaveLength(0); // an email never touches Meta
    const unknown = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'nope', channel: 'email' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('APPT_TEMPLATE_INVALID');
    const lang = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'reminder', channel: 'email', language: 'fr' });
    expect(lang.status).toBe(422);
  });

  it('edits an email message, validates its placeholders, and guards against two editors', async () => {
    const t = await api.signup('lib');
    const adopted = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'cancellation', channel: 'email' });
    const id = adopted.body.template.id as string;
    const ok = await patch(t.admin, `/v2/appointment-message-templates/${id}`, {
      subject: 'We had to cancel {{type}}',
      body: 'Hi {{name}}, sorry: {{type}} on {{date}} is off.',
      rowVersion: adopted.body.template.rowVersion,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.template).toMatchObject({ subject: 'We had to cancel {{type}}', variables: ['type', 'name', 'date'] });
    const stale = await patch(t.admin, `/v2/appointment-message-templates/${id}`, { body: 'x', rowVersion: adopted.body.template.rowVersion });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    const typo = await patch(t.admin, `/v2/appointment-message-templates/${id}`, {
      body: 'Hi {{patient_name}}',
      rowVersion: ok.body.template.rowVersion,
    });
    expect(typo.status).toBe(422);
    expect(typo.body.code).toBe('APPT_TEMPLATE_INVALID');
    const off = await patch(t.admin, `/v2/appointment-message-templates/${id}`, { isActive: false, rowVersion: ok.body.template.rowVersion });
    expect(off.body.template).toMatchObject({ isActive: false, usable: false });
  });

  it("creates the owner's own email message; the name is unique per kind, channel and language", async () => {
    const t = await api.signup('lib');
    const body = { kind: 'follow_up', channel: 'email', name: 'Thanks', subject: 'Thanks', body: 'Thanks {{name}}!' };
    const first = await api.post(t.admin, '/v2/appointment-message-templates', body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.template.predefinedKey).toBeNull();
    expect((await api.post(t.admin, '/v2/appointment-message-templates', body)).status).toBe(409);
    expect((await api.post(t.admin, '/v2/appointment-message-templates', { ...body, channel: 'whatsapp', name: 'W' })).status).toBe(422);
    const list = await api.as(t.admin).get('/v2/appointment-message-templates?kind=follow_up&usable=true');
    expect(list.body.data).toHaveLength(1);
  });

  it('managing the library needs its own key; an admin has it', async () => {
    const t = await api.signup('lib');
    const reader = await api.member(t, 'reader', [['record.booking-types.read']]);
    expect((await api.as(reader.token).get('/v2/appointment-message-templates')).status).toBe(200);
    const res = await api.post(reader.token, '/v2/appointment-message-templates/adopt', { key: 'reminder', channel: 'email' });
    expect(res.status).toBe(403);
    const manager = await api.member(t, 'manager', [['appointments.templates.manage']]);
    expect((await api.post(manager.token, '/v2/appointment-message-templates/adopt', { key: 'reminder', channel: 'email' })).status).toBe(201);
  });

  it('removes a message unless a booking type chooses it', async () => {
    const t = await api.signup('lib');
    const adopted = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'confirmation', channel: 'email' });
    const id = adopted.body.template.id as string;
    const type = await api.type(t.admin, {
      name: 'Choosing',
      templates: [{ event: 'confirmation', channel: 'email', libraryTemplateId: id }],
    });
    expect(type.templates[0]).toMatchObject({ event: 'confirmation', channel: 'email', libraryTemplateId: id });
    const used = await del(t.admin, `/v2/appointment-message-templates/${id}`);
    expect(used.status).toBe(409);
    expect(used.body.code).toBe('APPT_TEMPLATE_IN_USE');
    const list = await api.as(t.admin).get('/v2/appointment-message-templates');
    expect(list.body.data[0].usedByTypes).toBe(1);
    await patch(t.admin, `/v2/booking-types/${type.id}`, { templates: [], rowVersion: type.rowVersion });
    expect((await del(t.admin, `/v2/appointment-message-templates/${id}`)).status).toBe(204);
  });
});

describe('WhatsApp messages go through Meta approval (BL-351)', () => {
  const adoptWa = (t: Tenant, key: string, extra: Record<string, unknown> = {}) =>
    api.post(t.admin, '/v2/appointment-message-templates/adopt', { key, channel: 'whatsapp', ...extra });

  it('needs a connected Cloud API number first', async () => {
    const t = await api.signup('wa');
    const res = await adoptWa(t, 'confirmation');
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('TPL_NO_CONNECTION');
    expect(calls).toHaveLength(0);
  });

  it('adopts as a draft (nothing sent to Meta), then is submitted, and only an APPROVED one is usable', async () => {
    const t = await api.signup('wa');
    await seedWaba(t);
    const draft = await adoptWa(t, 'confirmation');
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(draft.body.template).toMatchObject({
      kind: 'confirmation',
      channel: 'whatsapp',
      status: 'draft',
      usable: false,
      rejectionReason: null,
    });
    expect(draft.body.template.waTemplateId).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.body.template.connectionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    // The WhatsApp template exists in the template library with numbered placeholders and examples.
    const wa = await h.owner.query(`SELECT template_name, language, template_body, meta_category, variable_map, status FROM wa_templates WHERE org_id = $1`, [t.orgId]);
    expect(wa.rows[0]).toMatchObject({
      template_name: 'appt_confirmation_en',
      language: 'en',
      meta_category: 'UTILITY',
      status: 'draft',
    });
    expect(wa.rows[0].template_body).toBe('Hi {{1}}, your {{2}} is confirmed for {{3}} at {{4}}. We look forward to seeing you.');
    expect(wa.rows[0].variable_map.body.map((s: { key: string }) => s.key)).toEqual(['name', 'type', 'date', 'time']);

    // A draft cannot be chosen by a booking type.
    const id = draft.body.template.id as string;
    const early = await api.post(t.admin, '/v2/booking-types', {
      name: 'Too early',
      durationMinutes: 30,
      timezone: 'UTC',
      availability: [{ weekday: 1, from: '09:00', to: '17:00' }],
      templates: [{ event: 'confirmation', channel: 'whatsapp', libraryTemplateId: id }],
    });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('APPT_TEMPLATE_NOT_APPROVED');

    // Submit: it goes to Meta through the template machinery and shows as pending.
    const sub = await api.post(t.admin, `/v2/appointment-message-templates/${id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.metaError).toBeNull();
    expect(sub.body.template).toMatchObject({ status: 'pending', usable: false });
    const post = calls.find((c) => c.method === 'POST' && /message_templates$/.test(new URL(c.url).pathname));
    expect(post?.json).toMatchObject({ name: 'appt_confirmation_en', language: 'en', category: 'UTILITY' });

    // Meta decides (simulated: the status the sync would write).
    await h.owner.query(`UPDATE wa_templates SET status = 'approved', meta_status = 'APPROVED', approved_at = now() WHERE org_id = $1`, [t.orgId]);
    const approved = await api.as(t.admin).get(`/v2/appointment-message-templates/${id}`);
    expect(approved.body).toMatchObject({ status: 'approved', usable: true });

    // Now a booking type can choose it; the WhatsApp template is stored with it.
    const type = await api.type(t.admin, {
      name: 'Choosing WA',
      templates: [{ event: 'confirmation', channel: 'whatsapp', libraryTemplateId: id }],
    });
    expect(type.templates[0]).toMatchObject({ channel: 'whatsapp', libraryTemplateId: id, waTemplateId: draft.body.template.waTemplateId });
  });

  it("shows Meta's reason for a rejection, can edit the text of a rejected message and send it again", async () => {
    const t = await api.signup('wa');
    await seedWaba(t);
    const adopted = await adoptWa(t, 'reminder', { submit: true });
    expect(adopted.status, JSON.stringify(adopted.body)).toBe(201);
    expect(adopted.body.template.status).toBe('pending');
    const id = adopted.body.template.id as string;

    await h.owner.query(
      `UPDATE wa_templates SET status = 'rejected', meta_status = 'REJECTED', rejection_reason = 'The message looks promotional.' WHERE org_id = $1`,
      [t.orgId],
    );
    const rejected = await api.as(t.admin).get(`/v2/appointment-message-templates/${id}`);
    expect(rejected.body).toMatchObject({ status: 'rejected', rejectionReason: 'The message looks promotional.', usable: false });

    const bad = await patch(t.admin, `/v2/appointment-message-templates/${id}`, {
      body: 'Hi {{name}}, see {{slot}}',
      rowVersion: rejected.body.rowVersion,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('APPT_TEMPLATE_INVALID');
    const skipped = await patch(t.admin, `/v2/appointment-message-templates/${id}`, {
      body: 'Hi {{name}}, at {{time}}',
      rowVersion: rejected.body.rowVersion,
    });
    expect(skipped.status).toBe(422);

    const fixed = await patch(t.admin, `/v2/appointment-message-templates/${id}`, {
      body: 'Hi {{name}}, a note about your {{type}} on {{date}}. Reply here with any question.',
      submit: true,
      rowVersion: rejected.body.rowVersion,
    });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body.template.body).toContain('a note about your');
    const wa = await h.owner.query(`SELECT template_body FROM wa_templates WHERE org_id = $1`, [t.orgId]);
    expect(wa.rows[0].template_body).toBe('Hi {{1}}, a note about your {{2}} on {{3}}. Reply here with any question.');
  });

  it('an approved or in-review message cannot be edited here; the follow-up is submitted as marketing', async () => {
    const t = await api.signup('wa');
    await seedWaba(t);
    const adopted = await adoptWa(t, 'follow_up', { submit: true });
    expect(adopted.status, JSON.stringify(adopted.body)).toBe(201);
    const post = calls.find((c) => c.method === 'POST' && /message_templates$/.test(new URL(c.url).pathname));
    expect(post?.json).toMatchObject({ category: 'MARKETING' });
    const locked = await patch(t.admin, `/v2/appointment-message-templates/${adopted.body.template.id}`, {
      body: 'Hi {{name}}, thanks.',
      rowVersion: adopted.body.template.rowVersion,
    });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('APPT_TEMPLATE_INVALID');
  });

  it('submitting needs the template permissions too, not only the library key', async () => {
    const t = await api.signup('wa');
    await seedWaba(t);
    const manager = await api.member(t, 'manager', [['appointments.templates.manage']]);
    const res = await api.post(manager.token, '/v2/appointment-message-templates/adopt', { key: 'confirmation', channel: 'whatsapp' });
    expect(res.status).toBe(403); // creating the WhatsApp template needs tpl.templates.create
    const half = await api.member(t, 'half', [['appointments.templates.manage'], ['tpl.templates.create'], ['tpl.templates.read']]);
    const draft = await api.post(half.token, '/v2/appointment-message-templates/adopt', { key: 'confirmation', channel: 'whatsapp' });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const submit = await api.post(half.token, `/v2/appointment-message-templates/${draft.body.template.id}/submit`);
    expect(submit.status).toBe(403); // sending to Meta needs tpl.templates.sync
  });
});

describe('a booking type uses only what the owner allows (BL-350)', () => {
  const typeBody = (over: Record<string, unknown>) => ({
    name: `Gate ${Math.random().toString(36).slice(2, 6)}`,
    durationMinutes: 30,
    timezone: 'UTC',
    availability: [{ weekday: 1, from: '09:00', to: '17:00' }],
    ...over,
  });

  it('refuses a message or an active reminder on a channel the owner has not switched on', async () => {
    const t = await api.signupUndecided('gate');
    await put(t.admin, '/v2/appointment-channels/email', { enabled: true });
    const wa = await api.post(t.admin, '/v2/booking-types', typeBody({ templates: [{ event: 'confirmation', channel: 'whatsapp', plainBody: 'Hi' }] }));
    expect(wa.status).toBe(422);
    expect(wa.body.code).toBe('APPT_CHANNEL_NOT_ENABLED');
    expect(wa.body.details?.[0]?.path ?? JSON.stringify(wa.body)).toContain('templates.0');
    const rem = await api.post(t.admin, '/v2/booking-types', typeBody({ reminders: [{ offsetMinutes: 60, isActive: true, channels: ['email', 'sms'] }] }));
    expect(rem.status).toBe(422);
    expect(rem.body.code).toBe('APPT_CHANNEL_NOT_ENABLED');
    // A rule that is off names no channel for real, and email is on.
    const ok = await api.post(t.admin, '/v2/booking-types', typeBody({
      templates: [{ event: 'confirmation', channel: 'email', plainBody: 'Hi' }],
      reminders: [
        { offsetMinutes: 60, isActive: true, channels: ['email'] },
        { offsetMinutes: 30, isActive: false, channels: ['whatsapp', 'sms'] },
      ],
    }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('the reserved voice channel is refused on a reminder rule (the contract has no voice yet)', async () => {
    const t = await api.signup('gate');
    const res = await api.post(t.admin, '/v2/booking-types', typeBody({ reminders: [{ offsetMinutes: 60, isActive: true, channels: ['voice'] }] }));
    expect(res.status).toBe(422);
  });

  it('a type that already uses a channel keeps saving after the owner switches it off; adding it elsewhere is refused', async () => {
    const t = await api.signup('gate');
    const type = await api.type(t.admin, {
      name: 'Before',
      reminders: [{ offsetMinutes: 60, isActive: true, channels: ['sms'] }],
      templates: [{ event: 'reminder', channel: 'whatsapp', plainBody: 'See you' }],
    });
    await put(t.admin, '/v2/appointment-channels/sms', { enabled: false });
    await put(t.admin, '/v2/appointment-channels/whatsapp', { enabled: false });
    const same = await patch(t.admin, `/v2/booking-types/${type.id}`, {
      name: 'Renamed',
      reminders: [{ id: type.reminders[0]!.id, offsetMinutes: 60, isActive: true, channels: ['sms'] }],
      templates: [{ event: 'reminder', channel: 'whatsapp', plainBody: 'See you!' }],
      rowVersion: type.rowVersion,
    });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    const extra = await patch(t.admin, `/v2/booking-types/${type.id}`, {
      templates: [
        { event: 'reminder', channel: 'whatsapp', plainBody: 'See you!' },
        { event: 'confirmation', channel: 'whatsapp', plainBody: 'Booked' },
      ],
      rowVersion: same.body.rowVersion,
    });
    expect(extra.status).toBe(422);
    expect(extra.body.code).toBe('APPT_CHANNEL_NOT_ENABLED');
  });

  it('a library choice must be of the same kind and channel and belong to this workspace', async () => {
    const t = await api.signup('gate');
    const other = await api.signup('gate');
    const email = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'confirmation', channel: 'email' });
    const foreign = await api.post(other.admin, '/v2/appointment-message-templates/adopt', { key: 'confirmation', channel: 'email' });
    const wrongKind = await api.post(t.admin, '/v2/booking-types', typeBody({ templates: [{ event: 'cancellation', channel: 'email', libraryTemplateId: email.body.template.id }] }));
    expect(wrongKind.status).toBe(422);
    const wrongChannel = await api.post(t.admin, '/v2/booking-types', typeBody({ templates: [{ event: 'confirmation', channel: 'whatsapp', libraryTemplateId: email.body.template.id }] }));
    expect(wrongChannel.status).toBe(422);
    const theirs = await api.post(t.admin, '/v2/booking-types', typeBody({ templates: [{ event: 'confirmation', channel: 'email', libraryTemplateId: foreign.body.template.id }] }));
    expect(theirs.status).toBe(422);
    const fine = await api.post(t.admin, '/v2/booking-types', typeBody({ templates: [{ event: 'confirmation', channel: 'email', libraryTemplateId: email.body.template.id }] }));
    expect(fine.status, JSON.stringify(fine.body)).toBe(201);
  });
});

class FakeMessenger implements AppointmentMessenger {
  readonly name = 'fake';
  sent: BookingMessage[] = [];
  async send(m: BookingMessage): Promise<BookingMessageResult> {
    this.sent.push(m);
    return { status: 'sent' };
  }
}

describe('the booking message uses the library message that was chosen (BL-351)', () => {
  it('an email confirmation is the library text and subject, read when it is sent; editing the library changes the next message', async () => {
    const t = await api.signup('use');
    const messenger = new FakeMessenger();
    const consumer = new AppointmentMessageConsumer(
      db,
      h.app.get(AppointmentsRepository),
      h.app.get(BookingTypesRepository),
      h.app.get(AppointmentsSupport),
      new OutboxSubscriberRegistry(),
      messenger,
    );
    const adopted = await api.post(t.admin, '/v2/appointment-message-templates/adopt', { key: 'confirmation', channel: 'email' });
    const libId = adopted.body.template.id as string;
    const type = await api.type(t.admin, {
      name: 'Consultation',
      templates: [{ event: 'confirmation', channel: 'email', libraryTemplateId: libId }],
    });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'Ana', phone: '+919811166611', email: 'ana@example.com' },
    });
    const ev = async (): Promise<OutboxEvent> => {
      const res = await h.owner.query(
        `SELECT id::text AS id, org_id, aggregate_module, aggregate_id::text AS aggregate_id, event_type, payload
           FROM event_outbox WHERE org_id = $1 AND event_type = 'appointment.booked' AND payload->>'uuid' = $2 ORDER BY id LIMIT 1`,
        [t.orgId, a.id],
      );
      const r = res.rows[0];
      return { id: r.id, orgId: Number(r.org_id), aggregateModule: r.aggregate_module, aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload };
    };
    messenger.sent = [];
    await consumer.handle(await ev());
    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]).toMatchObject({ channel: 'email', subject: 'Your Consultation is confirmed' });
    expect(messenger.sent[0]!.body).toContain('Hi Ana,');
    expect(messenger.sent[0]!.body).toContain('Your Consultation is confirmed for');

    await patch(t.admin, `/v2/appointment-message-templates/${libId}`, {
      subject: 'All set for {{name}}',
      body: 'Edited for {{name}}: {{type}}.',
      rowVersion: adopted.body.template.rowVersion,
    });
    messenger.sent = [];
    await consumer.handle(await ev());
    expect(messenger.sent[0]).toMatchObject({ subject: 'All set for Ana' });
    expect(messenger.sent[0]!.body.startsWith('Edited for Ana: Consultation.')).toBe(true);

    // Switched off in the library, the type's own text (here none) takes over.
    const cur = await api.as(t.admin).get(`/v2/appointment-message-templates/${libId}`);
    await patch(t.admin, `/v2/appointment-message-templates/${libId}`, { isActive: false, rowVersion: cur.body.rowVersion });
    messenger.sent = [];
    await consumer.handle(await ev());
    expect(messenger.sent[0]!.body).toMatch(/^Booked: Consultation on /);
  });
});
