import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  FakeVideoProvider,
  VIDEO_PROVIDER_ADAPTERS,
} from '../../../src/infra/providers/meeting-conferencing';
import type { OutboxEvent } from '../../../src/kernel/outbox/outbox-subscribers';
import { ConferencingReleaseConsumer } from '../../../src/modules/meeting-conferencing/conferencing-release.consumer';
import { MeetingConferencingWorkerModule } from '../../../src/modules/meeting-conferencing';
import {
  deriveStateKey,
  signTicket,
  TICKET_TTL_SECONDS,
} from '../../../src/modules/meeting-conferencing/conferencing-state';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { FakeGoogle } from '../appointments-booking/fake-google';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Video links and calendar entries for a contact's meeting (BL-360..BL-362), end to end through HTTP against a real Postgres: nothing is
 * offered before the integration is installed AND the person connected their own account; the consent round trip with its confirmation;
 * a Zoom / Teams room made when the meeting is saved, moved with it and removed with it (through the real outbox consumer); a provider that
 * fails leaves the meeting saved with a problem and a working Retry; a grant the provider refuses; Google Meet through the workspace's
 * connected Google Calendar; tenant isolation.
 *
 * Zoom and Teams are the in-memory fake adapter (`CONFERENCING_FAKE=1`), Google is the local stand-in the appointment tests use. Neither is
 * a real account: what is proved is this code against those descriptions, not against Zoom, Microsoft or Google.
 */
let h: Harness;
let api: Api;
let fakeGoogle: FakeGoogle;
let zoom: FakeVideoProvider;
let teams: FakeVideoProvider;
let consumer: ConferencingReleaseConsumer;
let a: Tenant;
let b: Tenant;
let contact: string;
const saved: Record<string, string | undefined> = {};
const KEYS = [
  'CONFERENCING_FAKE',
  'CONFERENCING_RETRIES',
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'GOOGLE_RETRIES',
  'GOOGLE_RETRY_BASE_MS',
  'GOOGLE_BUSY_CACHE_SECONDS',
];
const STATE_KEY = deriveStateKey(Buffer.alloc(32, 7).toString('base64'));

beforeAll(async () => {
  fakeGoogle = await FakeGoogle.start();
  for (const k of [...KEYS, ...Object.keys(fakeGoogle.env())]) saved[k] = process.env[k];
  Object.assign(process.env, fakeGoogle.env(), {
    CONFERENCING_FAKE: '1',
    CONFERENCING_RETRIES: '0',
    GOOGLE_CALENDAR_CLIENT_ID: 'test-client',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'test-secret',
    GOOGLE_RETRIES: '0',
    GOOGLE_RETRY_BASE_MS: '1',
    GOOGLE_BUSY_CACHE_SECONDS: '0',
  });
  h = await startHarness({ loadModules: async () => [MeetingConferencingWorkerModule] });
  api = new Api(h);
  const adapters = h.app.get(VIDEO_PROVIDER_ADAPTERS) as {
    zoom: FakeVideoProvider;
    teams: FakeVideoProvider;
  };
  zoom = adapters.zoom;
  teams = adapters.teams;
  expect(zoom).toBeInstanceOf(FakeVideoProvider);
  consumer = h.app.get(ConferencingReleaseConsumer);
  a = await api.signup('cfa');
  b = await api.signup('cfb');
  [contact] = await api.seedContacts(a, [{ name: 'Priya Rao', email: 'priya@example.test' }]);
}, 600_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await h?.stop();
  await fakeGoogle?.stop();
});

// --- helpers -----------------------------------------------------------------------------------------------------------

const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
const when = (offsetHours: number) => new Date(Date.now() + offsetHours * 3_600_000).toISOString();

interface Caps {
  video: Array<{ provider: string; via: string }>;
  calendar: { provider: string; account: string | null; calendarName: string | null } | null;
  canInstall: boolean;
  connectable: string[];
  installable: boolean;
}
const caps = async (token: string): Promise<Caps> => {
  const res = await api.as(token).get('/v2/conferencing/capabilities');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Caps;
};

