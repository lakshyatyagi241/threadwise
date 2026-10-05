import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { APPOINTMENT_CALENDAR } from '../../../src/infra/providers/appointments-booking';
import type { OutboxEvent } from '../../../src/kernel/outbox/outbox-subscribers';
import { AppointmentCalendarConsumer } from '../../../src/modules/appointments-booking/appointment-calendar.consumer';
import { GoogleCalendarAdapter } from '../../../src/modules/appointments-booking/google-calendar.adapter';
import {
  deriveStateKey,
  newState,
  signState,
} from '../../../src/modules/appointments-booking/google-calendar-state';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import { FakeGoogle } from './fake-google';
import { AppointmentsApi, startHarness, type Harness, type Tenant } from './support';

/**
 * Google Calendar for a workspace (WD-APPT-028, 029, D-08), end to end through HTTP: the operator's Google client in the console, the
 * consent round trip and its public callback, choosing a calendar, writing / moving / deleting events through the real outbox consumer,
 * busy time in the slots, a grant Google refuses, and disconnecting.
 *
 * Google itself is a local stand-in (`fake-google.ts`) written from Google's documentation. Nothing here talks to a real Google account,
 * so what is proved is the adapter against that description, not against Google.
 */
let h: Harness;
let api: AppointmentsApi;
let fake: FakeGoogle;
let consumer: AppointmentCalendarConsumer;
let adapter: GoogleCalendarAdapter;
let a: Tenant; // the workspace that connects
let b: Tenant; // a neighbour that must never see it
let operator = '';

const ANA = 'ana@example.com';
const CALLBACK = '/v2/public/appointments/calendar/google/callback';
const SETTINGS_PAGE = 'http://localhost:3001/appointments/settings';
const STATE_KEY = deriveStateKey(Buffer.alloc(32, 7).toString('base64'));
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  fake = await FakeGoogle.start();
  for (const k of [
    ...Object.keys(fake.env()),
    'GOOGLE_CALENDAR_CLIENT_ID',
    'GOOGLE_CALENDAR_CLIENT_SECRET',
    'GOOGLE_BUSY_CACHE_SECONDS',
    'GOOGLE_BUSY_BACKOFF_SECONDS',
  ]) {
    saved[k] = process.env[k];
  }
  Object.assign(process.env, fake.env(), {
    GOOGLE_BUSY_CACHE_SECONDS: '0',
    GOOGLE_BUSY_BACKOFF_SECONDS: '0',
  });
  delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
  delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  // The worker module is added next to the app, so the calendar consumer is the real one, wired by Nest exactly as the worker process
  // wires it (it does not drain the outbox here: the test hands it events, as the drain would).
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/appointments-booking/appointments-booking-worker.module'))
        .AppointmentsBookingWorkerModule,
    ],
  });
  api = new AppointmentsApi(h);
  adapter = h.app.get(GoogleCalendarAdapter);
  consumer = h.app.get(AppointmentCalendarConsumer);
  expect(h.app.get(APPOINTMENT_CALENDAR)).toBe(adapter);
  a = await api.signup('gca');
  b = await api.signup('gcb');

  const first = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/mfa/setup')
    .set({ authorization: `Bearer ${token}` });
  const code = hotp(base32Decode(setup.body.secret as string), totpStep(Date.now()));
  const enabled = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/mfa/enable')
    .set({ authorization: `Bearer ${token}` })
    .send({ code });
  expect(enabled.status).toBe(201);
  operator = token;
}, 300_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await h?.stop();
  await fake?.stop();
});

// --- helpers ---------------------------------------------------------------------------------------------------------

const status = async (t: Tenant) => {
  const res = await api.as(t.admin).get('/v2/appointments/calendar');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    provider: string;
    connected: boolean;
    account: string | null;
    status: string;
    calendarId: string | null;
    calendarName: string | null;
    connectedAt: string | null;
  };
};
const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

/** The admin presses Connect; Google redirects back with a code. Returns where the callback sent the browser. */
async function connect(
  t: Tenant,
  codeName: string,
  opts: { scope?: string; refresh?: boolean; email?: string } = {},
): Promise<string> {
  const start = await api.post(t.admin, '/v2/appointments/calendar/google/start', {
    returnTo: '/appointments/settings',
  });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = new URL(start.body.url as string).searchParams.get('state')!;
  fake.grant(codeName, fake.account(opts.email ?? ANA), opts);
  const res = await request(h.app.getHttpServer())
    .get(CALLBACK)
    .query({ code: codeName, state })
    .redirects(0);
  expect(res.status).toBe(302);
  return res.headers.location as string;
}

