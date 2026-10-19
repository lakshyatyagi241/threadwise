import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { APPOINTMENT_CALENDAR } from '../../../src/infra/providers/appointments-booking';
import type { OutboxEvent } from '../../../src/kernel/outbox/outbox-subscribers';
import { AppointmentCalendarConsumer } from '../../../src/modules/appointments-booking/appointment-calendar.consumer';
import { MicrosoftCalendarAdapter } from '../../../src/modules/appointments-booking/microsoft-calendar.adapter';
import { MultiCalendarAdapter } from '../../../src/modules/appointments-booking/multi-calendar.adapter';
import {
  deriveMicrosoftKey,
  newState,
  signState,
  signTicket,
} from '../../../src/modules/appointments-booking/microsoft-calendar-state';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import { FakeGoogle } from './fake-google';
import { FakeMicrosoft } from './fake-microsoft';
import { AppointmentsApi, startHarness, type Harness, type Tenant } from './support';

/**
 * Outlook / Microsoft 365 as a second calendar provider (BL-035), end to end through HTTP: the operator's Microsoft app in the console, the
 * consent round trip with its confirmation, choosing a calendar, writing / moving / deleting events through the real outbox consumer, busy
 * time in the slots, a grant Microsoft refuses, rotating refresh tokens, and a workspace that has Google AND Outlook connected.
 *
 * Microsoft (and Google) are local stand-ins written from the vendors' documentation. Nothing here talks to a real Microsoft 365 tenant or a
 * real Google account, so what is proved is the adapter against that description, not against the vendors.
 */
let h: Harness;
let api: AppointmentsApi;
let ms: FakeMicrosoft;
let google: FakeGoogle;
let consumer: AppointmentCalendarConsumer;
let adapter: MicrosoftCalendarAdapter;
let a: Tenant; // the workspace that connects
let b: Tenant; // a neighbour that must never see it
let operator = '';

const ANA = 'ana@contoso.example';
const ANA_G = 'ana@gmail.example';
const CALLBACK = '/v2/public/appointments/calendar/microsoft/callback';
const SETTINGS_PAGE = 'http://localhost:3001/appointments/settings';
const KEY = deriveMicrosoftKey(Buffer.alloc(32, 7).toString('base64'));
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'MICROSOFT_CALENDAR_CLIENT_ID',
  'MICROSOFT_CALENDAR_CLIENT_SECRET',
  'MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS',
  'MICROSOFT_CALENDAR_BUSY_BACKOFF_SECONDS',
  'MICROSOFT_CALENDAR_RETRIES',
  'MICROSOFT_CALENDAR_RETRY_BASE_MS',
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'GOOGLE_BUSY_CACHE_SECONDS',
  'GOOGLE_BUSY_BACKOFF_SECONDS',
  'GOOGLE_RETRIES',
  'GOOGLE_RETRY_BASE_MS',
];

beforeAll(async () => {
  ms = await FakeMicrosoft.start();
  google = await FakeGoogle.start();
  for (const k of [...ENV_KEYS, ...Object.keys(ms.env()), ...Object.keys(google.env())]) {
    saved[k] = process.env[k];
  }
  Object.assign(process.env, ms.env(), google.env(), {
    MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS: '0',
    MICROSOFT_CALENDAR_BUSY_BACKOFF_SECONDS: '0',
    MICROSOFT_CALENDAR_RETRIES: '0',
    MICROSOFT_CALENDAR_RETRY_BASE_MS: '1',
    GOOGLE_BUSY_CACHE_SECONDS: '0',
    GOOGLE_BUSY_BACKOFF_SECONDS: '0',
    GOOGLE_RETRIES: '0',
    GOOGLE_RETRY_BASE_MS: '1',
  });
  delete process.env.MICROSOFT_CALENDAR_CLIENT_ID;
  delete process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
  delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/appointments-booking/appointments-booking-worker.module'))
        .AppointmentsBookingWorkerModule,
    ],
  });
  api = new AppointmentsApi(h);
  adapter = h.app.get(MicrosoftCalendarAdapter);
  consumer = h.app.get(AppointmentCalendarConsumer);
  expect(h.app.get(APPOINTMENT_CALENDAR)).toBe(h.app.get(MultiCalendarAdapter));
  a = await api.signup('msa');
  b = await api.signup('msb');

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
  await ms?.stop();
  await google?.stop();
});

// --- helpers ---------------------------------------------------------------------------------------------------------

const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

const overview = async (t: Tenant) => {
  const res = await api.as(t.admin).get('/v2/appointments/calendar/overview');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    writeProvider: string | null;
    preferredProvider: string | null;
    providers: Array<{
      provider: string;
      status: string;
      account: string | null;
      calendarId: string | null;
      calendarName: string | null;
      active: boolean;
      lastErrorCode: string | null;
    }>;
  };
};
const card = async (t: Tenant, provider: 'google' | 'microsoft') =>
  (await overview(t)).providers.find((p) => p.provider === provider)!;

/** The admin presses Connect; Microsoft redirects back with a code. Returns where the callback sent the browser. */
async function callbackFor(
  t: Tenant,
  codeName: string,
  opts: { scope?: string; refresh?: boolean; email?: string } = {},
) {
  const start = await api.post(t.admin, '/v2/appointments/calendar/microsoft/start', {
    returnTo: '/appointments/settings',
  });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = new URL(start.body.url as string).searchParams.get('state')!;
  ms.grant(codeName, ms.account(opts.email ?? ANA), opts);
  const res = await request(h.app.getHttpServer())
    .get(CALLBACK)
    .query({ code: codeName, state })
    .redirects(0);
  expect(res.status).toBe(302);
  return res.headers.location as string;
}