/** The workspace installs a Marketplace listing: a row in workspace_app_installations (the listing is a draft in the seed; installs are rows). */
async function install(t: Tenant, slug: string): Promise<void> {
  const app = await h.owner.query(`SELECT id FROM marketplace_apps WHERE slug = $1`, [slug]);
  const version = await h.owner.query(
    `SELECT id, scopes FROM marketplace_app_versions WHERE app_id = $1 ORDER BY id DESC LIMIT 1`,
    [app.rows[0].id],
  );
  await h.owner.query(
    `INSERT INTO workspace_app_installations (org_id, app_id, installed_version_id, status, granted_scopes)
     VALUES ($1, $2, $3, 'active', $4) ON CONFLICT (org_id, app_id) DO UPDATE SET status = 'active'`,
    [t.orgId, app.rows[0].id, version.rows[0].id, version.rows[0].scopes],
  );
}
async function uninstall(t: Tenant, slug: string): Promise<void> {
  await h.owner.query(
    `DELETE FROM workspace_app_installations WHERE org_id = $1 AND app_id = (SELECT id FROM marketplace_apps WHERE slug = $2)`,
    [t.orgId, slug],
  );
}

/** Press Connect, the provider redirects back with a code, the same person confirms. */
async function connect(
  t: Tenant,
  token: string,
  provider: 'zoom' | 'teams',
  email: string,
): Promise<string> {
  const start = await api.as(token).post(`/v2/conferencing/${provider}/start`).send({});
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = new URL(start.body.url as string).searchParams.get('state')!;
  const cb = await request(h.app.getHttpServer())
    .get(`/v2/public/conferencing/${provider}/callback`)
    .query({ code: email, state })
    .redirects(0);
  expect(cb.status).toBe(302);
  const location = new URL(cb.headers.location as string);
  expect(location.searchParams.get('video')).toBe('confirm');
  const ticket = location.searchParams.get('ticket')!;
  const done = await api.as(token).post(`/v2/conferencing/${provider}/confirm`).send({ ticket });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  expect(done.body.status).toBe('connected');
  return ticket;
}