const rows = async (orgId: number) =>
  (await h.owner.query(`SELECT * FROM appointment_calendar_connections WHERE org_id = $1`, [orgId]))
    .rows as Array<Record<string, unknown>>;

const outboxTypes = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT event_type FROM event_outbox WHERE org_id = $1 AND event_type LIKE 'appointment_calendar.%' ORDER BY id`,
      [orgId],
    )
  ).rows.map((r) => r.event_type as string);

async function bookingEvents(orgId: number, type: string, uuid: string): Promise<OutboxEvent[]> {
  const res = await h.owner.query(
    `SELECT id::text AS id, org_id, aggregate_module, aggregate_id::text AS aggregate_id, event_type, payload
       FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
    [orgId, type],
  );
  return res.rows
    .map((r) => ({
      id: r.id as string,
      orgId: Number(r.org_id),
      aggregateModule: r.aggregate_module as string,
      aggregateId: r.aggregate_id as string,
      eventType: r.event_type as string,
      payload: r.payload as Record<string, unknown>,
    }))
    .filter((e) => e.payload.uuid === uuid);
}
const lastEvent = async (type: string, uuid: string) =>
  (await bookingEvents(a.orgId, type, uuid)).at(-1)!;

const operatorPatch = async (
  values: Record<string, unknown>,
  secrets: Record<string, string> = {},
) => {
  const get = await request(h.app.getHttpServer())
    .get('/v2/platform/settings/groups/googleCalendar')
    .set({ authorization: `Bearer ${operator}` });
  expect(get.status, JSON.stringify(get.body)).toBe(200);
  return request(h.app.getHttpServer())
    .patch('/v2/platform/settings/groups/googleCalendar')
    .set({ authorization: `Bearer ${operator}` })
    .send({ rowVersion: get.body.rowVersion, values, secrets });
};

// --- the platform's Google client ------------------------------------------------------------------------------------

describe("the operator's Google client (WD-APPT-028)", () => {
  it('without one, a workspace sees Google Calendar as unavailable and cannot start connecting', async () => {
    const s = await status(a);
    expect(s).toMatchObject({
      provider: 'google',
      connected: false,
      status: 'unavailable',
      account: null,
      calendarId: null,
      connectedAt: null,
    });
    const start = await api.post(a.admin, '/v2/appointments/calendar/google/start', {});
    expect(start.status).toBe(422);
    expect(code(start)).toBe('APPT_CALENDAR_NOT_CONFIGURED');
    expect(fake.requests).toHaveLength(0);
  });

  it('the environment is the fallback: with a client id and secret there, the workspace can connect', async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'env-client';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'env-secret';
    expect((await status(a)).status).toBe('disconnected');
    const start = await api.post(a.admin, '/v2/appointments/calendar/google/start', {});
    expect(new URL(start.body.url as string).searchParams.get('client_id')).toBe('env-client');
  });

  it('what the operator saves in the console wins; the secret is sealed and never read back', async () => {
    const res = await operatorPatch(
      { clientId: 'console-client' },
      { clientSecret: 'console-secret' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.values).toMatchObject({ clientId: 'console-client', enabled: true });
    expect(res.body.secrets.clientSecret).toEqual({ isSet: true });
    expect(JSON.stringify(res.body)).not.toContain('console-secret');
    // The address to register on the Google client is worked out and shown.
    expect(res.body.extra.redirectUri).toBe(`http://localhost:3999${CALLBACK}`);

    const stored = await h.owner.query(
      `SELECT value, is_secret FROM platform_settings WHERE key = 'set.googleCalendar.clientSecret'`,
    );
    expect(stored.rows[0].is_secret).toBe(true);
    expect(JSON.stringify(stored.rows[0].value)).not.toContain('console-secret');

    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    fake.clientId = 'console-client';
    fake.clientSecret = 'console-secret';
    const start = await api.post(a.admin, '/v2/appointments/calendar/google/start', {});
    expect(new URL(start.body.url as string).searchParams.get('client_id')).toBe('console-client');
  });

  it('switching it off makes Google Calendar unavailable again, without deleting the client', async () => {
    expect((await operatorPatch({ enabled: false })).status).toBe(200);
    expect((await status(a)).status).toBe('unavailable');
    expect((await api.post(a.admin, '/v2/appointments/calendar/google/start', {})).status).toBe(
      422,
    );
    expect((await operatorPatch({ enabled: true })).status).toBe(200);
    expect((await status(a)).status).toBe('disconnected');
  });

  it("is not reachable with a workspace admin's token: the console is for platform operators", async () => {
    const res = await request(h.app.getHttpServer())
      .get('/v2/platform/settings/groups/googleCalendar')
      .set({ authorization: `Bearer ${a.admin}` });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(500);
  });
});