const ticketOf = (location: string): string => {
  const url = new URL(location);
  expect(url.searchParams.get('outlook')).toBe('confirm');
  return url.searchParams.get('ticket')!;
};

/** Connect and confirm as the same admin. Returns the page the browser ends on. */
async function connect(
  t: Tenant,
  codeName: string,
  opts: { scope?: string; refresh?: boolean; email?: string } = {},
) {
  const where = await callbackFor(t, codeName, opts);
  if (!where.includes('outlook=confirm')) return where;
  const done = await api.post(t.admin, '/v2/appointments/calendar/microsoft/confirm', {
    ticket: ticketOf(where),
  });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return `http://localhost:3001${done.body.returnTo}?calendar=${done.body.outcome}`;
}

/** Google, for the tests that have both: the same round trip with its confirmation page. */
async function connectGoogle(t: Tenant, codeName: string): Promise<void> {
  const start = await api.post(t.admin, '/v2/appointments/calendar/google/start', {
    returnTo: '/appointments/settings',
  });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = new URL(start.body.url as string).searchParams.get('state')!;
  google.grant(codeName, google.account(ANA_G));
  const res = await request(h.app.getHttpServer())
    .get('/v2/public/appointments/calendar/google/callback')
    .query({ code: codeName, state })
    .redirects(0);
  const m = /\/google-account\/confirm\?request=([0-9a-f-]{36})$/.exec(
    res.headers.location as string,
  );
  expect(m, String(res.headers.location)).toBeTruthy();
  const done = await api.post(t.admin, `/v2/google-account/consent/${m![1]}/confirm`, {});
  expect(done.status, JSON.stringify(done.body)).toBe(200);
}

const rows = async (orgId: number) =>
  (
    await h.owner.query(`SELECT * FROM appointment_microsoft_connections WHERE org_id = $1`, [
      orgId,
    ])
  ).rows as Array<Record<string, unknown>>;

const outboxTypes = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT event_type, payload->>'provider' AS provider FROM event_outbox
        WHERE org_id = $1 AND event_type LIKE 'appointment_calendar.%' ORDER BY id`,
      [orgId],
    )
  ).rows.map((r) => `${r.event_type as string}:${(r.provider as string | null) ?? '-'}`);

async function bookingEvent(orgId: number, type: string, uuid: string): Promise<OutboxEvent> {
  const res = await h.owner.query(
    `SELECT id::text AS id, org_id, aggregate_module, aggregate_id::text AS aggregate_id, event_type, payload
       FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
    [orgId, type],
  );
  const hit = res.rows
    .map((r) => ({
      id: r.id as string,
      orgId: Number(r.org_id),
      aggregateModule: r.aggregate_module as string,
      aggregateId: r.aggregate_id as string,
      eventType: r.event_type as string,
      payload: r.payload as Record<string, unknown>,
    }))
    .filter((e) => e.payload.uuid === uuid)
    .at(-1);
  expect(hit, `${type} for ${uuid}`).toBeTruthy();
  return hit!;
}
const lastEvent = (type: string, uuid: string) => bookingEvent(a.orgId, type, uuid);

const operatorPatch = async (
  values: Record<string, unknown>,
  secrets: Record<string, string> = {},
) => {
  const get = await request(h.app.getHttpServer())
    .get('/v2/platform/settings/groups/microsoftCalendar')
    .set({ authorization: `Bearer ${operator}` });
  expect(get.status, JSON.stringify(get.body)).toBe(200);
  return request(h.app.getHttpServer())
    .patch('/v2/platform/settings/groups/microsoftCalendar')
    .set({ authorization: `Bearer ${operator}` })
    .send({ rowVersion: get.body.rowVersion, values, secrets });
};

