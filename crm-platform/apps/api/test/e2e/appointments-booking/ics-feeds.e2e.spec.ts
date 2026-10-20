import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { IcsFeedsService } from '../../../src/modules/appointments-booking/ics-feeds.service';
import { AppointmentsApi, startHarness, type Harness, type Tenant } from './support';

/**
 * iCal calendars as a read-only busy source, and a person's bookings as a subscription (BL-035), through HTTP, the real service and the real
 * database. The "remote calendar" is a local HTTP server; nothing here talks to a real calendar provider.
 */
let h: Harness;
let api: AppointmentsApi;
let feeds: IcsFeedsService;
let remote: Server;
let base = '';
let a: Tenant;
let b: Tenant;
const saved: Record<string, string | undefined> = {};

/** What the remote server answers per path: status, body, headers. Changed by the tests. */
const pages = new Map<string, { status: number; body: string; headers?: Record<string, string> }>();
const hits: Array<{ path: string; ifNoneMatch: string | undefined }> = [];

const ics = (events: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'X-WR-CALNAME:Club timetable',
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** An instant `days` from now at 09:00 UTC, as an iCalendar UTC stamp. */
const inDays = (days: number, hour = 9) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return stamp(d.toISOString());
};

beforeAll(async () => {
  remote = createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push({ path, ifNoneMatch: req.headers['if-none-match'] as string | undefined });
    const page = pages.get(path);
    if (!page) {
      res.writeHead(404).end();
      return;
    }
    if (page.headers?.etag && req.headers['if-none-match'] === page.headers.etag) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(page.status, page.headers).end(page.body);
  });
  await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(remote.address() as AddressInfo).port}`;
  for (const k of ['ICS_FEED_ALLOW_PRIVATE_ADDRESSES', 'MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS'])
    saved[k] = process.env[k];
  // The remote calendar is on loopback; production never allows that (a test below proves it).
  process.env.ICS_FEED_ALLOW_PRIVATE_ADDRESSES = 'true';
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/appointments-booking/appointments-booking-worker.module'))
        .AppointmentsBookingWorkerModule,
    ],
  });
  api = new AppointmentsApi(h);
  feeds = h.app.get(IcsFeedsService);
  a = await api.signup('icsa');
  b = await api.signup('icsb');
}, 300_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await h?.stop();
  await new Promise<void>((resolve) => remote?.close(() => resolve()));
});

const list = async (t: Tenant) => {
  const res = await api.as(t.admin).get('/v2/appointments/calendar/ics-feeds');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as Array<Record<string, unknown>>;
};
const add = (t: Tenant, body: Record<string, unknown>) =>
  api.post(t.admin, '/v2/appointments/calendar/ics-feeds', body);
const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

// --- subscribing ------------------------------------------------------------------------------------------------------

describe('subscribing to a calendar', () => {
  let slotStart = '';
  let slotEnd = '';
  let typeId = '';

  beforeAll(async () => {
    const type = await api.type(a.admin, { name: 'Busy source', durationMinutes: 30 });
    typeId = type.id;
    const slots = await api.slots(a.admin, typeId);
    slotStart = slots[10]!.start;
    slotEnd = slots[10]!.end;
    pages.set('/club.ics', {
      status: 200,
      headers: { 'content-type': 'text/calendar', etag: '"v1"' },
      body: ics([
        ['UID:a', `DTSTART:${stamp(slotStart)}`, `DTEND:${stamp(slotEnd)}`, 'SUMMARY:Secret title'],
      ]),
    });
  });

  it('reads the address once, stores it sealed, never returns it, and closes the slots it covers', async () => {
    const before = (await api.slots(a.admin, typeId)).map((s) => s.start);
    expect(before).toContain(slotStart);
    const res = await add(a, {
      name: 'Club',
      url: `${base}/club.ics?token=SECRET123`,
      blockAllDay: true,
    });
    // The path is not known to the remote server: 404 is a refusal, nothing is saved.
    expect(res.status).toBe(422);
    expect(code(res)).toBe('APPT_ICS_FEED_UNREADABLE');
    expect(res.body.errors[0]).toMatchObject({ path: 'url', message: 'not_found' });
    expect(await list(a)).toHaveLength(0);

    pages.set('/club.ics?token=SECRET123', pages.get('/club.ics')!);
    const ok = await add(a, { name: 'Club', url: `${base}/club.ics?token=SECRET123` });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({
      name: 'Club',
      host: '127.0.0.1',
      isActive: true,
      status: 'ok',
      errorCode: null,
      calendarName: 'Club timetable',
      eventCount: 1,
      busyCount: 1,
    });
    // Neither the address nor the secret in it is anywhere in the answer.
    expect(JSON.stringify(ok.body)).not.toMatch(/SECRET123|club\.ics/);
    const row = (
      await h.owner.query(`SELECT * FROM calendar_ics_feeds WHERE org_id = $1`, [a.orgId])
    ).rows[0];
    expect(String(row.url_enc)).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toMatch(/SECRET123/);
    expect(row.url_host).toBe('127.0.0.1');

    const after = (await api.slots(a.admin, typeId)).map((s) => s.start);
    expect(after).not.toContain(slotStart);
    expect(after).toHaveLength(before.length - 1);
    // The audit row and the event name the feed, never the address.
    expect(await api.auditCount(a.orgId, 'calendar_ics_feed', 'insert')).toBe(1);
    const ev = await h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'calendar_ics_feed.created'`,
      [a.orgId],
    );
    expect(JSON.stringify(ev.rows)).not.toMatch(/SECRET123|club/);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'calendar_ics_feed'`,
      [a.orgId],
    );
    expect(JSON.stringify(audit.rows)).not.toMatch(/SECRET123|club\.ics/);
  });

  it('is invisible to another workspace, and needs the booking-settings capability', async () => {
    expect(await list(b)).toHaveLength(0);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM calendar_ics_busy WHERE org_id = $1`, [
          b.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
    const other = await api.type(b.admin, { name: 'Other' });
    const slots = (await api.slots(b.admin, other.id)).map((s) => s.start);
    expect(slots).toContain(slotStart);
    const agent = await api.member(a, 'agent', [
      ['record.appointments.read'],
      ['record.booking-types.read'],
    ]);
    expect((await api.as(agent.token).get('/v2/appointments/calendar/ics-feeds')).status).toBe(200);
    const denied = await api
      .as(agent.token)
      .post('/v2/appointments/calendar/ics-feeds')
      .send({ name: 'x', url: `${base}/club.ics` });
    expect(denied.status).toBe(403);
  });

  it('refuses the same address twice, an unusable address, an HTML page, and an address with a password in it', async () => {
    expect(code(await add(a, { name: 'Again', url: `${base}/club.ics?token=SECRET123` }))).toBe(
      'APPT_ICS_FEED_DUPLICATE',
    );
    for (const url of [
      'ftp://example.com/x.ics',
      'https://user:pass@example.com/x.ics',
      'not an address at all',
    ]) {
      const res = await add(a, { name: 'Bad', url });
      expect(res.status, url).toBe(422);
    }
    pages.set('/login.ics', {
      status: 200,
      body: '<html><body>Sign in to continue</body></html>',
      headers: { 'content-type': 'text/html' },
    });
    const html = await add(a, { name: 'Login page', url: `${base}/login.ics` });
    expect(code(html)).toBe('APPT_ICS_FEED_UNREADABLE');
    expect(html.body.errors[0].message).toBe('not_a_calendar');
    pages.set('/private.ics', { status: 403, body: '' });
    expect(
      (await add(a, { name: 'Private', url: `${base}/private.ics` })).body.errors[0].message,
    ).toBe('forbidden');
    pages.set('/broken.ics', { status: 503, body: '' });
    expect(
      (await add(a, { name: 'Broken', url: `${base}/broken.ics` })).body.errors[0].message,
    ).toBe('server_error');
    expect(await list(a)).toHaveLength(1);
  });

  it('follows a redirect, checking the next hop like the first', async () => {
    pages.set('/moved.ics', { status: 302, body: '', headers: { location: '/final.ics' } });
    pages.set('/final.ics', {
      status: 200,
      body: ics([['UID:z', `DTSTART:${inDays(20)}`, `DTEND:${inDays(20, 10)}`]]),
    });
    const res = await add(a, { name: 'Moved', url: `${base}/moved.ics` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.busyCount).toBe(1);
    pages.set('/loop.ics', { status: 302, body: '', headers: { location: '/loop.ics' } });
    expect((await add(a, { name: 'Loop', url: `${base}/loop.ics` })).body.errors[0].message).toBe(
      'redirect_loop',
    );
    // A hop to a private address is refused when private addresses are not allowed (the production setting).
    process.env.ICS_FEED_ALLOW_PRIVATE_ADDRESSES = 'false';
    pages.set('/lan.ics', {
      status: 302,
      body: '',
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    });
    const blocked = await add(a, { name: 'Metadata', url: `${base}/lan.ics` });
    process.env.ICS_FEED_ALLOW_PRIVATE_ADDRESSES = 'true';
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors[0].message).toBe('blocked_address');
  });

  it('a name and an address are required, and the list is capped at ten', async () => {
    expect((await add(a, { name: '', url: `${base}/club.ics` })).status).toBe(422);
    const current = (await list(a)).length;
    for (let i = current; i < 10; i += 1) {
      pages.set(`/n${i}.ics`, { status: 200, body: ics([]) });
      expect((await add(a, { name: `Feed ${i}`, url: `${base}/n${i}.ics` })).status).toBe(201);
    }
    pages.set('/eleven.ics', { status: 200, body: ics([]) });
    expect(code(await add(a, { name: 'Eleven', url: `${base}/eleven.ics` }))).toBe(
      'APPT_ICS_FEED_LIMIT',
    );
  });
});