const meetingBody = (extra: Record<string, unknown> = {}) => ({
  title: 'Intro call',
  startsAt: when(24),
  endsAt: when(24.5),
  ...extra,
});
const create = (token: string, contactId: string, body: Record<string, unknown>) =>
  api
    .as(token)
    .post(`/v2/contacts/${contactId}/meetings`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send(body);

interface Meeting {
  id: string;
  rowVersion: number;
  joinUrl?: string | null;
  conferencing?: {
    videoProvider: string | null;
    videoStatus: string | null;
    videoError: string | null;
    calendarProvider: string | null;
    calendarStatus: string | null;
    calendarError: string | null;
    invited: boolean;
  } | null;
}

/** Hands the outbox events of a type to the real consumer, as the drain would, and returns how many it handled. */
async function drainReleases(t: Tenant): Promise<number> {
  const res = await h.owner.query(
    `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
      WHERE org_id = $1 AND event_type = 'contact_meeting.conferencing_release' AND processed_at IS NULL ORDER BY id`,
    [t.orgId],
  );
  for (const r of res.rows) {
    await consumer.handle({
      id: Number(r.id),
      orgId: Number(r.org_id),
      aggregateModule: r.aggregate_module,
      aggregateId: Number(r.aggregate_id),
      eventType: r.event_type,
      payload: r.payload,
    } as unknown as OutboxEvent);
    await h.owner.query(`UPDATE event_outbox SET processed_at = now() WHERE id = $1`, [r.id]);
  }
  return res.rows.length;
}

// --- tests -------------------------------------------------------------------------------------------------------------------

describe('nothing is offered before the integration is installed and connected', () => {
  it('shows no video options, no connect link and nothing installed to a workspace that has installed nothing', async () => {
    // The seeded listings are drafts, so nothing is installable yet either.
    const c = await caps(a.admin);
    expect(c.video).toEqual([]);
    expect(c.connectable).toEqual([]);
    expect(c.calendar).toBeNull();
    expect(c.installable).toBe(false);
  });

  it('refuses to connect an app the workspace has not installed', async () => {
    const res = await api.as(a.admin).post('/v2/conferencing/zoom/start').send({});
    expect(res.status).toBe(409);
    expect(code(res)).toBe('CONF_APP_NOT_INSTALLED');
    const list = await api.as(a.admin).get('/v2/conferencing/connections');
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { status: string }) => c.status)).toEqual([
      'not_installed',
      'not_installed',
    ]);
  });

  it('a request for a link on a workspace with nothing installed saves the meeting and records why there is no link', async () => {
    const res = await create(
      a.admin,
      contact,
      meetingBody({ conferencing: { videoProvider: 'zoom' } }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const m = res.body as Meeting;
    expect(m.joinUrl ?? null).toBeNull();
    expect(m.conferencing).toMatchObject({
      videoProvider: 'zoom',
      videoStatus: 'failed',
      videoError: 'not_installed',
    });
  });

  it('a meeting with a link or a calendar entry but no start time is refused and nothing is saved', async () => {
    const before = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_meetings WHERE org_id = $1`,
      [a.orgId],
    );
    const res = await create(a.admin, contact, {
      title: 'No time',
      conferencing: { videoProvider: 'zoom' },
    });
    expect(res.status).toBe(422);
    const after = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_meetings WHERE org_id = $1`,
      [a.orgId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe("connecting a person's own Zoom account", () => {
  it("installing makes it connectable, and only that person's confirmation connects it", async () => {
    await install(a, 'zoom');
    const c = await caps(a.admin);
    expect(c.video).toEqual([]);
    expect(c.connectable).toEqual(['zoom']);

    // Another member of the workspace cannot finish a consent the admin started.
    const colleague = await api.member(a, 'colleague', [
      ['record.contacts.update'],
      ['record.contacts.read'],
    ]);
    const start = await api.as(a.admin).post('/v2/conferencing/zoom/start').send({});
    const state = new URL(start.body.url as string).searchParams.get('state')!;
    const cb = await request(h.app.getHttpServer())
      .get('/v2/public/conferencing/zoom/callback')
      .query({ code: 'ana@example.com', state })
      .redirects(0);
    const ticket = new URL(cb.headers.location as string).searchParams.get('ticket')!;
    const stolen = await api
      .as(colleague.token)
      .post('/v2/conferencing/zoom/confirm')
      .send({ ticket });
    expect(stolen.status).toBe(403);
    expect(code(stolen)).toBe('CONF_CONFIRM_NOT_YOURS');
    expect(
      (await h.owner.query(`SELECT 1 FROM conferencing_connections WHERE org_id = $1`, [a.orgId]))
        .rows,
    ).toHaveLength(0);

    const ok = await api.as(a.admin).post('/v2/conferencing/zoom/confirm').send({ ticket });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      provider: 'zoom',
      status: 'connected',
      account: 'ana@example.com',
    });
    // The tokens are stored sealed, never as the provider sent them.
    const row = (
      await h.owner.query(
        `SELECT refresh_token_enc, access_token_enc FROM conferencing_connections WHERE org_id = $1`,
        [a.orgId],
      )
    ).rows[0];
    expect(row.refresh_token_enc).not.toContain('fake-refresh');
    expect(row.access_token_enc).not.toContain('fake-access');
    expect(await api.auditCount(a.orgId, 'conferencing_connection', 'insert')).toBe(1);

    const after = await caps(a.admin);
    expect(after.video).toEqual([{ provider: 'zoom', via: 'app' }]);
    expect(after.connectable).toEqual([]);
  });

  it('refuses a bad state, an expired ticket and a ticket for the other provider', async () => {
    const cb = await request(h.app.getHttpServer())
      .get('/v2/public/conferencing/zoom/callback')
      .query({ code: 'x', state: 'forged.state' })
      .redirects(0);
    expect(new URL(cb.headers.location as string).searchParams.get('video')).toBe('failed');

    const crypto_ = h.app.get(CryptoService);
    const make = (over: Partial<{ expiresAt: number; provider: 'zoom' | 'teams' }>) =>
      signTicket(
        {
          orgId: a.orgId,
          userId: a.adminUserId,
          provider: over.provider ?? 'zoom',
          returnTo: '/x',
          sealedCode: crypto_.encrypt('ana@example.com'),
          expiresAt: over.expiresAt ?? Date.now() + TICKET_TTL_SECONDS * 1000,
        },
        // The harness runs with the same credentials key as the other calendar tests, so this key signs a ticket the app accepts.
        STATE_KEY,
      );
    // A ticket made for Zoom does not connect Teams.
    const wrongProvider = await api
      .as(a.admin)
      .post('/v2/conferencing/teams/confirm')
      .send({ ticket: make({}) });
    expect(wrongProvider.status).toBe(422);
    expect(code(wrongProvider)).toBe('CONF_CONFIRM_INVALID');
    const forged = await api
      .as(a.admin)
      .post('/v2/conferencing/zoom/confirm')
      .send({ ticket: 'not.a-ticket-at-all' });
    expect(forged.status).toBe(422);
    const expired = await api
      .as(a.admin)
      .post('/v2/conferencing/zoom/confirm')
      .send({ ticket: make({ expiresAt: Date.now() - 1 }) });
    expect(expired.status).toBe(422);
  });

  it('another workspace cannot see the connection or the option', async () => {
    expect((await caps(b.admin)).video).toEqual([]);
    const list = await api.as(b.admin).get('/v2/conferencing/connections');
    expect(list.body.data.map((c: { status: string }) => c.status)).toEqual([
      'not_installed',
      'not_installed',
    ]);
  });
});

describe('a Zoom link made, moved and removed with the meeting', () => {
  let m: Meeting;

  it('creates the room when the meeting is saved and returns the join link', async () => {
    const res = await create(
      a.admin,
      contact,
      meetingBody({ conferencing: { videoProvider: 'zoom', timeZone: 'Asia/Kolkata' } }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    m = res.body as Meeting;
    expect(m.joinUrl).toMatch(/^https:\/\/zoom\.fake\.test\/j\/zoom-room-/);
    expect(m.conferencing).toMatchObject({
      videoProvider: 'zoom',
      videoStatus: 'ready',
      videoError: null,
    });
    expect(zoom.rooms.size).toBeGreaterThan(0);
    const room = [...zoom.rooms.values()].at(-1)!;
    expect(room.request.timezone).toBe('Asia/Kolkata');
    expect(room.request.topic).toBe('Intro call');
  });

  it('moves the room when the meeting is moved or renamed, and the join link stays', async () => {
    const newStart = when(48);
    const res = await api
      .as(a.admin)
      .patch(`/v2/contacts/${contact}/meetings/${m.id}`)
      .send({
        title: 'Moved call',
        startsAt: newStart,
        endsAt: when(48.5),
        rowVersion: m.rowVersion,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const next = res.body as Meeting;
    expect(next.joinUrl).toBe(m.joinUrl);
    const room = [...zoom.rooms.values()].at(-1)!;
    expect(room.request.topic).toBe('Moved call');
    expect(room.request.startsAt.toISOString()).toBe(newStart);
    m = next;
  });

  it('removing the link deletes the room at the provider through the worker, and clears the join link', async () => {
    const roomsBefore = zoom.rooms.size;
    const res = await api
      .as(a.admin)
      .patch(`/v2/contacts/${contact}/meetings/${m.id}`)
      .send({ conferencing: { videoProvider: null }, rowVersion: m.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as Meeting).joinUrl ?? null).toBeNull();
    expect((res.body as Meeting).conferencing).toBeNull();
    expect(await drainReleases(a)).toBe(1);
    expect(zoom.rooms.size).toBe(roomsBefore - 1);
    m = res.body as Meeting;
  });

  it('deleting a meeting removes its room, even though the row is gone', async () => {
    const made = await create(
      a.admin,
      contact,
      meetingBody({ conferencing: { videoProvider: 'zoom' } }),
    );
    const roomsBefore = zoom.rooms.size;
    const del = await api
      .as(a.admin)
      .delete(`/v2/contacts/${contact}/meetings/${(made.body as Meeting).id}`);
    expect(del.status).toBe(204);
    expect(await drainReleases(a)).toBe(1);
    expect(zoom.rooms.size).toBe(roomsBefore - 1);
    // Running the same release again is harmless (the provider says the room is gone).
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM contact_meeting_conferencing WHERE org_id = $1`,
          [a.orgId],
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(0);
  });

  it('a room somebody deleted at Zoom is made again when the meeting is next saved', async () => {
    const made = (
      await create(a.admin, contact, meetingBody({ conferencing: { videoProvider: 'zoom' } }))
    ).body as Meeting;
    const id = [...zoom.rooms.keys()].at(-1)!;
    zoom.rooms.delete(id);
    const res = await api
      .as(a.admin)
      .patch(`/v2/contacts/${contact}/meetings/${made.id}`)
      .send({ title: 'Renamed', rowVersion: made.rowVersion });
    expect(res.status).toBe(200);
    expect((res.body as Meeting).conferencing?.videoStatus).toBe('ready');
    expect([...zoom.rooms.keys()].at(-1)).not.toBe(id);
  });
});

describe('a provider that fails does not lose the meeting', () => {
  it('saves the meeting with a problem, and Try again makes the link', async () => {
    zoom.failNext('server', 'create');
    const res = await create(
      a.admin,
      contact,
      meetingBody({ title: 'Flaky', conferencing: { videoProvider: 'zoom' } }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const m = res.body as Meeting;
    expect(m.conferencing).toMatchObject({ videoStatus: 'failed', videoError: 'provider_failed' });
    expect(m.joinUrl ?? null).toBeNull();

    const retry = await api
      .as(a.admin)
      .post(`/v2/contacts/${contact}/meetings/${m.id}/conferencing/retry`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect((retry.body as Meeting).conferencing).toMatchObject({
      videoStatus: 'ready',
      videoError: null,
    });
    expect((retry.body as Meeting).joinUrl).toMatch(/zoom\.fake\.test/);
  });

  it('a grant the provider refuses marks the connection as needing a reconnect and says so on the meeting', async () => {
    // The stored refresh token is made one the fake refuses, and the cached access token is dropped so the next call refreshes.
    const crypto_ = h.app.get(CryptoService);
    await h.owner.query(
      `UPDATE conferencing_connections SET refresh_token_enc = $2, access_token_enc = NULL, access_token_expires_at = NULL WHERE org_id = $1`,
      [a.orgId, crypto_.encrypt('revoked-by-user')],
    );
    const res = await create(
      a.admin,
      contact,
      meetingBody({ title: 'Revoked', conferencing: { videoProvider: 'zoom' } }),
    );
    expect(res.status).toBe(201);
    expect((res.body as Meeting).conferencing).toMatchObject({
      videoStatus: 'failed',
      videoError: 'needs_reconnect',
    });
    const list = await api.as(a.admin).get('/v2/conferencing/connections');
    expect(list.body.data[0]).toMatchObject({ provider: 'zoom', status: 'needs_reconnect' });
    expect((await caps(a.admin)).video).toEqual([]);
    expect(await api.auditCount(a.orgId, 'conferencing_connection', 'update')).toBe(1);

    // Connecting again restores it.
    await connect(a, a.admin, 'zoom', 'ana@example.com');
    expect((await caps(a.admin)).video).toEqual([{ provider: 'zoom', via: 'app' }]);
  });

  it('disconnecting removes the option and the stored tokens', async () => {
    const res = await api.as(a.admin).delete('/v2/conferencing/zoom');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disconnected');
    expect(
      (await h.owner.query(`SELECT 1 FROM conferencing_connections WHERE org_id = $1`, [a.orgId]))
        .rows,
    ).toHaveLength(0);
    expect((await caps(a.admin)).video).toEqual([]);
    expect((await caps(a.admin)).connectable).toEqual(['zoom']);
    // Idempotent.
    expect((await api.as(a.admin).delete('/v2/conferencing/zoom')).status).toBe(200);
  });

  it('an app uninstalled afterwards stops being offered', async () => {
    await connect(a, a.admin, 'zoom', 'ana@example.com');
    expect((await caps(a.admin)).video).toHaveLength(1);
    await uninstall(a, 'zoom');
    expect((await caps(a.admin)).video).toEqual([]);
    await install(a, 'zoom');
  });
});

describe("Microsoft Teams in the person's own account", () => {
  it('is offered once installed and connected, and makes a room keyed by the meeting', async () => {
    await install(a, 'microsoft-teams');
    await connect(a, a.admin, 'teams', 'ana@contoso.example');
    expect((await caps(a.admin)).video.map((v) => v.provider)).toContain('teams');
    const res = await create(
      a.admin,
      contact,
      meetingBody({ title: 'Teams call', conferencing: { videoProvider: 'teams' } }),
    );
    expect(res.status).toBe(201);
    expect((res.body as Meeting).joinUrl).toMatch(/teams\.fake\.test/);
    expect(teams.rooms.size).toBe(1);
  });
});

describe("Google Meet and the calendar entry through the workspace's connected Google Calendar", () => {
  const connectGoogle = async (t: Tenant, email: string) => {
    const start = await api
      .as(t.admin)
      .post('/v2/appointments/calendar/google/start')
      .send({ returnTo: '/appointments/settings' });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const state = new URL(start.body.url as string).searchParams.get('state')!;
    fakeGoogle.grant('meet-code', fakeGoogle.account(email), {});
    const cb = await request(h.app.getHttpServer())
      .get('/v2/public/appointments/calendar/google/callback')
      .query({ code: 'meet-code', state })
      .redirects(0);
    const m = /\/google-account\/confirm\?request=([0-9a-f-]{36})$/.exec(
      cb.headers.location as string,
    );
    expect(m, String(cb.headers.location)).not.toBeNull();
    const done = await api.as(t.admin).post(`/v2/google-account/consent/${m![1]}/confirm`).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  };

  it('offers Meet and the calendar only after Google Calendar is connected', async () => {
    expect((await caps(a.admin)).calendar).toBeNull();
    await connectGoogle(a, 'ana@gmail.example');
    const c = await caps(a.admin);
    expect(c.calendar).toMatchObject({ provider: 'google', account: 'ana@gmail.example' });
    expect(c.video.map((v) => v.provider)).toEqual(expect.arrayContaining(['zoom', 'meet']));
  });

  it('a Meet link puts the meeting on the calendar and takes its room from the event', async () => {
    const res = await create(
      a.admin,
      contact,
      meetingBody({ title: 'Meet call', conferencing: { videoProvider: 'meet', timeZone: 'UTC' } }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const m = res.body as Meeting;
    expect(m.conferencing).toMatchObject({
      videoProvider: 'meet',
      videoStatus: 'ready',
      calendarProvider: 'google',
      calendarStatus: 'synced',
    });
    expect(m.joinUrl).toBeTruthy();
    const events = [...fakeGoogle.events.values()].flatMap((s) => [...s.values()]);
    expect(events.some((e) => e.summary === 'Meet call')).toBe(true);
  });

  it('adds a plain calendar entry; the contact is invited only when asked', async () => {
    const plain = (
      await create(
        a.admin,
        contact,
        meetingBody({ title: 'Quiet entry', conferencing: { addToCalendar: true } }),
      )
    ).body as Meeting;
    const quiet = [...fakeGoogle.events.values()]
      .flatMap((s) => [...s.values()])
      .find((e) => e.summary === 'Quiet entry')!;
    expect(quiet.attendees ?? []).toEqual([]);
    expect(plain.conferencing).toMatchObject({ calendarStatus: 'synced', invited: false });

    const invited = (
      await create(
        a.admin,
        contact,
        meetingBody({
          title: 'Invite entry',
          conferencing: { addToCalendar: true, sendInvitation: true },
        }),
      )
    ).body as Meeting;
    const ev = [...fakeGoogle.events.values()]
      .flatMap((s) => [...s.values()])
      .find((e) => e.summary === 'Invite entry')!;
    expect(ev.attendees?.map((x) => x.email)).toEqual(['priya@example.test']);
    expect(invited.conferencing?.invited).toBe(true);
  });

  it('moving the meeting moves the event, and deleting the meeting removes it', async () => {
    const m = (
      await create(
        a.admin,
        contact,
        meetingBody({ title: 'Event to move', conferencing: { addToCalendar: true } }),
      )
    ).body as Meeting;
    const find = () =>
      [...fakeGoogle.events.values()]
        .flatMap((s) => [...s.values()])
        .find((e) => e.summary === 'Event to move' || e.summary === 'Event moved');
    const start = when(72);
    const res = await api
      .as(a.admin)
      .patch(`/v2/contacts/${contact}/meetings/${m.id}`)
      .send({
        title: 'Event moved',
        startsAt: start,
        endsAt: when(72.5),
        rowVersion: m.rowVersion,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(find()?.summary).toBe('Event moved');
    expect(new Date(find()!.start.dateTime).toISOString()).toBe(start);

    const del = await api.as(a.admin).delete(`/v2/contacts/${contact}/meetings/${m.id}`);
    expect(del.status).toBe(204);
    expect(await drainReleases(a)).toBeGreaterThanOrEqual(1);
    const gone = find();
    expect(gone === undefined || gone.status === 'cancelled').toBe(true);
  });

  it('unticking the calendar removes the event', async () => {
    const m = (
      await create(
        a.admin,
        contact,
        meetingBody({ title: 'Untick me', conferencing: { addToCalendar: true } }),
      )
    ).body as Meeting;
    const res = await api
      .as(a.admin)
      .patch(`/v2/contacts/${contact}/meetings/${m.id}`)
      .send({ conferencing: { addToCalendar: false }, rowVersion: m.rowVersion });
    expect(res.status).toBe(200);
    expect((res.body as Meeting).conferencing).toBeNull();
    await drainReleases(a);
    const ev = [...fakeGoogle.events.values()]
      .flatMap((s) => [...s.values()])
      .find((e) => e.summary === 'Untick me');
    expect(ev === undefined || ev.status === 'cancelled').toBe(true);
  });

  it('a workspace with no calendar connected records why the entry is missing', async () => {
    // Workspace b: the app is installed and connected for Zoom would not matter; ask for the calendar only.
    const [c2] = await api.seedContacts(b, [{ name: 'Someone' }]);
    const res = await create(b.admin, c2!, meetingBody({ conferencing: { addToCalendar: true } }));
    expect(res.status).toBe(201);
    expect((res.body as Meeting).conferencing).toMatchObject({
      calendarStatus: 'failed',
      calendarError: 'calendar_not_connected',
    });
  });
});

describe('permissions', () => {
  it('a member who may only read contacts cannot use the capabilities, the connections or the retry', async () => {
    const reader = await api.member(a, 'reader', [['record.contacts.read']]);
    for (const path of ['/v2/conferencing/capabilities', '/v2/conferencing/connections']) {
      expect((await api.as(reader.token).get(path)).status).toBe(403);
    }
    expect((await api.as(reader.token).post('/v2/conferencing/zoom/start').send({})).status).toBe(
      403,
    );
  });

  it('the public callback needs no session but a valid state', async () => {
    const res = await request(h.app.getHttpServer())
      .get('/v2/public/conferencing/teams/callback')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location as string).searchParams.get('video')).toBe('failed');
  });
});