/** A staff booking made at `slot` of a fresh type, and delivered to the calendar consumer as the outbox drain would. */
async function bookAndWrite(name: string, slot: number, extra: Record<string, unknown> = {}) {
  const type = await api.type(a.admin, { name, ...extra });
  const slots = await api.slots(a.admin, type.id);
  const appt = await api.staffBook(a.admin, {
    bookingTypeId: type.id,
    startsAt: slots[slot]!.start,
    invitee: {
      name: `Guest ${name}`,
      phone: `+9198111667${String(slot).padStart(2, '0')}`,
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`,
    },
  });
  await consumer.handle(await lastEvent('appointment.booked', appt.id));
  return { type, slots, appt };
}

// --- the platform's Microsoft app ------------------------------------------------------------------------------------

describe("the operator's Microsoft app", () => {
  it('without one, a workspace sees Outlook as unavailable and cannot start connecting', async () => {
    expect(await card(a, 'microsoft')).toMatchObject({
      status: 'unavailable',
      account: null,
      active: false,
    });
    const start = await api.post(a.admin, '/v2/appointments/calendar/microsoft/start', {});
    expect(start.status).toBe(422);
    expect(code(start)).toBe('APPT_CALENDAR_NOT_CONFIGURED');
    expect(ms.requests).toHaveLength(0);
  });

  it('the environment is the fallback: with a client id and secret there, the workspace can connect', async () => {
    process.env.MICROSOFT_CALENDAR_CLIENT_ID = 'env-client';
    process.env.MICROSOFT_CALENDAR_CLIENT_SECRET = 'env-secret';
    expect((await card(a, 'microsoft')).status).toBe('disconnected');
    const start = await api.post(a.admin, '/v2/appointments/calendar/microsoft/start', {});
    expect(new URL(start.body.url as string).searchParams.get('client_id')).toBe('env-client');
  });

  it('what the operator saves in the console wins; the secret is sealed and never read back', async () => {
    const res = await operatorPatch(
      { clientId: 'ms-client', tenant: 'contoso-tenant' },
      { clientSecret: 'ms-secret' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.values).toMatchObject({
      clientId: 'ms-client',
      tenant: 'contoso-tenant',
      enabled: true,
    });
    expect(res.body.secrets.clientSecret).toEqual({ isSet: true });
    expect(JSON.stringify(res.body)).not.toContain('ms-secret');
    expect(res.body.extra.redirectUri).toBe(`http://localhost:3999${CALLBACK}`);
    const stored = await h.owner.query(
      `SELECT value, is_secret FROM platform_settings WHERE key = 'set.microsoftCalendar.clientSecret'`,
    );
    expect(stored.rows[0].is_secret).toBe(true);
    expect(JSON.stringify(stored.rows[0].value)).not.toContain('ms-secret');
    delete process.env.MICROSOFT_CALENDAR_CLIENT_ID;
    delete process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  });

  it('switching it off makes Outlook unavailable again, without deleting the app', async () => {
    expect((await operatorPatch({ enabled: false })).status).toBe(200);
    expect((await card(a, 'microsoft')).status).toBe('unavailable');
    expect((await api.post(a.admin, '/v2/appointments/calendar/microsoft/start', {})).status).toBe(
      422,
    );
    expect((await operatorPatch({ enabled: true })).status).toBe(200);
    expect((await card(a, 'microsoft')).status).toBe('disconnected');
  });
});

// --- connecting ------------------------------------------------------------------------------------------------------