// --- keeping a feed up to date ---------------------------------------------------------------------------------------

describe('reading a feed again', () => {
  let id = '';
  let feedRowId = 0;

  beforeAll(async () => {
    const c = await api.signup('icsc');
    pages.set('/live.ics', {
      status: 200,
      headers: { etag: '"one"' },
      body: ics([['UID:l', `DTSTART:${inDays(10)}`, `DTEND:${inDays(10, 10)}`]]),
    });
    const res = await add(c, { name: 'Live', url: `${base}/live.ics` });
    expect(res.status).toBe(201);
    id = res.body.id as string;
    feedRowId = Number(
      (await h.owner.query(`SELECT id FROM calendar_ics_feeds WHERE uuid = $1`, [id])).rows[0].id,
    );
    (globalThis as unknown as { c: Tenant }).c = c;
  });
  const tenantC = () => (globalThis as unknown as { c: Tenant }).c;
  const busyCount = async () =>
    (
      await h.owner.query(`SELECT count(*)::int AS n FROM calendar_ics_busy WHERE feed_id = $1`, [
        feedRowId,
      ])
    ).rows[0].n as number;

  it('asks with the validators it was given, and a 304 changes nothing', async () => {
    hits.length = 0;
    const row = await h.owner.query(`SELECT org_id FROM calendar_ics_feeds WHERE uuid = $1`, [id]);
    expect(await feeds.refresh(Number(row.rows[0].org_id), feedRowId)).toBe('not_modified');
    expect(hits.at(-1)).toMatchObject({ path: '/live.ics', ifNoneMatch: '"one"' });
    expect(await busyCount()).toBe(1);
  });

  it('a changed feed replaces its busy time as a whole', async () => {
    pages.set('/live.ics', {
      status: 200,
      headers: { etag: '"two"' },
      body: ics([
        ['UID:l', `DTSTART:${inDays(11)}`, `DTEND:${inDays(11, 10)}`],
        ['UID:m', `DTSTART:${inDays(12)}`, `DTEND:${inDays(12, 10)}`],
      ]),
    });
    const orgId = tenantC().orgId;
    expect(await feeds.refresh(orgId, feedRowId)).toBe('ok');
    expect(await busyCount()).toBe(2);
    const [feed] = await list(tenantC());
    expect(feed).toMatchObject({ status: 'ok', busyCount: 2, eventCount: 2 });
  });

  it('a failure is recorded with a back-off and keeps the last good busy time; the next good read clears it', async () => {
    const orgId = tenantC().orgId;
    pages.set('/live.ics', { status: 500, body: '' });
    expect(await feeds.refresh(orgId, feedRowId)).toBe('failed');
    const [feed] = await list(tenantC());
    expect(feed).toMatchObject({ status: 'error', errorCode: 'server_error' });
    expect(await busyCount()).toBe(2);
    const row = (
      await h.owner.query(
        `SELECT consecutive_failures, next_fetch_at FROM calendar_ics_feeds WHERE id = $1`,
        [feedRowId],
      )
    ).rows[0];
    expect(row.consecutive_failures).toBe(1);
    expect(new Date(row.next_fetch_at).getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
    pages.set('/live.ics', {
      status: 200,
      body: ics([['UID:l', `DTSTART:${inDays(11)}`, `DTEND:${inDays(11, 10)}`]]),
    });
    expect(await feeds.refresh(orgId, feedRowId)).toBe('ok');
    expect((await list(tenantC()))[0]).toMatchObject({ status: 'ok', errorCode: null });
    expect(await busyCount()).toBe(1);
  });

  it('the refresh is a monitoring write: it does not bump the row version an editor holds', async () => {
    const [feed] = await list(tenantC());
    const version = feed!.rowVersion as number;
    await feeds.refresh(tenantC().orgId, feedRowId);
    expect((await list(tenantC()))[0]!.rowVersion).toBe(version);
    const edit = await api
      .as(tenantC().admin)
      .patch(`/v2/appointments/calendar/ics-feeds/${id}`)
      .send({ name: 'Renamed', rowVersion: version });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.name).toBe('Renamed');
    const stale = await api
      .as(tenantC().admin)
      .patch(`/v2/appointments/calendar/ics-feeds/${id}`)
      .send({ name: 'Again', rowVersion: version });
    expect(stale.status).toBe(409);
  });

  it('pausing frees its slots at once; resuming reads it again; deleting removes everything', async () => {
    const t = tenantC();
    const [feed] = await list(t);
    const paused = await api
      .as(t.admin)
      .patch(`/v2/appointments/calendar/ics-feeds/${id}`)
      .send({ isActive: false, rowVersion: feed!.rowVersion });
    expect(paused.body.isActive).toBe(false);
    // A paused feed contributes nothing to the slot engine.
    const { IcsBusySource } =
      await import('../../../src/modules/appointments-booking/ics-busy.source');
    const source = h.app.get(IcsBusySource);
    const window: [Date, Date] = [
      new Date(Date.now() + 10 * 86_400_000),
      new Date(Date.now() + 13 * 86_400_000),
    ];
    expect(await source.busy(t.orgId, ...window)).toHaveLength(0);
    const resumed = await api
      .as(t.admin)
      .patch(`/v2/appointments/calendar/ics-feeds/${id}`)
      .send({ isActive: true, rowVersion: paused.body.rowVersion });
    expect(resumed.body.isActive).toBe(true);
    expect(await source.busy(t.orgId, ...window)).toHaveLength(1);
    const gone = await api.as(t.admin).delete(`/v2/appointments/calendar/ics-feeds/${id}`);
    expect(gone.status).toBe(204);
    expect(await source.busy(t.orgId, ...window)).toHaveLength(0);
    expect(await busyCount()).toBe(0);
    expect((await api.as(t.admin).delete(`/v2/appointments/calendar/ics-feeds/${id}`)).status).toBe(
      404,
    );
  });

  it('a feed not read successfully for a week contributes nothing', async () => {
    const t = tenantC();
    pages.set('/old.ics', {
      status: 200,
      body: ics([['UID:o', `DTSTART:${inDays(30)}`, `DTEND:${inDays(30, 10)}`]]),
    });
    const res = await add(t, { name: 'Old', url: `${base}/old.ics` });
    expect(res.status).toBe(201);
    await h.owner.query(
      `UPDATE calendar_ics_feeds SET last_success_at = now() - interval '8 days' WHERE uuid = $1`,
      [res.body.id],
    );
    const { IcsBusySource } =
      await import('../../../src/modules/appointments-booking/ics-busy.source');
    expect(
      await h.app
        .get(IcsBusySource)
        .busy(
          t.orgId,
          new Date(Date.now() + 29 * 86_400_000),
          new Date(Date.now() + 32 * 86_400_000),
        ),
    ).toHaveLength(0);
  });
});