// --- connecting ------------------------------------------------------------------------------------------------------

describe('connecting a workspace (WD-APPT-028)', () => {
  it('start returns the consent URL: calendar scopes, offline access, a fresh consent, and a signed state', async () => {
    const start = await api.post(a.admin, '/v2/appointments/calendar/google/start', {
      returnTo: '/appointments/settings',
    });
    expect(start.status).toBe(200);
    expect(start.body.expiresInSeconds).toBe(600);
    const url = new URL(start.body.url as string);
    expect(url.origin + url.pathname).toBe(`${fake.url}/auth`);
    expect(url.searchParams.get('client_id')).toBe('console-client');
    expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:3999${CALLBACK}`);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(scopes.some((s) => /drive|spreadsheets/.test(s))).toBe(false);
    expect(url.searchParams.get('state')!.length).toBeGreaterThan(40);
  });

  it('start refuses a return address outside the app, and a caller without the booking-settings capability', async () => {
    const outside = await api.post(a.admin, '/v2/appointments/calendar/google/start', {
      returnTo: 'https://evil.example/steal',
    });
    expect(outside.status).toBe(422);
    const agent = await api.member(a, 'agent', [
      ['record.appointments.read'],
      ['record.booking-types.read'],
    ]);
    for (const [method, path] of [
      ['post', '/v2/appointments/calendar/google/start'],
      ['get', '/v2/appointments/calendar/google/calendars'],
      ['put', '/v2/appointments/calendar/google/calendar'],
      ['post', '/v2/appointments/calendar/google/disconnect'],
    ] as const) {
      const res = await api.as(agent.token)[method](path).send({ calendarId: 'x' });
      expect(res.status, path).toBe(403);
    }
    // Seeing whether a calendar is connected is an appointments read.
    expect((await api.as(agent.token).get('/v2/appointments/calendar')).status).toBe(200);
    const anon = await request(h.app.getHttpServer()).post(
      '/v2/appointments/calendar/google/start',
    );
    expect(anon.status).toBe(401);
  });

  it('the public callback exchanges the code, stores the grant sealed, and sends the browser back with ?calendar=connected', async () => {
    const where = await connect(a, 'code-a');
    expect(where).toBe(`${SETTINGS_PAGE}?calendar=connected`);

    // Google was asked as the platform's client, for this redirect URI.
    const exchange = fake.forms('authorization_code').at(-1)!.body;
    expect(exchange).toMatchObject({
      code: 'code-a',
      client_id: 'console-client',
      client_secret: 'console-secret',
      redirect_uri: `http://localhost:3999${CALLBACK}`,
    });

    const [row] = await rows(a.orgId);
    expect(row).toMatchObject({
      account_email: ANA,
      status: 'active',
      calendar_id: 'primary',
      provider: 'google',
    });
    expect(Number(row!.connected_by)).toBe(a.adminUserId);
    // Sealed: a `v1:` blob, and no token in the clear anywhere in the row.
    expect(String(row!.refresh_token_enc)).toMatch(/^v1:/);
    expect(String(row!.access_token_enc)).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toMatch(/rt-code-a|at-\d/);

    expect(await status(a)).toMatchObject({
      provider: 'google',
      connected: true,
      status: 'connected',
      account: ANA,
      calendarId: 'primary',
    });
    expect(await outboxTypes(a.orgId)).toEqual(['appointment_calendar.connected']);
    expect(await api.auditCount(a.orgId, 'appointment_calendar', 'insert')).toBe(1);
  });

  it('another workspace sees nothing of it', async () => {
    expect(await status(b)).toMatchObject({
      connected: false,
      status: 'disconnected',
      account: null,
    });
    expect(await rows(b.orgId)).toHaveLength(0);
    const list = await api.as(b.admin).get('/v2/appointments/calendar/google/calendars');
    expect(list.status).toBe(409);
    expect(code(list)).toBe('APPT_CALENDAR_NOT_CONNECTED');
  });

  it('refuses a callback whose state is forged, tampered or expired, before it ever calls Google', async () => {
    const before = fake.requests.length;
    const noState = await request(h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code: 'x' })
      .redirects(0);
    expect(noState.headers.location).toBe(`${SETTINGS_PAGE}?calendar=failed`);

    const good = signState(
      newState({ orgId: b.orgId, userId: null, returnTo: '/appointments/settings' }, Date.now()),
      STATE_KEY,
    );
    const tampered = `${good.slice(0, -3)}AAA`;
    const forged = await request(h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code: 'x', state: tampered })
      .redirects(0);
    expect(forged.headers.location).toBe(`${SETTINGS_PAGE}?calendar=failed`);

    const old = signState(
      newState(
        { orgId: b.orgId, userId: null, returnTo: '/appointments/settings' },
        Date.now() - 3_600_000,
      ),
      STATE_KEY,
    );
    const expired = await request(h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code: 'x', state: old })
      .redirects(0);
    expect(expired.headers.location).toBe(`${SETTINGS_PAGE}?calendar=expired`);

    expect(fake.requests).toHaveLength(before);
    expect(await rows(b.orgId)).toHaveLength(0);
  });

  it('a person who says no on Google stores nothing', async () => {
    const start = await api.post(b.admin, '/v2/appointments/calendar/google/start', {});
    const state = new URL(start.body.url as string).searchParams.get('state')!;
    const res = await request(h.app.getHttpServer())
      .get(CALLBACK)
      .query({ error: 'access_denied', state })
      .redirects(0);
    expect(res.headers.location).toBe(`${SETTINGS_PAGE}?calendar=denied`);
    expect(await rows(b.orgId)).toHaveLength(0);
  });

  it('a consent with a calendar permission unticked is withdrawn and stores nothing', async () => {
    const where = await connect(b, 'code-noscope', {
      email: 'bea@example.com',
      scope:
        'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.freebusy',
    });
    expect(where).toBe(`${SETTINGS_PAGE}?calendar=missing_scope`);
    expect(fake.revoked.length).toBeGreaterThan(0);
    expect(await rows(b.orgId)).toHaveLength(0);
  });

  it('a consent that brings no refresh token cannot be used, and is withdrawn', async () => {
    const revokedBefore = fake.revoked.length;
    const where = await connect(b, 'code-norefresh', { email: 'bea@example.com', refresh: false });
    expect(where).toBe(`${SETTINGS_PAGE}?calendar=failed`);
    expect(fake.revoked.length).toBe(revokedBefore + 1);
    expect(await rows(b.orgId)).toHaveLength(0);
  });

  it('a code that was already used fails, and leaves the connection it would have replaced untouched', async () => {
    const start = await api.post(a.admin, '/v2/appointments/calendar/google/start', {});
    const state = new URL(start.body.url as string).searchParams.get('state')!;
    const res = await request(h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code: 'code-a', state })
      .redirects(0);
    expect(res.headers.location).toBe(`${SETTINGS_PAGE}?calendar=failed`);
    expect(await status(a)).toMatchObject({ connected: true, account: ANA });
  });

  it('Google being unreachable while the code is exchanged ends in a clean failure', async () => {
    fake.failNext('POST', /^\/token$/, 503);
    expect(await connect(b, 'code-outage', { email: 'bea@example.com' })).toBe(
      `${SETTINGS_PAGE}?calendar=failed`,
    );
    expect(await rows(b.orgId)).toHaveLength(0);
  });
});