describe('connecting a workspace', () => {
  it('start returns the consent URL: calendar scopes, offline access, the tenant and a signed state', async () => {
    const start = await api.post(a.admin, '/v2/appointments/calendar/microsoft/start', {
      returnTo: '/appointments/settings',
    });
    expect(start.status).toBe(200);
    expect(start.body.expiresInSeconds).toBe(600);
    const url = new URL(start.body.url as string);
    expect(url.origin + url.pathname).toBe(`${ms.url}/contoso-tenant/oauth2/v2.0/authorize`);
    expect(url.searchParams.get('client_id')).toBe('ms-client');
    expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:3999${CALLBACK}`);
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toContain('Calendars.ReadWrite');
    expect(scopes).toContain('offline_access');
    expect(url.searchParams.get('state')!.length).toBeGreaterThan(40);
  });

  it('start refuses a return address outside the app, and a caller without the booking-settings capability', async () => {
    expect(
      (
        await api.post(a.admin, '/v2/appointments/calendar/microsoft/start', {
          returnTo: 'https://evil.example/x',
        })
      ).status,
    ).toBe(422);
    const agent = await api.member(a, 'agent', [
      ['record.appointments.read'],
      ['record.booking-types.read'],
    ]);
    for (const [method, path] of [
      ['post', '/v2/appointments/calendar/microsoft/start'],
      ['post', '/v2/appointments/calendar/microsoft/confirm'],
      ['get', '/v2/appointments/calendar/microsoft/calendars'],
      ['put', '/v2/appointments/calendar/microsoft/calendar'],
      ['post', '/v2/appointments/calendar/microsoft/disconnect'],
      ['put', '/v2/appointments/calendar/provider'],
    ] as const) {
      const res = await api
        .as(agent.token)
        [method](path)
        .send({ calendarId: 'x', ticket: 'x'.repeat(30), provider: null });
      expect(res.status, path).toBe(403);
    }
    // Seeing the providers is an appointments read.
    expect((await api.as(agent.token).get('/v2/appointments/calendar/overview')).status).toBe(200);
    expect(
      (await request(h.app.getHttpServer()).post('/v2/appointments/calendar/microsoft/start'))
        .status,
    ).toBe(401);
  });

  it('the public callback exchanges NOTHING: it hands the browser a ticket, and Microsoft was not asked for tokens', async () => {
    const where = await callbackFor(a, 'code-a');
    expect(where.startsWith(`${SETTINGS_PAGE}?outlook=confirm&ticket=`)).toBe(true);
    expect(ms.tokenCalls('authorization_code')).toHaveLength(0);
    expect(await rows(a.orgId)).toHaveLength(0);
    // The code travels sealed inside the ticket, never in the clear.
    expect(where).not.toContain('code-a');
  });

  it('confirming by the same admin exchanges the code, stores the grant sealed, and reports connected', async () => {
    const where = await connect(a, 'code-a2');
    expect(where).toBe(`${SETTINGS_PAGE}?calendar=connected`);
    expect(ms.tokenCalls('authorization_code').at(-1)!.body).toMatchObject({
      code: 'code-a2',
      client_id: 'ms-client',
      client_secret: 'ms-secret',
      redirect_uri: `http://localhost:3999${CALLBACK}`,
    });
    const [row] = await rows(a.orgId);
    expect(row).toMatchObject({ account_email: ANA, status: 'active', calendar_id: 'primary' });
    expect(Number(row!.connected_by)).toBe(a.adminUserId);
    expect(String(row!.refresh_token_enc)).toMatch(/^v1:/);
    expect(String(row!.access_token_enc)).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toMatch(/ms-rt-|ms-at-/);
    expect(await card(a, 'microsoft')).toMatchObject({
      status: 'connected',
      account: ANA,
      calendarId: 'primary',
      active: true,
    });
    expect((await overview(a)).writeProvider).toBe('microsoft');
    expect(await outboxTypes(a.orgId)).toEqual(['appointment_calendar.connected:microsoft']);
    expect(await api.auditCount(a.orgId, 'appointment_calendar_microsoft', 'insert')).toBe(1);
  });

  it('another workspace sees nothing of it', async () => {
    expect(await card(b, 'microsoft')).toMatchObject({ status: 'disconnected', account: null });
    expect(await rows(b.orgId)).toHaveLength(0);
    const list = await api.as(b.admin).get('/v2/appointments/calendar/microsoft/calendars');
    expect(list.status).toBe(409);
    expect(code(list)).toBe('APPT_CALENDAR_NOT_CONNECTED');
  });

  it('a forwarded link is refused before Microsoft is asked for anything: another person, another workspace', async () => {
    const where = await callbackFor(b, 'code-fwd');
    const ticket = ticketOf(where);
    const before = ms.tokenCalls('authorization_code').length;
    // Another person of the same workspace, with the capability: it is not theirs.
    const colleague = await api.member(b, 'colleague', [['record.booking-types.update']]);
    const theirs = await api
      .as(colleague.token)
      .post('/v2/appointments/calendar/microsoft/confirm')
      .send({ ticket });
    expect(theirs.status).toBe(403);
    expect(code(theirs)).toBe('APPT_CALENDAR_CONFIRM_NOT_YOURS');
    // Another workspace's admin.
    const other = await api.post(a.admin, '/v2/appointments/calendar/microsoft/confirm', {
      ticket,
    });
    expect(other.status).toBe(403);
    expect(code(other)).toBe('APPT_CALENDAR_CONFIRM_NOT_YOURS');
    expect(ms.tokenCalls('authorization_code')).toHaveLength(before);
    expect(await rows(b.orgId)).toHaveLength(0);
    // The owner of the link can still use it.
    const mine = await api.post(b.admin, '/v2/appointments/calendar/microsoft/confirm', { ticket });
    expect(mine.status).toBe(200);
    // Disconnect again so the neighbour stays empty for the tests below.
    expect((await api.post(b.admin, '/v2/appointments/calendar/microsoft/disconnect')).status).toBe(
      200,
    );
    expect(await rows(b.orgId)).toHaveLength(0);
  });

  it('a ticket is good once: a replay fails because the code was spent, and the connection is left as it was', async () => {
    const where = await callbackFor(b, 'code-once');
    const ticket = ticketOf(where);
    expect(
      (await api.post(b.admin, '/v2/appointments/calendar/microsoft/confirm', { ticket })).status,
    ).toBe(200);
    const again = await api.post(b.admin, '/v2/appointments/calendar/microsoft/confirm', {
      ticket,
    });
    expect(again.status).toBe(410);
    expect(code(again)).toBe('APPT_CALENDAR_CONFIRM_INVALID');
    expect(await card(b, 'microsoft')).toMatchObject({ status: 'connected' });
    expect((await api.post(b.admin, '/v2/appointments/calendar/microsoft/disconnect')).status).toBe(
      200,
    );
  });

  it('refuses a forged, expired or foreign ticket, and a callback whose state is forged, tampered or expired', async () => {
    const before = ms.requests.length;
    for (const ticket of ['nonsense'.repeat(5), 'a'.repeat(30) + '.' + 'b'.repeat(30)]) {
      const res = await api.post(b.admin, '/v2/appointments/calendar/microsoft/confirm', {
        ticket,
      });
      expect(res.status, ticket).toBe(410);
      expect(code(res)).toBe('APPT_CALENDAR_CONFIRM_INVALID');
    }
    const expired = signTicket(
      {
        orgId: b.orgId,
        userId: b.adminUserId,
        returnTo: '/appointments/settings',
        sealedCode: 'x',
        expiresAt: Date.now() - 1000,
      },
      KEY,
    );
    expect(
      code(
        await api.post(b.admin, '/v2/appointments/calendar/microsoft/confirm', { ticket: expired }),
      ),
    ).toBe('APPT_CALENDAR_CONFIRM_INVALID');

    const good = signState(
      newState({ orgId: b.orgId, userId: null, returnTo: '/appointments/settings' }, Date.now()),
      KEY,
    );
    const get = (state?: string) =>
      request(h.app.getHttpServer())
        .get(CALLBACK)
        .query({ code: 'x', ...(state ? { state } : {}) })
        .redirects(0);
    expect((await get()).headers.location).toBe(`${SETTINGS_PAGE}?outlook=failed`);
    expect((await get(`${good.slice(0, -3)}AAA`)).headers.location).toBe(
      `${SETTINGS_PAGE}?outlook=failed`,
    );
    const old = signState(
      newState(
        { orgId: b.orgId, userId: null, returnTo: '/appointments/settings' },
        Date.now() - 3_600_000,
      ),
      KEY,
    );
    expect((await get(old)).headers.location).toBe(`${SETTINGS_PAGE}?outlook=expired`);
    expect(ms.requests).toHaveLength(before);
    expect(await rows(b.orgId)).toHaveLength(0);
  });

  it('a person who says no on Microsoft stores nothing', async () => {
    const start = await api.post(b.admin, '/v2/appointments/calendar/microsoft/start', {});
    const state = new URL(start.body.url as string).searchParams.get('state')!;
    const res = await request(h.app.getHttpServer())
      .get(CALLBACK)
      .query({ error: 'access_denied', state })
      .redirects(0);
    expect(res.headers.location).toBe(`${SETTINGS_PAGE}?outlook=denied`);
    expect(await rows(b.orgId)).toHaveLength(0);
  });

  it('a consent without the calendar permission, or without a refresh token, stores nothing', async () => {
    expect(
      await connect(b, 'code-noscope', {
        email: 'bea@contoso.example',
        scope: 'openid profile email User.Read offline_access',
      }),
    ).toBe(`${SETTINGS_PAGE}?calendar=missing_scope`);
    expect(
      await connect(b, 'code-norefresh', { email: 'bea@contoso.example', refresh: false }),
    ).toBe(`${SETTINGS_PAGE}?calendar=missing_scope`);
    expect(await rows(b.orgId)).toHaveLength(0);
  });

  it('Microsoft being unreachable while the code is exchanged ends in a clean refusal that can be retried', async () => {
    const where = await callbackFor(b, 'code-outage', { email: 'bea@contoso.example' });
    ms.failNext('POST', /\/token$/, 503);
    const res = await api.post(b.admin, '/v2/appointments/calendar/microsoft/confirm', {
      ticket: ticketOf(where),
    });
    expect(res.status).toBe(410);
    expect(code(res)).toBe('APPT_CALENDAR_CONFIRM_INVALID');
    expect(await rows(b.orgId)).toHaveLength(0);
    ms.clearFailures();
  });
});