// --- my bookings as a subscription -----------------------------------------------------------------------------------

describe('my bookings in my calendar app', () => {
  const feedUrl = (url: string) => new URL(url).pathname;

  it('has no link until I make one; making it returns a private link only I can read', async () => {
    const none = await api.as(a.admin).get('/v2/appointments/calendar/bookings-feed');
    expect(none.body).toEqual({ url: null, createdAt: null, lastUsedAt: null });
    const made = await api.post(a.admin, '/v2/appointments/calendar/bookings-feed');
    expect(made.status).toBe(200);
    expect(made.body.url).toMatch(/\/v2\/public\/appointments\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    const again = await api.as(a.admin).get('/v2/appointments/calendar/bookings-feed');
    expect(again.body.url).toBe(made.body.url);
    // Only the hash and a sealed copy are stored.
    const row = (
      await h.owner.query(`SELECT * FROM appointment_feed_tokens WHERE org_id = $1`, [a.orgId])
    ).rows[0];
    expect(String(row.token_enc)).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain(
      String(made.body.url).split('/').pop()!.replace('.ics', ''),
    );
    expect(await api.auditCount(a.orgId, 'appointment_feed', 'insert')).toBe(1);
    // Someone else does not see it.
    expect(
      (await api.as(b.admin).get('/v2/appointments/calendar/bookings-feed')).body.url,
    ).toBeNull();
  });

  it('serves the bookings as a calendar with titles, times and places, and no contact detail', async () => {
    const type = await api.type(a.admin, {
      name: 'Consult',
      durationMinutes: 30,
      locationType: 'address',
      locationValue: '12 High Street',
    });
    const slots = await api.slots(a.admin, type.id);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[3]!.start,
      invitee: { name: 'Ana Rao', phone: '+919800000777', email: 'ana.feed@example.com' },
      notes: 'Allergic to latex',
    });
    const link = (await api.as(a.admin).get('/v2/appointments/calendar/bookings-feed')).body
      .url as string;
    const res = await request(h.app.getHttpServer())
      .get(feedUrl(link))
      .set('x-forwarded-for', '10.99.0.1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.headers['cache-control']).toMatch(/private/);
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const text = res.text;
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain(`UID:${appt.id}@appointments`);
    expect(text).toContain('SUMMARY:');
    expect(text).not.toMatch(/METHOD:/);
    for (const secret of ['+919800000777', 'ana.feed@example.com', 'latex', 'manage']) {
      expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    // A cancelled booking leaves the feed.
    await api.post(a.admin, `/v2/appointments/${appt.id}/cancel`, {});
    const after = await request(h.app.getHttpServer())
      .get(feedUrl(link))
      .set('x-forwarded-for', '10.99.0.2');
    expect(after.text).not.toContain(appt.id);
    // The link records its use.
    await new Promise((r) => setTimeout(r, 300));
    expect(
      (await api.as(a.admin).get('/v2/appointments/calendar/bookings-feed')).body.lastUsedAt,
    ).not.toBeNull();
  });

  it('shows a person only what their record scope shows, decided when it is read', async () => {
    const type = await api.type(a.admin, { name: 'Scoped', durationMinutes: 30 });
    const slots = await api.slots(a.admin, type.id);
    const agent = await api.member(a, 'scoped', [
      ['record.appointments.read', 'own'],
      ['record.booking-types.read'],
    ]);
    const theirs = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[5]!.start,
      invitee: { name: 'Admin booked', phone: '+919800000811' },
    });
    const link = await api.as(agent.token).post('/v2/appointments/calendar/bookings-feed').send({});
    expect(link.status).toBe(200);
    const mine = await request(h.app.getHttpServer())
      .get(feedUrl(link.body.url))
      .set('x-forwarded-for', '10.99.0.3');
    expect(mine.text).not.toContain(theirs.id);
    // The admin's feed (scope all) has it.
    const adminLink = (await api.as(a.admin).get('/v2/appointments/calendar/bookings-feed')).body
      .url as string;
    expect(
      (
        await request(h.app.getHttpServer())
          .get(feedUrl(adminLink))
          .set('x-forwarded-for', '10.99.0.4')
      ).text,
    ).toContain(theirs.id);
    // Losing the capability empties the feed under the same link.
    await h.owner.query(
      `DELETE FROM role_grants WHERE org_id = $1 AND permission_key = 'record.appointments.read' AND role_id IN (SELECT role_id FROM user_roles WHERE org_id = $1 AND user_id = $2)`,
      [a.orgId, agent.userId],
    );
    await h.app
      .get((await import('../../../src/kernel/rbac/rbac.service')).RbacService)
      .bumpRolesVersion(a.orgId);
    const lost = await request(h.app.getHttpServer())
      .get(feedUrl(link.body.url))
      .set('x-forwarded-for', '10.99.0.5');
    expect(lost.status).toBe(200);
    expect(lost.text).not.toContain('BEGIN:VEVENT');
    // A deactivated person's link is the same 404 as an unknown one.
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE org_id = $1 AND id = $2`, [
      a.orgId,
      agent.userId,
    ]);
    expect(
      (
        await request(h.app.getHttpServer())
          .get(feedUrl(link.body.url))
          .set('x-forwarded-for', '10.99.0.6')
      ).status,
    ).toBe(404);
  });

  it('a new link replaces the old at once; stopping ends it; a malformed or unknown link is a plain 404', async () => {
    const old = (await api.as(a.admin).get('/v2/appointments/calendar/bookings-feed')).body
      .url as string;
    const fresh = (await api.post(a.admin, '/v2/appointments/calendar/bookings-feed')).body
      .url as string;
    expect(fresh).not.toBe(old);
    expect(
      (await request(h.app.getHttpServer()).get(feedUrl(old)).set('x-forwarded-for', '10.99.1.1'))
        .status,
    ).toBe(404);
    expect(
      (await request(h.app.getHttpServer()).get(feedUrl(fresh)).set('x-forwarded-for', '10.99.1.2'))
        .status,
    ).toBe(200);
    expect(await api.auditCount(a.orgId, 'appointment_feed', 'update')).toBe(1);
    for (const bad of [
      'short.ics',
      `${'A'.repeat(43)}`,
      `${'A'.repeat(43)}.ics`,
      `${'A'.repeat(44)}.ics`,
    ]) {
      expect(
        (
          await request(h.app.getHttpServer())
            .get(`/v2/public/appointments/feed/${bad}`)
            .set('x-forwarded-for', '10.99.1.3')
        ).status,
        bad,
      ).toBe(404);
    }
    expect((await api.as(a.admin).delete('/v2/appointments/calendar/bookings-feed')).status).toBe(
      204,
    );
    expect(
      (await request(h.app.getHttpServer()).get(feedUrl(fresh)).set('x-forwarded-for', '10.99.1.4'))
        .status,
    ).toBe(404);
    expect(
      (await api.as(a.admin).get('/v2/appointments/calendar/bookings-feed')).body.url,
    ).toBeNull();
    // The token is in no event and no audit row.
    const token = fresh.split('/').pop()!.replace('.ics', '');
    const leaks = await h.owner.query(
      `SELECT 1 FROM event_outbox WHERE org_id = $1 AND payload::text LIKE $2 UNION ALL SELECT 1 FROM audit_log WHERE org_id = $1 AND delta::text LIKE $2`,
      [a.orgId, `%${token}%`],
    );
    expect(leaks.rows).toHaveLength(0);
  });

  it('is throttled per link', async () => {
    const link = (await api.post(a.admin, '/v2/appointments/calendar/bookings-feed')).body
      .url as string;
    let last = 200;
    for (let i = 0; i < 40 && last === 200; i += 1) {
      last = (
        await request(h.app.getHttpServer())
          .get(feedUrl(link))
          .set('x-forwarded-for', `10.98.${i}.1`)
      ).status;
    }
    expect(last).toBe(429);
  });
});