// --- choosing the calendar -------------------------------------------------------------------------------------------

describe('choosing which calendar bookings go to', () => {
  beforeAll(() => {
    fake.calendars.push(
      { id: 'team@example.com', summary: 'Team calendar', accessRole: 'writer' },
      { id: 'holidays@example.com', summary: 'Holidays', accessRole: 'reader' },
    );
  });

  it('lists the calendars the account can write to, the primary one first; a read-only one is not offered', async () => {
    const res = await api.as(a.admin).get('/v2/appointments/calendar/google/calendars');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([ANA, 'team@example.com']);
    expect(res.body.data[0]).toMatchObject({ primary: true, name: ANA });
    const asked = fake.requests.filter((r) => r.path.endsWith('/users/me/calendarList')).at(-1)!;
    expect(asked.query.get('minAccessRole')).toBe('writer');
  });

  it('picks one from that list, shows its name, and refuses an id the account cannot write to', async () => {
    const bad = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/google/calendar')
      .send({ calendarId: 'holidays@example.com' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors?.[0]?.path).toBe('calendarId');

    const ok = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/google/calendar')
      .send({ calendarId: 'team@example.com' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      connected: true,
      calendarId: 'team@example.com',
      calendarName: 'Team calendar',
    });
    expect(await outboxTypes(a.orgId)).toContain('appointment_calendar.calendar_selected');
    expect(await api.auditCount(a.orgId, 'appointment_calendar', 'update')).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("a Google failure while listing is a 502 with a stable code, not Google's text", async () => {
    fake.failNext('GET', /calendarList$/, 500, { times: 2 });
    const res = await api.as(a.admin).get('/v2/appointments/calendar/google/calendars');
    expect(res.status).toBe(502);
    expect(code(res)).toBe('APPT_CALENDAR_PROVIDER_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('injected');
    fake.clearFailures();
  });

  it('puts the default back for the events below', async () => {
    const ok = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/google/calendar')
      .send({ calendarId: ANA });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ calendarId: ANA });
  });
});

// --- events ----------------------------------------------------------------------------------------------------------

describe('writing events (WD-APPT-029, D-08)', () => {
  it('writes a confirmed booking as an event with a Meet link, and stores the id and the link on the appointment', async () => {
    const type = await api.type(a.admin, { name: 'Consult', locationType: 'virtual' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[2]!.start,
      invitee: { name: 'Dana', phone: '+919811166601', email: 'dana@example.com' },
    });
    await consumer.handle(await lastEvent('appointment.booked', appt.id));

    const events = fake.eventsOf(ANA);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    const id = appt.id.replace(/-/g, '');
    expect(ev).toMatchObject({
      id,
      status: 'confirmed',
      summary: 'Consult',
      attendees: [{ email: 'dana@example.com', displayName: 'Dana' }],
      extendedProperties: { private: { crmManaged: '1', crmAppointment: appt.id } },
    });
    expect(ev.start.dateTime).toBe(new Date(slots[2]!.start).toISOString());
    expect(ev.hangoutLink).toBe(`https://meet.fake/${appt.id}`);
    const insert = fake.requests
      .filter((r) => r.method === 'POST' && r.path.endsWith('/events'))
      .at(-1)!;
    expect(insert.query.get('conferenceDataVersion')).toBe('1');
    expect(insert.query.get('sendUpdates')).toBe('all');
    expect(insert.auth).toMatch(/^at-/);

    const row = await api.rowOf(appt.id);
    expect(row).toMatchObject({
      calendar_event_id: id,
      calendar_id: ANA,
      meet_url: `https://meet.fake/${appt.id}`,
    });
    expect((await api.appt(a.admin, appt.id)).calendar).toEqual({ eventId: id, calendarId: ANA });
    // The access token cached at connect time was good: the adapter never had to refresh.
    expect(fake.forms('refresh_token')).toHaveLength(0);
  });

  it('a redelivered event updates the same Google event: never a second one', async () => {
    const type = await api.type(a.admin, { name: 'Twice' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[3]!.start,
      invitee: { name: 'Eli', phone: '+919811166602' },
    });
    const ev = await lastEvent('appointment.booked', appt.id);
    const before = fake.eventsOf(ANA).length;
    await consumer.handle(ev);
    await consumer.handle(ev);
    await consumer.handle(ev);
    expect(fake.eventsOf(ANA)).toHaveLength(before + 1);
    expect(
      fake.eventsOf(ANA).filter((e) => e.extendedProperties?.private?.crmAppointment === appt.id),
    ).toHaveLength(1);
    // No attendee e-mail: no invitation to send.
    const insert = fake.requests
      .filter((r) => r.method === 'POST' && r.path.endsWith('/events'))
      .at(-1)!;
    expect(insert.query.get('sendUpdates')).toBeNull();
  });

  it('a retry after a lost answer finds the event it already made (the 409 is the proof) and stores its id', async () => {
    const type = await api.type(a.admin, { name: 'Lost answer' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'Fay', phone: '+919811166603' },
    });
    const ev = await lastEvent('appointment.booked', appt.id);
    // Google wrote the event, then the answer was lost: the consumer throws and the appointment never learns the id.
    fake.failNext('POST', /\/events$/, 500, { afterEffect: true });
    await expect(consumer.handle(ev)).rejects.toMatchObject({ kind: 'server' });
    expect(
      fake.eventsOf(ANA).filter((e) => e.extendedProperties?.private?.crmAppointment === appt.id),
    ).toHaveLength(1);
    expect((await api.rowOf(appt.id)).calendar_event_id).toBeNull();

    await consumer.handle(ev);
    const mine = fake
      .eventsOf(ANA)
      .filter((e) => e.extendedProperties?.private?.crmAppointment === appt.id);
    expect(mine).toHaveLength(1);
    expect((await api.rowOf(appt.id)).calendar_event_id).toBe(appt.id.replace(/-/g, ''));
  });

  it('moving a booking patches the same event; an event deleted on the Google side is written again under its id; cancelling deletes it, and a repeat is not an error', async () => {
    const type = await api.type(a.admin, { name: 'Moves' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[5]!.start,
      invitee: { name: 'Gus', phone: '+919811166604', email: 'gus@example.com' },
    });
    const id = appt.id.replace(/-/g, '');
    await consumer.handle(await lastEvent('appointment.booked', appt.id));

    const moved = await api.post(a.admin, `/v2/appointments/${appt.id}/reschedule`, {
      startsAt: slots[9]!.start,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    await consumer.handle(await lastEvent('appointment.rescheduled', appt.id));
    const patched = fake.eventsOf(ANA).find((e) => e.id === id)!;
    expect(patched.start.dateTime).toBe(new Date(slots[9]!.start).toISOString());
    expect(
      fake.requests.filter((r) => r.method === 'PATCH' && r.path.endsWith(`/events/${id}`)),
    ).toHaveLength(1);
    expect(fake.eventsOf(ANA).filter((e) => e.id === id)).toHaveLength(1);

    // Somebody removed it in Google: the next change brings it back with the same id (a 404 on the patch, a fresh insert).
    fake.events.get(ANA)!.delete(id);
    await api.post(a.admin, `/v2/appointments/${appt.id}/reschedule`, {
      startsAt: slots[10]!.start,
    });
    await consumer.handle(await lastEvent('appointment.rescheduled', appt.id));
    expect(fake.eventsOf(ANA).find((e) => e.id === id)).toMatchObject({ status: 'confirmed' });

    await api.post(a.admin, `/v2/appointments/${appt.id}/cancel`, {});
    const cancelled = await lastEvent('appointment.cancelled', appt.id);
    await consumer.handle(cancelled);
    expect(fake.eventsOf(ANA).find((e) => e.id === id)!.status).toBe('cancelled');
    await consumer.handle(cancelled); // a 410 is "already deleted"
    expect(fake.count('DELETE', new RegExp(`/events/${id}$`))).toBe(2);
  });

  it('an access token Google refuses (401) is refreshed once and the call is repeated', async () => {
    const type = await api.type(a.admin, { name: 'Token' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[6]!.start,
      invitee: { name: 'Hal', phone: '+919811166605' },
    });
    fake.killAccessTokens();
    const refreshes = fake.forms('refresh_token').length;
    await consumer.handle(await lastEvent('appointment.booked', appt.id));
    expect(fake.forms('refresh_token')).toHaveLength(refreshes + 1);
    expect(
      fake.eventsOf(ANA).some((e) => e.extendedProperties?.private?.crmAppointment === appt.id),
    ).toBe(true);
    // The new token is kept, so the next call does not refresh again.
    const type2 = await api.type(a.admin, { name: 'Token two' });
    await api.slots(a.admin, type2.id);
    expect(fake.forms('refresh_token')).toHaveLength(refreshes + 1);
  });

  it('a request Google rejects as bad is thrown, so the outbox retries it and then gives up visibly', async () => {
    const type = await api.type(a.admin, { name: 'Rejected' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[7]!.start,
      invitee: { name: 'Ida', phone: '+919811166606' },
    });
    fake.failNext('POST', /\/events$/, 400, {
      body: { error: { code: 400, errors: [{ reason: 'invalid' }] } },
    });
    await expect(
      consumer.handle(await lastEvent('appointment.booked', appt.id)),
    ).rejects.toMatchObject({
      kind: 'bad_request',
      retryable: false,
    });
  });
});

// --- busy time -------------------------------------------------------------------------------------------------------

describe("the calendar's busy time in the slots (WD-APPT-016..019)", () => {
  const starts = (slots: Array<{ start: string }>) => slots.map((s) => s.start);

  it('blocks the slots a busy interval covers, and only those', async () => {
    const type = await api.type(a.admin, { name: 'Busy' });
    const open = await api.slots(a.admin, type.id);
    const s = open[12]!;
    fake.busy.set(ANA, [{ start: s.start, end: s.end }]);
    const after = await api.slots(a.admin, type.id);
    expect(starts(after)).not.toContain(s.start);
    expect(starts(after)).toContain(open[11]!.start);
    expect(starts(after)).toContain(open[13]!.start);
    // The public booking page is served from the same busy time.
    expect(starts(await api.publicSlots(a.slug, type.slug))).not.toContain(s.start);
    // And so is a booking: the blocked time is not bookable.
    const taken = await api.post(a.admin, '/v2/appointments', {
      bookingTypeId: type.id,
      startsAt: s.start,
      invitee: { name: 'Too late', phone: '+919811166607' },
    });
    expect(taken.status).toBeGreaterThanOrEqual(409);
    fake.busy.clear();
  });

  it("events written for bookings count as busy for another service (the way WaDesk behaved), but not against a group service's own seats", async () => {
    const group = await api.type(a.admin, { name: 'Group', capacity: 3 });
    const solo = await api.type(a.admin, { name: 'Solo' });
    const slots = await api.slots(a.admin, group.id);
    const s = slots[20]!;
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: group.id,
      startsAt: s.start,
      invitee: { name: 'Jo', phone: '+919811166608' },
    });
    await consumer.handle(await lastEvent('appointment.booked', appt.id));
    expect(
      fake.eventsOf(ANA).some((e) => e.extendedProperties?.private?.crmAppointment === appt.id),
    ).toBe(true);

    const groupSlots = await api.slots(a.admin, group.id);
    expect(groupSlots.find((x) => x.start === s.start)).toMatchObject({ remaining: 2 });
    expect(starts(await api.slots(a.admin, solo.id))).not.toContain(s.start);
  });

  it('is cached briefly: a second look inside the window does not ask Google again', async () => {
    process.env.GOOGLE_BUSY_CACHE_SECONDS = '60';
    adapter.forget(a.orgId);
    try {
      const type = await api.type(a.admin, { name: 'Cached' });
      await api.slots(a.admin, type.id);
      const asked = fake.count('POST', /freeBusy$/);
      await api.slots(a.admin, type.id);
      await api.slots(a.admin, type.id);
      expect(fake.count('POST', /freeBusy$/)).toBe(asked);
    } finally {
      process.env.GOOGLE_BUSY_CACHE_SECONDS = '0';
      adapter.forget(a.orgId);
    }
  });

  it('a Google outage means no busy data, not a failed page or a refused booking; the next calls do not each wait on Google', async () => {
    process.env.GOOGLE_BUSY_BACKOFF_SECONDS = '60';
    adapter.forget(a.orgId);
    try {
      const type = await api.type(a.admin, { name: 'Outage' });
      fake.failNext('POST', /freeBusy$/, 503, { times: 50 });
      const slots = await api.slots(a.admin, type.id); // would throw if the outage leaked out
      expect(slots.length).toBeGreaterThan(0);
      const asked = fake.count('POST', /freeBusy$/);
      expect(asked).toBeGreaterThanOrEqual(1);
      await api.slots(a.admin, type.id);
      expect(fake.count('POST', /freeBusy$/)).toBe(asked);
      const booked = await api.post(a.admin, '/v2/appointments', {
        bookingTypeId: type.id,
        startsAt: slots[0]!.start,
        invitee: { name: 'Outage', phone: '+919811166609' },
      });
      expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    } finally {
      fake.clearFailures();
      process.env.GOOGLE_BUSY_BACKOFF_SECONDS = '0';
      adapter.forget(a.orgId);
    }
  });

  it('a calendar Google cannot find is not read as free time, and does not break the page', async () => {
    const type = await api.type(a.admin, {
      name: 'Gone',
      calendar: { calendarId: 'gone@example.com' },
    });
    const slots = await api.slots(a.admin, type.id);
    expect(slots.length).toBeGreaterThan(0);
  });
});

// --- a grant Google refuses --------------------------------------------------------------------------------------------

describe('when Google stops honouring the grant (invalid_grant)', () => {
  beforeAll(async () => {
    // A calendar other than the default is chosen, to see a reconnect keep it.
    const ok = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/google/calendar')
      .send({ calendarId: 'team@example.com' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("a wrong platform client is the platform's problem: the workspace stays connected", async () => {
    fake.clientSecret = 'rotated-at-google';
    fake.killAccessTokens();
    const type = await api.type(a.admin, { name: 'Client' });
    expect((await api.as(a.admin).get(`/v2/booking-types/${type.id}/slots`)).status).toBe(200);
    expect((await status(a)).status).toBe('connected');
    fake.clientSecret = 'console-secret';
    adapter.forget(a.orgId);
  });

  it('marks the connection needs-reconnect once, shows it on the card, and then stops calling Google', async () => {
    for (const v of fake.refreshTokens.values()) v.valid = false;
    fake.killAccessTokens();
    const type = await api.type(a.admin, { name: 'Revoked' });
    const slots = await api.slots(a.admin, type.id); // the page still works
    expect(slots.length).toBeGreaterThan(0);

    expect(await status(a)).toMatchObject({
      provider: 'google',
      connected: false,
      status: 'needs_reconnect',
      account: ANA,
    });
    const [row] = await rows(a.orgId);
    expect(row).toMatchObject({
      status: 'needs_reconnect',
      status_reason: 'invalid_grant',
      access_token_enc: null,
    });
    expect(
      (await outboxTypes(a.orgId)).filter((t) => t === 'appointment_calendar.needs_reconnect'),
    ).toHaveLength(1);

    const calls = fake.requests.length;
    await api.slots(a.admin, type.id);
    await api.slots(a.admin, type.id);
    expect(fake.requests.length).toBe(calls);

    // A booking is written nowhere (and nothing throws): the event is not retried against a dead grant.
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'Kit', phone: '+919811166610' },
    });
    await consumer.handle(await lastEvent('appointment.booked', appt.id));
    expect(fake.requests.length).toBe(calls);
    expect((await api.rowOf(appt.id)).calendar_event_id).toBeNull();
    expect((await api.as(a.admin).get('/v2/appointments/calendar/google/calendars')).status).toBe(
      409,
    );
  });

  it('connecting again (the same account) restores it and keeps the chosen calendar', async () => {
    const where = await connect(a, 'code-a2');
    expect(where).toBe(`${SETTINGS_PAGE}?calendar=connected`);
    expect(await status(a)).toMatchObject({
      connected: true,
      status: 'connected',
      account: ANA,
      calendarId: 'team@example.com',
      calendarName: 'Team calendar',
    });
    expect(await rows(a.orgId)).toHaveLength(1);
    expect((await rows(a.orgId))[0]).toMatchObject({ status: 'active', status_reason: null });
  });

  it('connecting a different Google account starts again on its own primary calendar', async () => {
    expect(await connect(a, 'code-other', { email: 'omar@example.com' })).toBe(
      `${SETTINGS_PAGE}?calendar=connected`,
    );
    expect(await status(a)).toMatchObject({
      account: 'omar@example.com',
      calendarId: 'primary',
      calendarName: null,
    });
    // And back, for the rest.
    expect(await connect(a, 'code-a3')).toBe(`${SETTINGS_PAGE}?calendar=connected`);
  });
});

// --- disconnecting ---------------------------------------------------------------------------------------------------

describe('disconnecting (WD-APPT-028)', () => {
  it('revokes at Google, deletes the stored tokens, and leaves the events already written', async () => {
    const [row] = await rows(a.orgId);
    expect(row).toBeTruthy();
    const eventsBefore = fake.eventsOf(ANA).length;
    const res = await api.post(a.admin, '/v2/appointments/calendar/google/disconnect', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      connected: false,
      status: 'disconnected',
      account: null,
      calendarId: null,
    });
    expect(fake.revoked.at(-1)).toMatch(/^rt-code-a3-/);
    expect(await rows(a.orgId)).toHaveLength(0);
    expect(fake.eventsOf(ANA)).toHaveLength(eventsBefore);
    expect(await outboxTypes(a.orgId)).toContain('appointment_calendar.disconnected');
    expect(await api.auditCount(a.orgId, 'appointment_calendar', 'delete')).toBe(1);
  });

  it('is idempotent, and after it nothing is written or read', async () => {
    const calls = fake.requests.length;
    const again = await api.post(a.admin, '/v2/appointments/calendar/google/disconnect', {});
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('disconnected');
    const type = await api.type(a.admin, { name: 'After' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'Lee', phone: '+919811166611' },
    });
    await consumer.handle(await lastEvent('appointment.booked', appt.id));
    expect(fake.requests.length).toBe(calls);
  });

  it('carries on when Google cannot confirm the revoke (an outage must not trap the admin)', async () => {
    await connect(a, 'code-a4');
    fake.revokeStatus = 500;
    const res = await api.post(a.admin, '/v2/appointments/calendar/google/disconnect', {});
    expect(res.status).toBe(200);
    expect(await rows(a.orgId)).toHaveLength(0);
    fake.revokeStatus = 200;
  });
});