// --- choosing the calendar -------------------------------------------------------------------------------------------

describe('choosing which calendar bookings go to', () => {
  beforeAll(() => {
    const acc = ms.account(ANA);
    ms.addCalendar(acc, 'team-cal', 'Team calendar');
    ms.addCalendar(acc, 'birthdays', 'Birthdays', false);
  });

  it('lists the calendars the account can write to, the default one first, and no read-only calendar', async () => {
    const res = await api.as(a.admin).get('/v2/appointments/calendar/microsoft/calendars');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual(['primary', 'team-cal']);
    expect(res.body.data[0]).toMatchObject({ primary: true, name: 'Calendar' });
  });

  it('chooses a listed calendar, refuses one that is not, and reports the choice', async () => {
    const ok = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/microsoft/calendar')
      .send({ calendarId: 'team-cal' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      calendarId: 'team-cal',
      calendarName: 'Team calendar',
      provider: 'microsoft',
    });
    for (const bad of ['birthdays', 'nope']) {
      const res = await api
        .as(a.admin)
        .put('/v2/appointments/calendar/microsoft/calendar')
        .send({ calendarId: bad });
      expect(res.status, bad).toBe(422);
    }
    expect((await card(a, 'microsoft')).calendarId).toBe('team-cal');
    const put = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/microsoft/calendar')
      .send({ calendarId: 'primary' });
    expect(put.status).toBe(200);
  });

  it("a Microsoft failure while listing is a 502 with a stable code, not Microsoft's text", async () => {
    ms.failNext('GET', /\/me\/calendars$/, 500, { times: 2 });
    const res = await api.as(a.admin).get('/v2/appointments/calendar/microsoft/calendars');
    expect(res.status).toBe(502);
    expect(code(res)).toBe('APPT_CALENDAR_PROVIDER_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('injected');
    ms.clearFailures();
  });
});

// --- events ----------------------------------------------------------------------------------------------------------

describe('writing events', () => {
  const DEFAULT = `default-oid-${ANA}`;

  it('writes a confirmed booking as an event with a Teams room, and stores the id, the link and the provider', async () => {
    const { slots, appt } = await bookAndWrite('Consult', 2, { locationType: 'virtual' });
    const events = ms.eventsOf(DEFAULT);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev).toMatchObject({
      subject: 'Consult',
      showAs: 'busy',
      transactionId: appt.id,
      attendees: [
        {
          type: 'required',
          emailAddress: { address: 'consult@example.com', name: 'Guest Consult' },
        },
      ],
    });
    expect(ev.singleValueExtendedProperties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '1' }),
        expect.objectContaining({ value: appt.id }),
      ]),
    );
    expect(ev.start.dateTime).toBe(new Date(slots[2]!.start).toISOString().slice(0, 19));
    expect(ev.onlineMeeting?.joinUrl).toMatch(/^https:\/\/teams\.example\/meet\//);
    const row = await api.rowOf(appt.id);
    expect(row).toMatchObject({
      calendar_event_id: ev.id,
      calendar_provider: 'microsoft',
      meet_url: ev.onlineMeeting!.joinUrl,
    });
    expect((await api.appt(a.admin, appt.id)).calendar).toMatchObject({ eventId: ev.id });
    // The access token stored at connect time was good: the adapter never had to refresh.
    expect(ms.tokenCalls('refresh_token')).toHaveLength(0);
  });

  it('a redelivered event updates the same Outlook event: never a second one', async () => {
    const { appt } = await bookAndWrite('Twice', 3);
    const ev = await lastEvent('appointment.booked', appt.id);
    const before = ms.eventsOf(DEFAULT).length;
    await consumer.handle(ev);
    await consumer.handle(ev);
    expect(ms.eventsOf(DEFAULT)).toHaveLength(before);
    expect(ms.eventsOf(DEFAULT).filter((e) => e.transactionId === appt.id)).toHaveLength(1);
  });

  it('a retry after a lost answer finds the event it already made (the transaction id is the proof)', async () => {
    const type = await api.type(a.admin, { name: 'Lost answer' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'Fay', phone: '+919811166604' },
    });
    const ev = await lastEvent('appointment.booked', appt.id);
    // The first try is delivered but its answer is lost: the event exists, the appointment does not know its id.
    await consumer.handle(ev);
    await h.owner.query(
      `UPDATE appointments SET calendar_event_id = NULL, calendar_provider = NULL WHERE uuid = $1`,
      [appt.id],
    );
    const before = ms.eventsOf(DEFAULT).length;
    await consumer.handle(ev);
    expect(ms.eventsOf(DEFAULT)).toHaveLength(before);
    expect((await api.rowOf(appt.id)).calendar_event_id).toBeTruthy();
  });

  it('a create that meets a conflict finds the event by its private property and updates it', async () => {
    const type = await api.type(a.admin, { name: 'Conflict' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[5]!.start,
      invitee: { name: 'Gus', phone: '+919811166605' },
    });
    const ev = await lastEvent('appointment.booked', appt.id);
    await consumer.handle(ev);
    await h.owner.query(
      `UPDATE appointments SET calendar_event_id = NULL, calendar_provider = NULL WHERE uuid = $1`,
      [appt.id],
    );
    const before = ms.eventsOf(DEFAULT).length;
    ms.failNext('POST', /\/events$/, 409, {
      body: { error: { code: 'ErrorIrresolvableConflict' } },
    });
    await consumer.handle(ev);
    expect(ms.eventsOf(DEFAULT)).toHaveLength(before);
    expect((await api.rowOf(appt.id)).calendar_event_id).toBeTruthy();
  });

  it('a reschedule moves the same event; a cancel deletes it; a redelivered cancel is still fine', async () => {
    const { slots, appt } = await bookAndWrite('Move', 6);
    const id = (await api.rowOf(appt.id)).calendar_event_id as string;
    const moved = await api.post(a.admin, `/v2/appointments/${appt.id}/reschedule`, {
      startsAt: slots[8]!.start,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    await consumer.handle(await lastEvent('appointment.rescheduled', appt.id));
    expect(ms.events.get(id)!.start.dateTime).toBe(
      new Date(slots[8]!.start).toISOString().slice(0, 19),
    );
    expect(ms.eventsOf(DEFAULT).filter((e) => e.transactionId === appt.id)).toHaveLength(1);
    expect(ms.count('PATCH', new RegExp(`/me/events/${id}$`))).toBe(1);

    // Somebody removed it in Outlook: the next change brings it back (a 404 on the patch, a fresh create).
    ms.removeEvent(id);
    await api.post(a.admin, `/v2/appointments/${appt.id}/reschedule`, {
      startsAt: slots[7]!.start,
    });
    await consumer.handle(await lastEvent('appointment.rescheduled', appt.id));
    const newId = (await api.rowOf(appt.id)).calendar_event_id as string;
    expect(ms.events.has(newId)).toBe(true);

    const cancelled = await api.post(a.admin, `/v2/appointments/${appt.id}/cancel`, {});
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const ev = await lastEvent('appointment.cancelled', appt.id);
    await consumer.handle(ev);
    expect(ms.events.has(newId)).toBe(false);
    await consumer.handle(ev); // a 404 on delete is "already deleted"
  });

  it('a Teams room Microsoft refuses (a personal account) does not cost the booking its event', async () => {
    ms.noTeams.add(`oid-${ANA}`);
    const { appt } = await bookAndWrite('NoTeams', 9, { locationType: 'virtual' });
    ms.noTeams.delete(`oid-${ANA}`);
    const row = await api.rowOf(appt.id);
    expect(row.calendar_event_id).toBeTruthy();
    expect(row.meet_url ?? null).toBeNull();
  });

  it('an outage while writing throws, so the outbox retries it; the appointment is left without an event', async () => {
    const type = await api.type(a.admin, { name: 'Outage' });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[10]!.start,
      invitee: { name: 'Hal', phone: '+919811166610' },
    });
    const ev = await lastEvent('appointment.booked', appt.id);
    ms.failNext('POST', /\/events$/, 503);
    await expect(consumer.handle(ev)).rejects.toMatchObject({ kind: 'server' });
    expect((await api.rowOf(appt.id)).calendar_event_id).toBeNull();
    await consumer.handle(ev);
    expect((await api.rowOf(appt.id)).calendar_event_id).toBeTruthy();
  });
});

