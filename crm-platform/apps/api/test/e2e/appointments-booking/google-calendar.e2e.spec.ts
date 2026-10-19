import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { APPOINTMENT_CALENDAR } from '../../../src/infra/providers/appointments-booking';
import type { OutboxEvent } from '../../../src/kernel/outbox/outbox-subscribers';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import {
  CalendarReconcileProcessor,
  CalendarReconcileScheduler,
} from '../../../src/modules/appointments-booking/calendar-reconcile.jobs';
import { CalendarReconcileService } from '../../../src/modules/appointments-booking/calendar-reconcile.service';
import { AppointmentCalendarConsumer } from '../../../src/modules/appointments-booking/appointment-calendar.consumer';
import { GoogleCalendarTokens } from '../../../src/modules/appointments-booking/google-calendar-tokens.service';
import { GoogleCalendarAdapter } from '../../../src/modules/appointments-booking/google-calendar.adapter';
import { MultiCalendarAdapter } from '../../../src/modules/appointments-booking/multi-calendar.adapter';
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
 * Google Calendar for a workspace (TW-APPT-028, 029, D-08), end to end through HTTP: the operator's Google client in the console, the
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
    'GOOGLE_RETRIES',
    'GOOGLE_RETRY_BASE_MS',
  ]) {
    saved[k] = process.env[k];
  }
  // No retry inside one call here: these tests are about what the outbox does when a call fails. The retries inside a call have their
  // own describe below, which turns them on.
  Object.assign(process.env, fake.env(), {
    GOOGLE_BUSY_CACHE_SECONDS: '0',
    GOOGLE_BUSY_BACKOFF_SECONDS: '0',
    GOOGLE_RETRIES: '0',
    GOOGLE_RETRY_BASE_MS: '1',
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
  // The booking code talks to the multi-provider front, which serves a workspace that only has Google exactly as the Google adapter alone did.
  expect(h.app.get(APPOINTMENT_CALENDAR)).toBe(h.app.get(MultiCalendarAdapter));
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
  return finishConsent(t, res.headers.location as string);
}

/**
 * Google's redirect points at the app's confirmation page when there is something to confirm: the same admin confirms there, and the page
 * returns to `returnTo?calendar=<outcome>`. Any other address is already final (denied, failed, expired ...).
 */
async function finishConsent(t: Tenant, location: string): Promise<string> {
  const m = /\/google-account\/confirm\?request=([0-9a-f-]{36})$/.exec(location);
  if (!m) return location;
  const seen = await api.as(t.admin).get(`/v2/google-account/consent/${m[1]}`);
  expect(seen.status, JSON.stringify(seen.body)).toBe(200);
  const done = await api.post(t.admin, `/v2/google-account/consent/${m[1]}/confirm`, {});
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return `http://localhost:3001${done.body.returnTo}?calendar=${done.body.outcome}`;
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

describe("the operator's Google client (TW-APPT-028)", () => {
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

describe('connecting a workspace (TW-APPT-028)', () => {
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

describe('writing events (TW-APPT-029, D-08)', () => {
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
    expect((await api.appt(a.admin, appt.id)).calendar).toMatchObject({
      eventId: id,
      calendarId: ANA,
    });
    // The access token cached at connect time was good: the adapter never had to refresh.
    expect(fake.forms('refresh_token')).toHaveLength(0);

    // The Meet link the calendar made is the join link of the booking's row in the contact's Meetings (BL-281), written in the same
    // transaction as the link on the appointment.
    const contactMeetings = await api.as(a.admin).get(`/v2/contacts/${appt.contact!.id}/meetings`);
    expect(contactMeetings.status, JSON.stringify(contactMeetings.body)).toBe(200);
    expect(contactMeetings.body.data).toHaveLength(1);
    expect(contactMeetings.body.data[0]).toMatchObject({
      source: 'booking',
      appointmentId: appt.id,
      joinUrl: `https://meet.fake/${appt.id}`,
    });
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

describe('retries inside one call (quota, outage, lost answers)', () => {
  const book = async (name: string, slot: number, phone: string) => {
    const type = await api.type(a.admin, { name });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[slot]!.start,
      invitee: { name, phone },
    });
    return { appt, ev: await lastEvent('appointment.booked', appt.id) };
  };
  const mine = (id: string) =>
    fake.eventsOf(ANA).filter((e) => e.extendedProperties?.private?.crmAppointment === id);

  it('a 503 and a 429 on the event write are repeated, so one delivery is enough', async () => {
    process.env.GOOGLE_RETRIES = '2';
    try {
      const { appt, ev } = await book('Quota day', 6, '+919811166610');
      fake.failNext('POST', /\/events$/, 503, { times: 1 });
      fake.failNext('POST', /\/events$/, 429, {
        times: 1,
        body: { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } },
      });
      const before = fake.count('POST', /\/events$/);
      await consumer.handle(ev);
      expect(fake.count('POST', /\/events$/)).toBe(before + 3);
      expect(mine(appt.id)).toHaveLength(1);
      expect((await api.rowOf(appt.id)).calendar_event_id).toBe(appt.id.replace(/-/g, ''));
    } finally {
      process.env.GOOGLE_RETRIES = '0';
      fake.clearFailures();
    }
  });

  it('a lost answer is recovered inside the same call: the repeat meets 409 and becomes an update of the event that exists', async () => {
    process.env.GOOGLE_RETRIES = '2';
    try {
      const { appt, ev } = await book('Lost twice', 7, '+919811166611');
      fake.failNext('POST', /\/events$/, 500, { afterEffect: true });
      await consumer.handle(ev);
      expect(mine(appt.id)).toHaveLength(1);
      expect(
        fake.count('PATCH', new RegExp(`/events/${appt.id.replace(/-/g, '')}$`)),
      ).toBeGreaterThan(0);
      expect((await api.rowOf(appt.id)).calendar_event_id).toBe(appt.id.replace(/-/g, ''));
    } finally {
      process.env.GOOGLE_RETRIES = '0';
      fake.clearFailures();
    }
  });

  it('a quota answer that says to wait a long time is not slept on: the call fails at once for the outbox to retry later', async () => {
    process.env.GOOGLE_RETRIES = '2';
    process.env.GOOGLE_RETRY_AFTER_CAP_SECONDS = '1';
    try {
      const { appt, ev } = await book('Long wait', 8, '+919811166612');
      fake.failNext('POST', /\/events$/, 429, {
        times: 5,
        body: { error: { code: 429, errors: [{ reason: 'userRateLimitExceeded' }] } },
        headers: { 'retry-after': '120' },
      });
      const before = fake.count('POST', /\/events$/);
      const started = Date.now();
      await expect(consumer.handle(ev)).rejects.toMatchObject({
        kind: 'rate_limit',
        retryAfterSeconds: 120,
      });
      expect(Date.now() - started).toBeLessThan(3000);
      expect(fake.count('POST', /\/events$/)).toBe(before + 1);
      expect(mine(appt.id)).toHaveLength(0);
      // The account page remembers it, and the next success clears it.
      const row = await h.owner.query(
        `SELECT last_error_code FROM appointment_calendar_connections WHERE org_id = $1`,
        [a.orgId],
      );
      await new Promise((r) => setTimeout(r, 300));
      const after = await h.owner.query(
        `SELECT last_error_code FROM appointment_calendar_connections WHERE org_id = $1`,
        [a.orgId],
      );
      expect(after.rows[0].last_error_code ?? row.rows[0].last_error_code).toBe(
        'GOOGLE_RATE_LIMITED',
      );
      fake.clearFailures();
      await consumer.handle(ev);
      expect(mine(appt.id)).toHaveLength(1);
    } finally {
      process.env.GOOGLE_RETRIES = '0';
      delete process.env.GOOGLE_RETRY_AFTER_CAP_SECONDS;
      fake.clearFailures();
    }
  });

  it('a busy-time lookup is never repeated inside the call: a visitor is waiting on the booking page', async () => {
    process.env.GOOGLE_RETRIES = '2';
    try {
      fake.failNext('POST', /freeBusy$/, 503, { times: 1 });
      const before = fake.count('POST', /freeBusy$/);
      await expect(
        adapter.freeBusy(
          a.orgId,
          null,
          new Date(Date.now() + 86_400_000),
          new Date(Date.now() + 2 * 86_400_000),
        ),
      ).rejects.toMatchObject({ kind: 'server' });
      expect(fake.count('POST', /freeBusy$/)).toBe(before + 1);
    } finally {
      process.env.GOOGLE_RETRIES = '0';
      fake.clearFailures();
    }
  });
});

describe("the calendar's busy time in the slots (TW-APPT-016..019)", () => {
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

  it("events written for bookings count as busy for another service (the way Reference behaved), but not against a group service's own seats", async () => {
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

// --- the bounded reconcile and its two actions (TW-GACC-011) -------------------------------------------------------------

describe('Google event drift: looked for, shown, never auto-applied', () => {
  const CY = 'cy@example.com';
  let c: Tenant;
  let reconcile: CalendarReconcileService;
  let slotsOf: Array<{ start: string; end: string }>;
  let typeId = '';
  let next = 2;
  let phone = 811100000;

  const eventOf = (uuid: string) =>
    fake.eventsOf(CY).find((e) => e.extendedProperties?.private?.crmAppointment === uuid)!;
  const syncOf = async (uuid: string) => (await api.appt(c.admin, uuid)).calendar;
  const driftEvents = async (uuid: string) =>
    (
      await h.owner.query(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'appointment.calendar_drifted'`,
        [c.orgId],
      )
    ).rows.filter((r) => r.payload.uuid === uuid);
  const evs = async (type: string, uuid: string) =>
    (await bookingEvents(c.orgId, type, uuid)).at(-1)!;

  /** A confirmed booking whose Google event has been written, on its own slot. */
  async function booked(email?: string) {
    const appt = await api.staffBook(c.admin, {
      bookingTypeId: typeId,
      startsAt: slotsOf[next++]!.start,
      invitee: { name: 'Drift', phone: `+91${++phone}`, ...(email ? { email } : {}) },
    });
    await consumer.handle(await evs('appointment.booked', appt.id));
    expect(eventOf(appt.id)).toBeDefined();
    return appt;
  }
  /** One pass. Appointments looked at within the last hour are not read again, so the test ages the last look first (as an hour would). */
  const report = async () => {
    await h.owner.query(
      `UPDATE appointments SET google_checked_at = google_checked_at - interval '2 hours' WHERE org_id = $1`,
      [c.orgId],
    );
    return reconcile.reconcileOrg(c.orgId);
  };

  beforeAll(async () => {
    c = await api.signup('gcd');
    expect(await connect(c, 'code-drift', { email: CY })).toBe(
      `${SETTINGS_PAGE}?calendar=connected`,
    );
    reconcile = h.app.get(CalendarReconcileService);
    typeId = (await api.type(c.admin, { name: 'Drift' })).id;
    slotsOf = await api.slots(c.admin, typeId);
  });

  it('records what we wrote when the event is written, so the first look finds nothing wrong', async () => {
    const appt = await booked('dee@example.com');
    const row = await api.rowOf(appt.id);
    expect(row).toMatchObject({
      google_pushed_attendee: 'dee@example.com',
      google_sync_state: 'in_sync',
    });
    expect(row.google_event_etag).toBeTruthy();
    expect(new Date(row.google_pushed_starts_at as string).toISOString()).toBe(
      new Date(slotsOf[next - 1]!.start).toISOString(),
    );
    const r = await report();
    expect(r).toMatchObject({ outcome: 'ok', drifted: 0, newlyDrifted: 0 });
    expect(r.looked).toBeGreaterThanOrEqual(1);
    expect(await syncOf(appt.id)).toMatchObject({ sync: { state: 'in_sync', reason: null } });
    expect(await driftEvents(appt.id)).toHaveLength(0);
  });

  it('our own changes are not drift: a move whose push has not landed is pending, and the push is an echo', async () => {
    const appt = await booked();
    const moved = await api.post(c.admin, `/v2/appointments/${appt.id}/reschedule`, {
      startsAt: slotsOf[next++]!.start,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    // The outbox has not delivered the move yet: Google still shows the old time, and that is OUR change on its way.
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync' });
    expect(await driftEvents(appt.id)).toHaveLength(0);
    // The push lands: Google's etag changes by our own hand, which is not drift either.
    await consumer.handle(await evs('appointment.rescheduled', appt.id));
    const again = await report();
    expect(again.drifted).toBe(0);
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync', reason: null });
    expect(await driftEvents(appt.id)).toHaveLength(0);
  });

  it('a guest answering or Google filling in the Meet link is churn, not drift', async () => {
    const appt = await booked('guest@example.com');
    fake.editEvent(CY, appt.id.replace(/-/g, ''), {
      attendees: [{ email: 'guest@example.com', responseStatus: 'accepted' } as never],
      hangoutLink: 'https://meet.google.com/xyz',
    });
    expect((await report()).drifted).toBe(0);
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync' });
  });

  it('an event moved in Google is flagged with its time, the appointment is untouched, and the owner is told once', async () => {
    const appt = await booked();
    const before = await api.rowOf(appt.id);
    // Far from every bookable slot: an event in Google counts as busy time for the slots around it.
    const away = new Date(Date.parse(slotsOf[next++]!.start) + 45 * 86_400_000);
    fake.editEvent(CY, appt.id.replace(/-/g, ''), {
      start: { dateTime: away.toISOString() },
      end: { dateTime: new Date(away.getTime() + 1_800_000).toISOString() },
    });
    const r = await report();
    expect(r.newlyDrifted).toBeGreaterThanOrEqual(1);
    const cal = (await syncOf(appt.id))!;
    expect(cal.sync).toMatchObject({
      state: 'drifted',
      reason: 'time_changed',
      googleStartsAt: away.toISOString(),
    });
    // Never auto-changed.
    const after = await api.rowOf(appt.id);
    expect(after.starts_at).toEqual(before.starts_at);
    expect(after.status).toBe('confirmed');
    // One event for the owner, and a second look says nothing more.
    expect(await driftEvents(appt.id)).toHaveLength(1);
    expect((await driftEvents(appt.id))[0]!.payload).toMatchObject({
      reason: 'time_changed',
      ownerUserId: expect.any(Number),
    });
    await report();
    await report();
    expect(await driftEvents(appt.id)).toHaveLength(1);
    expect(await api.auditCount(c.orgId, 'appointments', 'update')).toBeGreaterThan(0);
  });

  it('flags changed guests, a deleted event and a vanished event, each with its own reason', async () => {
    const guests = await booked('one@example.com');
    fake.editEvent(CY, guests.id.replace(/-/g, ''), {
      attendees: [{ email: 'one@example.com' }, { email: 'two@example.com' }],
    });
    const deleted = await booked();
    fake.deleteEventInGoogle(CY, deleted.id.replace(/-/g, ''));
    const gone = await booked();
    fake.removeEvent(CY, gone.id.replace(/-/g, ''));

    await report();
    expect((await syncOf(guests.id))!.sync).toMatchObject({
      state: 'drifted',
      reason: 'attendees_changed',
    });
    expect((await syncOf(deleted.id))!.sync).toMatchObject({
      state: 'drifted',
      reason: 'event_deleted',
    });
    expect((await syncOf(gone.id))!.sync).toMatchObject({
      state: 'drifted',
      reason: 'event_missing',
    });
    for (const id of [guests.id, deleted.id, gone.id]) {
      expect((await api.rowOf(id)).status).toBe('confirmed');
      expect(await driftEvents(id)).toHaveLength(1);
    }
  });

  it('puts the badge away when somebody puts the event back by hand', async () => {
    const appt = await booked();
    const id = appt.id.replace(/-/g, '');
    const original = { ...eventOf(appt.id) };
    fake.editEvent(CY, id, {
      start: { dateTime: new Date(Date.parse(original.start.dateTime) + 3_600_000).toISOString() },
    });
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'drifted' });
    fake.editEvent(CY, id, { start: original.start });
    const r = await report();
    expect(r.cleared).toBeGreaterThanOrEqual(1);
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync', reason: null });
  });

  it('looks only at confirmed appointments in the next 60 days', async () => {
    const appt = await booked();
    const far = await booked();
    await h.owner.query(
      `UPDATE appointments SET starts_at = now() + interval '90 days', ends_at = now() + interval '90 days 30 minutes' WHERE uuid = $1`,
      [far.id],
    );
    fake.deleteEventInGoogle(CY, far.id.replace(/-/g, ''));
    const cancelled = await booked();
    await api.post(c.admin, `/v2/appointments/${cancelled.id}/cancel`, {});
    fake.deleteEventInGoogle(CY, appt.id.replace(/-/g, ''));
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'drifted' });
    expect((await syncOf(far.id))!.sync?.state ?? null).not.toBe('drifted');
    expect((await syncOf(cancelled.id))!.sync?.state ?? null).not.toBe('drifted');
  });

  it('a 5xx or a quota answer stops the pass, claims nothing about any appointment and backs the workspace off', async () => {
    const appt = await booked();
    fake.deleteEventInGoogle(CY, appt.id.replace(/-/g, ''));
    fake.failNext('GET', /\/events\//, 503, { times: 50 });
    let r;
    try {
      r = await report();
    } finally {
      fake.clearFailures();
    }
    expect(r.outcome).toBe('failed');
    expect((await syncOf(appt.id))!.sync?.state ?? null).not.toBe('drifted');
    const conn = (await rows(c.orgId))[0]!;
    expect(Number(conn.reconcile_failures)).toBe(1);
    expect(new Date(conn.next_reconcile_at as string).getTime()).toBeGreaterThan(
      Date.now() + 4 * 60_000,
    );
    // Google is back: the next pass sees it and the back-off is reset.
    expect((await report()).outcome).toBe('ok');
    expect((await syncOf(appt.id))!.sync).toMatchObject({
      state: 'drifted',
      reason: 'event_deleted',
    });
    expect(Number((await rows(c.orgId))[0]!.reconcile_failures)).toBe(0);
  });

  it('a 404 is "missing" and a cancelled event ("410" on delete) is "deleted": both are answers, neither is an outage', async () => {
    const appt = await booked();
    fake.removeEvent(CY, appt.id.replace(/-/g, ''));
    expect((await report()).outcome).toBe('ok');
    expect((await syncOf(appt.id))!.sync).toMatchObject({ reason: 'event_missing' });
    const other = await booked();
    fake.failNext('GET', /\/events\//, 410, { times: 50 });
    try {
      expect((await report()).outcome).toBe('ok');
    } finally {
      fake.clearFailures();
    }
    expect((await syncOf(other.id))!.sync).toMatchObject({
      state: 'drifted',
      reason: 'event_deleted',
    });
  });

  it('reads each appointment about once an hour, one event at a time, and never uses a watch channel', async () => {
    const first = await report();
    expect(first.looked).toBeGreaterThan(0);
    const reads = fake.count('GET', /\/events\//);
    // Looked at a moment ago: a second pass (a retry, a second worker) reads nothing.
    const again = await reconcile.reconcileOrg(c.orgId);
    expect(again).toMatchObject({ outcome: 'ok', looked: 0 });
    expect(fake.count('GET', /\/events\//)).toBe(reads);
    expect(fake.requests.some((r) => /\/watch$|syncToken/.test(r.path + r.query.toString()))).toBe(
      false,
    );
  });

  // --- the two actions --------------------------------------------------------------------------------------------------

  it('push and accept both say 409 GOOGLE_SYNC_NOT_DRIFTED when there is nothing to decide', async () => {
    const appt = await booked();
    await report();
    for (const action of ['push', 'accept']) {
      const res = await api.post(c.admin, `/v2/appointments/${appt.id}/calendar/${action}`, {});
      expect(res.status, action).toBe(409);
      expect(code(res)).toBe('GOOGLE_SYNC_NOT_DRIFTED');
    }
  });

  it('"Push our time back to Google" rewrites the event from the appointment and leaves the appointment alone', async () => {
    const appt = await booked('push@example.com');
    const id = appt.id.replace(/-/g, '');
    const startsAt = eventOf(appt.id).start.dateTime;
    fake.editEvent(CY, id, {
      start: { dateTime: new Date(Date.parse(startsAt) + 7_200_000).toISOString() },
    });
    await report();
    const before = await api.rowOf(appt.id);
    const res = await api.post(c.admin, `/v2/appointments/${appt.id}/calendar/push`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ done: 'pushed', applied: null });
    expect(new Date(eventOf(appt.id).start.dateTime).toISOString()).toBe(
      new Date(startsAt).toISOString(),
    );
    expect(res.body.appointment.calendar.sync).toMatchObject({ state: 'in_sync', reason: null });
    expect((await api.rowOf(appt.id)).starts_at).toEqual(before.starts_at);
    // And the reconcile now agrees: our push is not drift.
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync' });
  });

  it('push brings a deleted event back under the same id', async () => {
    const appt = await booked();
    fake.removeEvent(CY, appt.id.replace(/-/g, ''));
    await report();
    const res = await api.post(c.admin, `/v2/appointments/${appt.id}/calendar/push`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(eventOf(appt.id)).toMatchObject({ id: appt.id.replace(/-/g, ''), status: 'confirmed' });
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync' });
  });

  it('"Accept Google\'s change" for a moved event reschedules through the usual rules and tells the customer', async () => {
    const appt = await booked();
    const id = appt.id.replace(/-/g, '');
    const target = new Date(Date.parse(slotsOf[next++]!.start));
    fake.editEvent(CY, id, {
      start: { dateTime: target.toISOString() },
      end: { dateTime: new Date(target.getTime() + 1_800_000).toISOString() },
    });
    await report();
    const res = await api.post(c.admin, `/v2/appointments/${appt.id}/calendar/accept`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ done: 'accepted', applied: 'rescheduled' });
    expect(res.body.appointment.startsAt).toBe(target.toISOString());
    expect((await evs('appointment.rescheduled', appt.id)).payload).toMatchObject({
      uuid: appt.id,
    });
    expect(res.body.appointment.calendar.sync?.state ?? null).not.toBe('drifted');
    // The usual reschedule push settles the event; nothing is flagged afterwards.
    await consumer.handle(await evs('appointment.rescheduled', appt.id));
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync' });
  });

  it('accept for a deleted event cancels the appointment as a staff cancel would', async () => {
    const appt = await booked();
    fake.deleteEventInGoogle(CY, appt.id.replace(/-/g, ''));
    await report();
    const res = await api.post(c.admin, `/v2/appointments/${appt.id}/calendar/accept`, {
      notify: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ done: 'accepted', applied: 'cancelled' });
    expect((await api.rowOf(appt.id)).status).toBe('cancelled');
    expect((await evs('appointment.cancelled', appt.id)).payload).toMatchObject({ uuid: appt.id });
  });

  it('accept for changed guests only acknowledges: the appointment is the same and the badge goes', async () => {
    const appt = await booked('keep@example.com');
    fake.editEvent(CY, appt.id.replace(/-/g, ''), {
      attendees: [{ email: 'keep@example.com' }, { email: 'extra@example.com' }],
    });
    await report();
    const before = await api.rowOf(appt.id);
    const res = await api.post(c.admin, `/v2/appointments/${appt.id}/calendar/accept`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ done: 'accepted', applied: 'acknowledged' });
    expect((await api.rowOf(appt.id)).starts_at).toEqual(before.starts_at);
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync' });
  });

  it('both actions need the appointment-update permission and another workspace cannot reach them', async () => {
    const appt = await booked();
    fake.deleteEventInGoogle(CY, appt.id.replace(/-/g, ''));
    await report();
    const reader = await api.member(c, 'reader', [['record.appointments.read']]);
    for (const action of ['push', 'accept']) {
      expect(
        (await api.post(reader.token, `/v2/appointments/${appt.id}/calendar/${action}`, {})).status,
      ).toBe(403);
      expect(
        (await api.post(b.admin, `/v2/appointments/${appt.id}/calendar/${action}`, {})).status,
      ).toBe(404);
    }
    // A reader still sees the badge (it is part of the appointment).
    expect((await api.appt(reader.token, appt.id)).calendar!.sync).toMatchObject({
      state: 'drifted',
    });
    expect((await api.rowOf(appt.id)).status).toBe('confirmed');
  });

  // --- the job ---------------------------------------------------------------------------------------------------------

  it('the scheduler takes each due workspace once and the processor skips a workspace that another worker holds', async () => {
    const scheduler = h.app.get(CalendarReconcileScheduler);
    const processor = h.app.get(CalendarReconcileProcessor);
    await h.owner.query(
      `UPDATE appointment_calendar_connections SET next_reconcile_at = now() - interval '1 minute' WHERE org_id = $1`,
      [c.orgId],
    );
    expect(await scheduler.enqueueDue()).toBeGreaterThanOrEqual(1);
    expect(
      new Date((await rows(c.orgId))[0]!.next_reconcile_at as string).getTime(),
    ).toBeGreaterThan(Date.now());
    // Claimed: the next tick does not offer it again.
    const claimed = await rows(c.orgId);
    expect(claimed).toHaveLength(1);
    expect(await scheduler.enqueueDue()).toBe(0);

    const redis = h.app.get<Redis>(REDIS_CLIENT);
    const key = `calendar-reconcile:lock:${c.orgId}`;
    await redis.set(key, 'someone-else', 'PX', 60_000);
    expect(await processor.process({ data: { orgId: c.orgId } } as never)).toEqual({
      skipped: 'locked',
    });
    expect(await redis.get(key)).toBe('someone-else');
    await redis.del(key);
    const ran = await processor.process({ data: { orgId: c.orgId } } as never);
    expect(ran).toMatchObject({ outcome: 'ok' });
    expect(await redis.get(key)).toBeNull(); // released
  });

  // --- one unreadable event, row versions, accepting every kind of change ------------------------------------------------

  const eid = (uuid: string) => uuid.replace(/-/g, '');
  const forbidden = (id: string, status = 403, reason = 'forbidden') =>
    fake.failNext('GET', new RegExp(`/events/${id}$`), status, {
      body: { error: { code: status, message: 'no', errors: [{ reason }] } },
    });

  it('ONE event Google will not show is marked unreadable and the pass goes on: no drift, no notification', async () => {
    const bad = await booked();
    const badId = eid(bad.id);
    const ok = await booked();
    fake.deleteEventInGoogle(CY, eid(ok.id)); // a real drift AFTER the unreadable one in the same pass
    forbidden(badId);
    const r = await report();
    fake.clearFailures();
    expect(r.outcome).toBe('ok');
    expect(r.unreadable).toBe(1);
    expect(r.looked).toBeGreaterThan(1);
    expect((await syncOf(bad.id))!.sync).toMatchObject({
      state: 'unreadable',
      reason: 'event_forbidden',
    });
    expect(await driftEvents(bad.id)).toHaveLength(0);
    expect((await syncOf(ok.id))!.sync).toMatchObject({
      state: 'drifted',
      reason: 'event_deleted',
    });
    expect((await api.rowOf(bad.id)).google_checked_at).not.toBeNull();
    expect(Number((await rows(c.orgId))[0]!.reconcile_failures)).toBe(0);

    // A bad request for that one event is the same, with its own reason; and when Google shows it again the mark goes.
    forbidden(badId, 400, 'invalid');
    await report();
    fake.clearFailures();
    expect((await syncOf(bad.id))!.sync).toMatchObject({
      state: 'unreadable',
      reason: 'event_unreadable',
    });
    await report();
    expect((await syncOf(bad.id))!.sync).toMatchObject({ state: 'in_sync', reason: null });
    expect(await driftEvents(bad.id)).toHaveLength(0);
  });

  it('an outage (5xx), unlike one forbidden event, still stops the pass and backs off', async () => {
    const a1 = await booked();
    fake.failNext('GET', /\/events\//, 503, { times: 50 });
    const r = await report();
    fake.clearFailures();
    expect(r.outcome).toBe('failed');
    expect((await syncOf(a1.id))!.sync?.state ?? null).not.toBe('unreadable');
    await report();
  });

  it('a look never bumps row_version or updated_at, so a staff edit made meanwhile is not a 409; a real edit still bumps it', async () => {
    const appt = await booked('rv@example.com');
    const before = await api.rowOf(appt.id);
    await report(); // nothing new: one batched checked-at write
    const same = await api.rowOf(appt.id);
    expect(same.row_version).toBe(before.row_version);
    expect(new Date(same.updated_at as string).getTime()).toBe(
      new Date(before.updated_at as string).getTime(),
    );
    expect(new Date(same.google_checked_at as string).getTime()).toBeGreaterThan(
      new Date(before.google_checked_at as string).getTime() - 1,
    );
    fake.deleteEventInGoogle(CY, eid(appt.id));
    await report(); // a real transition: drifted
    const mid = await api.rowOf(appt.id);
    expect(mid.google_sync_state).toBe('drifted');
    expect(mid.row_version).toBe(before.row_version);
    // The person who opened the booking before the look can still save their notes with that version.
    const notes = await api
      .as(c.admin)
      .patch(`/v2/appointments/${appt.id}`)
      .send({ notes: 'called her', rowVersion: before.row_version });
    expect(notes.status, JSON.stringify(notes.body)).toBe(200);
    const edited = await api.rowOf(appt.id);
    expect(Number(edited.row_version)).toBeGreaterThan(Number(before.row_version));
  });

  async function acceptMove(
    patch: (start: Date, end: Date) => { start?: Date; end?: Date },
  ): Promise<{ start: Date; end: Date; row: Record<string, unknown> }> {
    const appt = await booked();
    const ev = eventOf(appt.id);
    const was = { start: new Date(ev.start.dateTime), end: new Date(ev.end.dateTime) };
    const changed = patch(was.start, was.end);
    const edit: Record<string, unknown> = {};
    if (changed.start) edit.start = { dateTime: changed.start.toISOString() };
    if (changed.end) edit.end = { dateTime: changed.end.toISOString() };
    fake.editEvent(CY, eid(appt.id), edit);
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({
      state: 'drifted',
      reason: 'time_changed',
    });
    const res = await api.post(c.admin, `/v2/appointments/${appt.id}/calendar/accept`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ done: 'accepted', applied: 'rescheduled' });
    const start = changed.start ?? was.start;
    const end = changed.end ?? was.end;
    const row = await api.rowOf(appt.id);
    expect(new Date(row.starts_at as string).toISOString()).toBe(start.toISOString());
    expect(new Date(row.ends_at as string).toISOString()).toBe(end.toISOString());
    expect(res.body.appointment.endsAt).toBe(end.toISOString());
    // What we know about the event is now what Google shows, the badge is gone, and the next look finds nothing wrong.
    expect(new Date(row.google_pushed_starts_at as string).toISOString()).toBe(start.toISOString());
    expect(new Date(row.google_pushed_ends_at as string).toISOString()).toBe(end.toISOString());
    expect(row.google_sync_state).toBe('in_sync');
    expect((await evs('appointment.rescheduled', appt.id)).payload).toMatchObject({
      uuid: appt.id,
    });
    const again = await report();
    expect(again.newlyDrifted).toBe(0);
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync' });
    // A moved event counts as busy time around it: leave room so the next booking is not blocked by it.
    next += 2;
    return { start, end, row };
  }

  it('accept when only the START moved: the booking takes Google start and keeps its end', async () => {
    await acceptMove((s) => ({ start: new Date(s.getTime() + 10 * 60_000) }));
  });

  it('accept when only the END moved: the booking takes the new end (this used to do nothing and hide the badge)', async () => {
    await acceptMove((_s, e) => ({ end: new Date(e.getTime() + 5 * 60_000) }));
  });

  it('accept when both moved: the booking takes both', async () => {
    await acceptMove((s, e) => ({
      start: new Date(s.getTime() + 10 * 60_000),
      end: new Date(e.getTime() + 15 * 60_000),
    }));
  });

  it('push when nothing could be written (no usable calendar) is an error, not a success, and writes no audit row', async () => {
    const appt = await booked();
    fake.deleteEventInGoogle(CY, eid(appt.id));
    await report();
    const audits = async () =>
      Number(
        (
          await h.owner.query(
            `SELECT count(*) AS n FROM audit_log WHERE org_id = $1 AND module = 'appointments'`,
            [c.orgId],
          )
        ).rows[0].n,
      );
    const before = await audits();
    await h.owner.query(
      `UPDATE appointment_calendar_connections SET status = 'needs_reconnect' WHERE org_id = $1`,
      [c.orgId],
    );
    h.app.get(GoogleCalendarTokens).invalidate(c.orgId);
    try {
      const res = await api.post(c.admin, `/v2/appointments/${appt.id}/calendar/push`, {});
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(code(res)).toBe('APPT_CALENDAR_NOT_CONNECTED');
      expect(await audits()).toBe(before);
      expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'drifted' });
    } finally {
      await h.owner.query(
        `UPDATE appointment_calendar_connections SET status = 'active' WHERE org_id = $1`,
        [c.orgId],
      );
      h.app.get(GoogleCalendarTokens).invalidate(c.orgId);
    }
  });

  it('a calendar that no longer exists is an error on the connection, not drift: no appointment is flagged and nobody is told', async () => {
    const appt = await booked();
    const drifts = async () =>
      Number(
        (
          await h.owner.query(
            `SELECT count(*) AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'appointment.calendar_drifted'`,
            [c.orgId],
          )
        ).rows[0].n,
      );
    const before = await drifts();
    fake.missingCalendars.add(CY);
    let r;
    try {
      r = await report();
    } finally {
      fake.missingCalendars.delete(CY);
    }
    expect(r.outcome).toBe('calendar_missing');
    expect(r.drifted).toBe(0);
    expect(await drifts()).toBe(before);
    expect((await syncOf(appt.id))!.sync?.state ?? null).not.toBe('drifted');
    expect(Number((await rows(c.orgId))[0]!.reconcile_failures)).toBeGreaterThan(0);
    // The problem is shown on the connection (health is written in the background).
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await rows(c.orgId))[0]).toMatchObject({
      last_error_code: 'GOOGLE_NOT_FOUND',
      last_error_capability: 'calendar',
    });
    // The calendar is back: the next pass looks again and finds the event as it was.
    expect((await report()).outcome).toBe('ok');
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync' });
    expect(Number((await rows(c.orgId))[0]!.reconcile_failures)).toBe(0);
  });

  it('an invitee who IS the calendar owner is not "guests changed" for ever (Google flags the owner as self)', async () => {
    const appt = await booked(CY);
    expect(eventOf(appt.id).attendees?.[0]).toMatchObject({ email: CY, self: true });
    for (let i = 0; i < 2; i += 1) {
      await report();
    }
    expect((await syncOf(appt.id))!.sync).toMatchObject({ state: 'in_sync', reason: null });
    expect(await driftEvents(appt.id)).toHaveLength(0);
    // A real guest change on top of it is still seen.
    fake.editEvent(CY, eid(appt.id), {
      attendees: [{ email: CY, self: true } as never, { email: 'extra@example.com' }],
    });
    await report();
    expect((await syncOf(appt.id))!.sync).toMatchObject({ reason: 'attendees_changed' });
  });

  it('a grant revoked in the middle of a pass ends it as needs-reconnect and flags nothing', async () => {
    const appt = await booked();
    fake.deleteEventInGoogle(CY, appt.id.replace(/-/g, ''));
    for (const v of fake.refreshTokens.values()) if (v.account.email === CY) v.valid = false;
    fake.killAccessTokens();
    adapter.forget(c.orgId);
    const r = await report();
    expect(r.outcome).toBe('needs_reconnect');
    expect(r.drifted).toBe(0);
    expect((await syncOf(appt.id))!.sync?.state ?? null).not.toBe('drifted');
    expect((await rows(c.orgId))[0]).toMatchObject({ status: 'needs_reconnect' });
    // Nothing more is asked of a dead grant.
    const calls = fake.requests.length;
    expect((await report()).outcome).toBe('not_connected');
    expect(fake.requests.length).toBe(calls);
  });

  it('reconnecting as a DIFFERENT Google account forgets the old events and every drift state; the reconcile never reads them as missing', async () => {
    const CY2 = 'cy2@example.com';
    // An upcoming booking with an event in the old account, flagged as drifted.
    const [upcoming] = (
      await h.owner.query(
        `SELECT uuid FROM appointments WHERE org_id = $1 AND calendar_event_id IS NOT NULL AND status = 'confirmed' AND ends_at > now() ORDER BY id LIMIT 1`,
        [c.orgId],
      )
    ).rows;
    await h.owner.query(
      `UPDATE appointments SET google_sync_state = 'drifted', google_sync_reason = 'time_changed', google_drift_detected_at = now() WHERE uuid = $1`,
      [upcoming.uuid],
    );
    expect(await connect(c, 'code-switch', { email: CY2 })).toBe(
      `${SETTINGS_PAGE}?calendar=connected`,
    );

    const left = (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM appointments WHERE org_id = $1 AND ends_at >= now()
            AND (calendar_event_id IS NOT NULL OR google_sync_state IS NOT NULL OR google_event_etag IS NOT NULL OR google_pushed_at IS NOT NULL)`,
        [c.orgId],
      )
    ).rows[0].n;
    expect(left).toBe(0);
    const calls = fake.count('GET', /\/events\//);
    const r = await report();
    expect(r).toMatchObject({ outcome: 'ok', looked: 0, drifted: 0 });
    expect(fake.count('GET', /\/events\//)).toBe(calls);

    // From now on the new account's calendar is the one that is written and looked at.
    const fresh = await api.staffBook(c.admin, {
      bookingTypeId: typeId,
      startsAt: slotsOf[next++]!.start,
      invitee: { name: 'After switch', phone: `+91${++phone}` },
    });
    await consumer.handle(await evs('appointment.booked', fresh.id));
    expect(
      fake.eventsOf(CY2).some((e) => e.extendedProperties?.private?.crmAppointment === fresh.id),
    ).toBe(true);
    expect((await report()).drifted).toBe(0);
    expect((await syncOf(fresh.id))!.sync).toMatchObject({ state: 'in_sync' });
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

describe('disconnecting (TW-APPT-028)', () => {
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