// --- busy time -------------------------------------------------------------------------------------------------------

describe('busy time', () => {
  it('an Outlook meeting closes the slots it overlaps, ours do not close their own (a group type)', async () => {
    const type = await api.type(a.admin, { name: 'Busy', durationMinutes: 30 });
    const before = await api.slots(a.admin, type.id);
    const first = before[20]!;
    ms.addBusy(ms.account(ANA), first.start, first.end);
    const after = await api.slots(a.admin, type.id);
    expect(after.map((s) => s.start)).not.toContain(first.start);
    expect(after).toHaveLength(before.length - 1);
    // A tentative and a free block: only the tentative one closes a slot.
    const second = before[22]!;
    ms.addBusy(ms.account(ANA), second.start, second.end, { showAs: 'tentative' });
    const third = before[24]!;
    ms.addBusy(ms.account(ANA), third.start, third.end, { showAs: 'free' });
    const again = (await api.slots(a.admin, type.id)).map((s) => s.start);
    expect(again).not.toContain(second.start);
    expect(again).toContain(third.start);

    const group = await api.type(a.admin, { name: 'Group', capacity: 3, durationMinutes: 30 });
    const g = await api.slots(a.admin, group.id);
    const slot = g[30]!;
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: group.id,
      startsAt: slot.start,
      invitee: { name: 'Ida', phone: '+919811166630' },
    });
    await consumer.handle(await lastEvent('appointment.booked', appt.id));
    const seats = (await api.slots(a.admin, group.id)).find((s) => s.start === slot.start);
    expect(seats?.remaining).toBe(2);
  });

  it('a Microsoft outage means no busy data: slots are offered, and a booking is not blocked', async () => {
    const type = await api.type(a.admin, { name: 'Outage slots' });
    ms.failNext('GET', /calendarView$/, 500, { times: 3 });
    const slots = await api.slots(a.admin, type.id);
    expect(slots.length).toBeGreaterThan(10);
    ms.clearFailures();
  });
});

// --- tokens ----------------------------------------------------------------------------------------------------------

describe('tokens', () => {
  it('an expired access token is refreshed, and the ROTATED refresh token replaces the stored one', async () => {
    ms.strictRotation = true;
    const [before] = await rows(a.orgId);
    await h.owner.query(
      `UPDATE appointment_microsoft_connections SET access_token_expires_at = now() - interval '1 minute' WHERE org_id = $1`,
      [a.orgId],
    );
    adapter.forget(a.orgId);
    const type = await api.type(a.admin, { name: 'Refresh' });
    await api.slots(a.admin, type.id);
    expect(ms.tokenCalls('refresh_token')).toHaveLength(1);
    const [after] = await rows(a.orgId);
    expect(after!.refresh_token_enc).not.toBe(before!.refresh_token_enc);
    expect(new Date(after!.access_token_expires_at as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
    // The old refresh token is dead at Microsoft (strict mode): the next refresh only works because the new one was stored.
    await h.owner.query(
      `UPDATE appointment_microsoft_connections SET access_token_expires_at = now() - interval '1 minute' WHERE org_id = $1`,
      [a.orgId],
    );
    adapter.forget(a.orgId);
    await api.slots(a.admin, type.id);
    expect(ms.tokenCalls('refresh_token')).toHaveLength(2);
    expect((await card(a, 'microsoft')).status).toBe('connected');
    ms.strictRotation = false;
  });

  it('an access token Microsoft refuses early (401) is refreshed once and the call repeated', async () => {
    ms.killAccessTokens();
    const refreshes = ms.tokenCalls('refresh_token').length;
    const { appt } = await bookAndWrite('Early401', 11);
    expect((await api.rowOf(appt.id)).calendar_event_id).toBeTruthy();
    expect(ms.tokenCalls('refresh_token').length).toBe(refreshes + 1);
  });

  it('a refresh token Microsoft refuses marks the connection needs_reconnect, once, with audit and event; nothing is written until a new consent', async () => {
    for (const t of ms.refreshTokens.values()) t.valid = false;
    ms.killAccessTokens();
    await h.owner.query(
      `UPDATE appointment_microsoft_connections SET access_token_expires_at = now() - interval '1 minute' WHERE org_id = $1`,
      [a.orgId],
    );
    adapter.forget(a.orgId);
    const type = await api.type(a.admin, { name: 'Dead grant' });
    await api.slots(a.admin, type.id); // a failed busy lookup never stops the visitor
    expect((await card(a, 'microsoft')).status).toBe('needs_reconnect');
    expect((await card(a, 'microsoft')).account).toBe(ANA);
    expect(await outboxTypes(a.orgId)).toContain('appointment_calendar.needs_reconnect:microsoft');
    expect(
      await api.auditCount(a.orgId, 'appointment_calendar_microsoft', 'update'),
    ).toBeGreaterThanOrEqual(1);
    const count = (await outboxTypes(a.orgId)).filter((t) =>
      t.startsWith('appointment_calendar.needs_reconnect'),
    ).length;
    await api.slots(a.admin, type.id);
    expect(
      (await outboxTypes(a.orgId)).filter((t) =>
        t.startsWith('appointment_calendar.needs_reconnect'),
      ).length,
    ).toBe(count);

    // A booking made now writes nothing, and does not throw.
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[12]!.start,
      invitee: { name: 'Jo', phone: '+919811166612' },
    });
    const before = ms.events.size;
    await consumer.handle(await lastEvent('appointment.booked', appt.id));
    expect(ms.events.size).toBe(before);

    // The admin connects again: back to connected, the chosen calendar kept (same account).
    expect(await connect(a, 'code-again')).toBe(`${SETTINGS_PAGE}?calendar=connected`);
    expect(await card(a, 'microsoft')).toMatchObject({
      status: 'connected',
      calendarId: 'primary',
    });
  });
});

// --- two providers ---------------------------------------------------------------------------------------------------

describe('a workspace with Google AND Outlook', () => {
  const OUTLOOK_CAL = `default-oid-${ANA}`;

  it('busy time is read from both; an event is written to ONE of them', async () => {
    google.clientId = 'g-client';
    google.clientSecret = 'g-secret';
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'g-client';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'g-secret';
    await connectGoogle(a, 'g-code');
    const o = await overview(a);
    expect(o.providers.map((p) => [p.provider, p.status, p.active])).toEqual([
      ['google', 'connected', true],
      ['microsoft', 'connected', false],
    ]);
    // Automatic: Google when usable.
    expect(o.writeProvider).toBe('google');
    expect(o.preferredProvider).toBeNull();

    const type = await api.type(a.admin, { name: 'Both', durationMinutes: 30 });
    const base = await api.slots(a.admin, type.id);
    const inOutlook = base[40]!;
    const inGoogle = base[42]!;
    ms.addBusy(ms.account(ANA), inOutlook.start, inOutlook.end);
    google.busy.set(ANA_G, [{ start: inGoogle.start, end: inGoogle.end }]);
    const starts = (await api.slots(a.admin, type.id)).map((s) => s.start);
    expect(starts).not.toContain(inOutlook.start);
    expect(starts).not.toContain(inGoogle.start);

    // One calendar failing leaves the other's busy time in force.
    ms.failNext('GET', /calendarView$/, 500, { times: 5 });
    const partial = (await api.slots(a.admin, type.id)).map((s) => s.start);
    expect(partial).toContain(inOutlook.start);
    expect(partial).not.toContain(inGoogle.start);
    ms.clearFailures();

    const outlookBefore = ms.eventsOf(OUTLOOK_CAL).length;
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: base[45]!.start,
      invitee: { name: 'Kim', phone: '+919811166640' },
    });
    await consumer.handle(await lastEvent('appointment.booked', appt.id));
    expect(google.eventsOf(ANA_G)).toHaveLength(1);
    expect(ms.eventsOf(OUTLOOK_CAL)).toHaveLength(outlookBefore);
    expect((await api.rowOf(appt.id)).calendar_provider).toBe('google');
  });

  it('choosing Outlook moves the next write there and removes the event from Google', async () => {
    const chosen = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/provider')
      .send({ provider: 'microsoft' });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
    expect(chosen.body).toMatchObject({
      writeProvider: 'microsoft',
      preferredProvider: 'microsoft',
    });
    expect(await outboxTypes(a.orgId)).toContain(
      'appointment_calendar.provider_selected:microsoft',
    );
    expect(await api.auditCount(a.orgId, 'appointment_calendar_preference', 'insert')).toBe(1);

    const [{ uuid }] = (
      await h.owner.query(
        `SELECT uuid FROM appointments WHERE org_id = $1 AND calendar_provider = 'google' LIMIT 1`,
        [a.orgId],
      )
    ).rows as Array<{ uuid: string }>;
    const googleId = (await api.rowOf(uuid)).calendar_event_id as string;
    const outlookBefore = ms.eventsOf(OUTLOOK_CAL).length;
    // Any change to the booking writes its CURRENT state to the provider bookings go to now.
    await consumer.handle(await lastEvent('appointment.booked', uuid));
    expect(ms.eventsOf(OUTLOOK_CAL)).toHaveLength(outlookBefore + 1);
    expect(google.eventsOf(ANA_G).find((e) => e.id === googleId)?.status).toBe('cancelled');
    expect((await api.rowOf(uuid)).calendar_provider).toBe('microsoft');
    expect(await overview(a)).toMatchObject({ writeProvider: 'microsoft' });
  });

  it('a provider that is not connected cannot be chosen, and automatic can be restored', async () => {
    const fresh = await api.signup('msc');
    const res = await api
      .as(fresh.admin)
      .put('/v2/appointments/calendar/provider')
      .send({ provider: 'microsoft' });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('APPT_CALENDAR_NOT_CONNECTED');
    const back = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/provider')
      .send({ provider: null });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ preferredProvider: null, writeProvider: 'google' });
    expect(await api.auditCount(a.orgId, 'appointment_calendar_preference', 'delete')).toBe(1);
    const nothing = await api
      .as(a.admin)
      .put('/v2/appointments/calendar/provider')
      .send({ provider: 'nope' });
    expect(nothing.status).toBe(422);
  });

  it('disconnecting Outlook forgets the tokens, clears a choice that named it, and leaves Google writing', async () => {
    expect(
      (
        await api
          .as(a.admin)
          .put('/v2/appointments/calendar/provider')
          .send({ provider: 'microsoft' })
      ).status,
    ).toBe(200);
    const off = await api.post(a.admin, '/v2/appointments/calendar/microsoft/disconnect');
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ status: 'disconnected', account: null });
    expect(await rows(a.orgId)).toHaveLength(0);
    expect(await overview(a)).toMatchObject({ preferredProvider: null, writeProvider: 'google' });
    expect(await outboxTypes(a.orgId)).toContain('appointment_calendar.disconnected:microsoft');
    expect(await api.auditCount(a.orgId, 'appointment_calendar_microsoft', 'delete')).toBe(1);
    // Idempotent.
    expect((await api.post(a.admin, '/v2/appointments/calendar/microsoft/disconnect')).status).toBe(
      200,
    );
    // An appointment whose event was in Outlook is moved to Google by its next change, and Microsoft is not asked (it is gone).
    const calls = ms.requests.length;
    const [{ uuid }] = (
      await h.owner.query(
        `SELECT uuid FROM appointments WHERE org_id = $1 AND calendar_provider = 'microsoft' LIMIT 1`,
        [a.orgId],
      )
    ).rows as Array<{ uuid: string }>;
    await consumer.handle(await lastEvent('appointment.booked', uuid));
    expect((await api.rowOf(uuid)).calendar_provider).toBe('google');
    expect(ms.requests.length).toBe(calls);
  });
});
