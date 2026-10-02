import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AppointmentsApi,
  freshIp,
  nextSpringForward,
  startHarness,
  uuidRe,
  type Appointment,
  type BookingType,
  type Harness,
  type Tenant,
} from './support';

/**
 * Appointments and booking end to end through HTTP (TW-APPT-001..040, EXT-APPT-01..07): the plan gate and permissions, booking types,
 * the slot engine as the API shows it (buffers, notice, overrides, daylight saving), staff appointments with the status machine, the
 * customer's public booking page and manage link, approval and payment, the monthly cap, double booking under parallel requests, and
 * the audit and outbox rows every write must have. One app, one database; each block works in organizations of its own.
 */
let h: Harness;
let api: AppointmentsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new AppointmentsApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;
const DAY = 86_400_000;

describe('plan gate and permissions (TW-APPT-001, D-01, D-02)', () => {
  let t: Tenant;
  let type: BookingType;
  beforeAll(async () => {
    t = await api.signup('apg');
    type = await api.type(t.admin);
  });

  it('TW-APPT-001 #1: a workspace whose plan lacks appointment booking is refused with 422 PLAN_FEATURE_LOCKED on every staff route, reads included, and its public page says "not available"', async () => {
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"appointment_booking":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      for (const path of [
        '/v2/booking-types',
        '/v2/booking-types/options',
        `/v2/booking-types/${type.id}`,
        '/v2/appointments',
        '/v2/appointments/counts',
        '/v2/appointments/calendar',
      ]) {
        const res = await api.as(t.admin).get(path);
        expect(res.status, path).toBe(422);
        expect(code(res), path).toBe('PLAN_FEATURE_LOCKED');
      }
      expect(
        (await api.post(t.admin, '/v2/booking-types', { name: 'x', durationMinutes: 30 })).status,
      ).toBe(422);
      const pub = await api
        .http()
        .get(`/v2/public/booking/${t.slug}/${type.slug}`)
        .set('x-forwarded-for', freshIp());
      expect(pub.status).toBe(409);
      expect(code(pub)).toBe('APPT_BOOKING_UNAVAILABLE');
      expect(JSON.stringify(pub.body)).not.toMatch(/upgrade|plans/i);
    } finally {
      await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
    expect((await api.as(t.admin).get('/v2/booking-types')).status).toBe(200);
  });

  it('staff routes need a token; the public routes need none', async () => {
    expect((await api.http().get('/v2/booking-types')).status).toBe(401);
    expect((await api.http().get('/v2/appointments')).status).toBe(401);
    expect(
      (await api.http().get(`/v2/public/booking/${t.slug}`).set('x-forwarded-for', freshIp()))
        .status,
    ).toBe(200);
  });

  it('D-02: a viewer reads types and appointments but cannot create, edit, move, cancel, pay or delete', async () => {
    const viewer = await api.member(t, 'apviewer', [
      ['record.booking-types.read'],
      ['record.appointments.read'],
    ]);
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'V', phone: '+919811100001' },
    });
    expect((await api.as(viewer.token).get('/v2/booking-types')).status).toBe(200);
    expect((await api.as(viewer.token).get(`/v2/booking-types/${type.id}/slots`)).status).toBe(200);
    expect((await api.as(viewer.token).get('/v2/appointments')).status).toBe(200);
    expect((await api.as(viewer.token).get(`/v2/appointments/${a.id}`)).status).toBe(200);
    const refused = [
      api.post(viewer.token, '/v2/booking-types', { name: 'x', durationMinutes: 30 }),
      api
        .as(viewer.token)
        .patch(`/v2/booking-types/${type.id}`)
        .send({ name: 'x', rowVersion: type.rowVersion }),
      api.as(viewer.token).delete(`/v2/booking-types/${type.id}`),
      api
        .as(viewer.token)
        .put(`/v2/booking-types/${type.id}/overrides/2030-01-01`)
        .send({ isClosed: true }),
      api.post(viewer.token, '/v2/appointments', {
        bookingTypeId: type.id,
        startsAt: slots[1]!.start,
        invitee: { name: 'x', phone: '+919811100002' },
      }),
      api.post(viewer.token, `/v2/appointments/${a.id}/cancel`, {}),
      api.post(viewer.token, `/v2/appointments/${a.id}/reschedule`, { startsAt: slots[1]!.start }),
      api.post(viewer.token, `/v2/appointments/${a.id}/payments`, { amount: '1' }),
      api
        .as(viewer.token)
        .patch(`/v2/appointments/${a.id}`)
        .send({ notes: 'x', rowVersion: a.rowVersion }),
      api.as(viewer.token).delete(`/v2/appointments/${a.id}`),
    ];
    for (const res of await Promise.all(refused)) expect(res.status).toBe(403);
  });

  it('D-02: with scope `own` an agent sees and changes only the appointments they host or booked; another one is 404, not 403', async () => {
    const agent = await api.member(t, 'apagent', [
      ['record.booking-types.read'],
      ['record.appointments.read', 'own'],
      ['record.appointments.create'],
      ['record.appointments.update', 'own'],
      ['record.contacts.read'],
    ]);
    const slots = await api.slots(t.admin, type.id);
    const others = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'Admin booked', phone: '+919811100010' },
    });
    const mine = await api.staffBook(agent.token, {
      bookingTypeId: type.id,
      startsAt: slots[5]!.start,
      invitee: { name: 'Agent booked', phone: '+919811100011' },
    });
    expect((await api.as(agent.token).get(`/v2/appointments/${others.id}`)).status).toBe(404);
    expect((await api.post(agent.token, `/v2/appointments/${others.id}/cancel`, {})).status).toBe(
      404,
    );
    expect((await api.as(agent.token).get(`/v2/appointments/${mine.id}`)).status).toBe(200);
    const list = await api.as(agent.token).get('/v2/appointments?limit=200');
    const ids = (list.body.data as Appointment[]).map((x) => x.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(others.id);
    const counts = await api.as(agent.token).get('/v2/appointments/counts');
    expect(counts.body.total).toBe(1);
    expect((await api.post(agent.token, `/v2/appointments/${mine.id}/cancel`, {})).status).toBe(
      200,
    );
  });

  it('a type or an appointment of another workspace is 404, and cannot be booked into', async () => {
    const other = await api.signup('apx');
    const theirs = await api.type(other.admin);
    expect((await api.as(t.admin).get(`/v2/booking-types/${theirs.id}`)).status).toBe(404);
    const slots = await api.slots(other.admin, theirs.id);
    const res = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: theirs.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'x', phone: '+919811100020' },
    });
    expect(res.status).toBe(404);
    const their = await api.staffBook(other.admin, {
      bookingTypeId: theirs.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'y', phone: '+919811100021' },
    });
    expect((await api.as(t.admin).get(`/v2/appointments/${their.id}`)).status).toBe(404);
    // And their public page is reachable only through their own slug.
    const res2 = await api
      .http()
      .get(`/v2/public/booking/${t.slug}/${theirs.slug}`)
      .set('x-forwarded-for', freshIp());
    expect(res2.status).toBe(404);
  });
});

describe('booking types (TW-APPT-005..015)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('abt');
  });

  it('TW-APPT-006 #1: creates a type with its hours, questions, reminders, messages, price and calendar target in one body', async () => {
    const type = await api.type(t.admin, {
      name: 'Consultation',
      description: 'A first call',
      locationType: 'virtual',
      locationValue: 'https://meet.example/x',
      color: '#075E54',
      durationMinutes: 45,
      incrementMinutes: 15,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 5,
      capacity: 2,
      maxPerDay: 6,
      availability: [
        { weekday: 1, from: '09:00', to: '12:00' },
        { weekday: 1, from: '14:00', to: '17:00' },
      ],
      overrides: [{ date: '2030-12-25', isClosed: true, reason: 'Holiday' }],
      questions: [
        { label: 'Company', type: 'text', required: true, mapToContactField: 'name' },
        { label: 'Plan', type: 'select', options: ['Basic', 'Pro'], required: false },
      ],
      reminders: [{ offsetMinutes: 1440, label: '24h' }, { offsetMinutes: 180 }],
      templates: [
        { event: 'reminder', channel: 'whatsapp', plainBody: 'See you {{slot}}' },
        { event: 'confirmation', channel: 'email', plainBody: 'Booked {{slot}}' },
      ],
      payment: {
        currency: 'USD',
        fee: '100.00',
        taxPercent: '10',
        depositMode: 'partial',
        deposit: '30.00',
        gatewaySlug: 'stripe',
        cancelFee: '5.00',
        cancelWindowMinutes: 120,
      },
      calendar: { calendarId: 'team@example.com', spreadsheetId: 'sheet1' },
    });
    expect(type).toMatchObject({
      name: 'Consultation',
      slug: 'consultation',
      locationType: 'virtual',
      color: '#075E54',
      durationMinutes: 45,
      incrementMinutes: 15,
      capacity: 2,
      isActive: true,
      approvalRequired: false,
      publicPath: `/book/${t.slug}/consultation`,
      effectiveTimezone: 'UTC',
    });
    expect(type.id).toMatch(uuidRe);
    expect(type.host?.id).toMatch(uuidRe);
    expect(type.availability).toEqual([
      { weekday: 1, from: '09:00', to: '12:00' },
      { weekday: 1, from: '14:00', to: '17:00' },
    ]);
    expect(type.overrides).toEqual([
      { date: '2030-12-25', isClosed: true, from: null, to: null, reason: 'Holiday' },
    ]);
    expect(type.questions.map((q) => q.label)).toEqual(['Company', 'Plan']);
    expect(type.reminders.map((r) => r.offsetMinutes)).toEqual([1440, 180]);
    expect(type.payment).toMatchObject({
      currency: 'USD',
      fee: '100.00',
      total: '110.00',
      dueNow: '30.00',
      depositMode: 'partial',
    });
    expect(type.calendar).toMatchObject({ calendarId: 'team@example.com', createMeet: true });
    expect(type.templates).toHaveLength(2);
    const got = await api.as(t.admin).get(`/v2/booking-types/${type.id}`);
    expect(got.body).toEqual(type);
  });

  it('TW-APPT-006 #2: the slug is made unique with a numeric suffix, as Reference did', async () => {
    const a = await api.type(t.admin, { name: 'Same Name' });
    const b = await api.type(t.admin, { name: 'Same Name' });
    const c = await api.type(t.admin, { name: 'Same Name' });
    expect([a.slug, b.slug, c.slug]).toEqual(['same-name', 'same-name-2', 'same-name-3']);
  });

  it('TW-APPT-006 #3 / D-11: validation is 422 with a path: ranges, an unknown zone, overlapping hours, duplicate reminders, money with too many decimals, a partial deposit above the price', async () => {
    const bad = async (body: Record<string, unknown>) => {
      const res = await api.post(t.admin, '/v2/booking-types', {
        name: 'Bad',
        durationMinutes: 30,
        ...body,
      });
      expect(res.status, JSON.stringify(body)).toBe(422);
      return res;
    };
    await bad({ durationMinutes: 4 });
    await bad({ timezone: 'Nowhere/Land' });
    await bad({
      availability: [
        { weekday: 1, from: '09:00', to: '12:00' },
        { weekday: 1, from: '11:00', to: '13:00' },
      ],
    });
    await bad({ reminders: [{ offsetMinutes: 60 }, { offsetMinutes: 60 }] });
    await bad({ questions: [{ label: 'Pick', type: 'select' }] });
    const decimals = await bad({ payment: { currency: 'JPY', fee: '10.50' } });
    expect(code(decimals)).toBe('APPT_AMOUNT_INVALID');
    const over = await bad({
      payment: { currency: 'USD', fee: '10.00', depositMode: 'partial', deposit: '50.00' },
    });
    expect(code(over)).toBe('APPT_AMOUNT_INVALID');
    const host = await bad({ hostId: crypto.randomUUID() });
    expect(code(host)).toBe('APPT_HOST_INVALID');
    const wa = await bad({ templates: [{ event: 'reminder', waTemplateId: crypto.randomUUID() }] });
    expect(JSON.stringify(wa.body)).toContain('WhatsApp template');
  });

  it('D-06: PATCH needs the row version (409 otherwise); a child list that is not sent is kept, so editing a name no longer wipes the date overrides', async () => {
    const type = await api.type(t.admin, {
      overrides: [{ date: '2030-12-25', isClosed: true }],
      questions: [{ label: 'Q1', type: 'text' }],
      reminders: [{ offsetMinutes: 60 }],
    });
    const stale = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${type.id}`)
      .send({ name: 'Renamed', rowVersion: type.rowVersion + 5 });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect(
      (await api.as(t.admin).patch(`/v2/booking-types/${type.id}`).send({ name: 'x' })).status,
    ).toBe(422);
    const ok = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${type.id}`)
      .send({ name: 'Renamed', rowVersion: type.rowVersion });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Renamed');
    expect(ok.body.rowVersion).toBe(type.rowVersion + 1);
    expect(ok.body.overrides).toEqual(type.overrides);
    expect(ok.body.questions).toEqual(type.questions);
    expect(ok.body.reminders).toEqual(type.reminders);
    expect(ok.body.slug).toBe(type.slug);
  });

  it('D-06: a child list that is sent replaces that list, and an item that carries its id keeps its row', async () => {
    const type = await api.type(t.admin, {
      questions: [
        { label: 'Keep me', type: 'text' },
        { label: 'Drop me', type: 'text' },
      ],
      reminders: [{ offsetMinutes: 60 }, { offsetMinutes: 120 }],
    });
    const keep = type.questions[0]!;
    const rem = type.reminders[0]!;
    const res = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${type.id}`)
      .send({
        rowVersion: type.rowVersion,
        questions: [
          { id: keep.id, label: 'Kept, renamed', type: 'textarea', required: false },
          { label: 'New one', type: 'text' },
        ],
        reminders: [{ id: rem.id, offsetMinutes: 90, isActive: false }],
        availability: [{ weekday: 2, from: '10:00', to: '11:00' }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      res.body.questions.map((q: { id: string; label: string }) => [q.id === keep.id, q.label]),
    ).toEqual([
      [true, 'Kept, renamed'],
      [false, 'New one'],
    ]);
    expect(res.body.reminders).toEqual([
      { id: rem.id, offsetMinutes: 90, label: null, isActive: false },
    ]);
    expect(res.body.availability).toEqual([{ weekday: 2, from: '10:00', to: '11:00' }]);
    const foreign = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${type.id}`)
      .send({
        rowVersion: res.body.rowVersion,
        questions: [{ id: crypto.randomUUID(), label: 'x', type: 'text' }],
      });
    expect(foreign.status).toBe(422);
  });

  it('D-03: add and remove one date without touching the rest; the list and the picker', async () => {
    const type = await api.type(t.admin, {
      name: 'Overrides',
      availability: [{ weekday: 1, from: '09:00', to: '10:00' }],
    });
    const put = await api
      .as(t.admin)
      .put(`/v2/booking-types/${type.id}/overrides/2031-01-06`)
      .send({ isClosed: false, from: '14:00', to: '15:00', reason: 'Late opening' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.overrides).toEqual([
      { date: '2031-01-06', isClosed: false, from: '14:00', to: '15:00', reason: 'Late opening' },
    ]);
    expect(put.body.availability).toEqual(type.availability);
    expect(
      (
        await api
          .as(t.admin)
          .put(`/v2/booking-types/${type.id}/overrides/2031-01-06`)
          .send({ isClosed: true, from: '09:00' })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .put(`/v2/booking-types/${type.id}/overrides/2031-02-30`)
          .send({ isClosed: true })
      ).status,
    ).toBe(422);
    const del = await api.as(t.admin).delete(`/v2/booking-types/${type.id}/overrides/2031-01-06`);
    expect(del.status).toBe(200);
    expect(del.body.overrides).toEqual([]);
    expect(
      (await api.as(t.admin).delete(`/v2/booking-types/${type.id}/overrides/2031-01-06`)).status,
    ).toBe(404);

    const options = await api.as(t.admin).get('/v2/booking-types/options');
    expect(options.status).toBe(200);
    expect(options.body.find((o: { id: string }) => o.id === type.id)).toEqual({
      id: type.id,
      name: 'Overrides',
      durationMinutes: 30,
      isActive: true,
    });
    const paused = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${type.id}`)
      .send({ isActive: false, rowVersion: del.body.rowVersion });
    expect(paused.body.isActive).toBe(false);
    const active = await api.as(t.admin).get('/v2/booking-types?active=false');
    expect(active.body.data.map((x: BookingType) => x.id)).toContain(type.id);
    expect(
      (await api.as(t.admin).get('/v2/booking-types?active=true')).body.data.map(
        (x: BookingType) => x.id,
      ),
    ).not.toContain(type.id);
    expect(
      (await api.as(t.admin).get('/v2/booking-types?q=overrid')).body.data.map(
        (x: BookingType) => x.id,
      ),
    ).toContain(type.id);
  });

  it('TW-APPT-016: the stateless preview runs the engine over an unsaved draft', async () => {
    const res = await api.post(t.admin, '/v2/booking-types/preview-slots', {
      draft: {
        durationMinutes: 60,
        incrementMinutes: 60,
        availability: [{ weekday: 1, from: '09:00', to: '12:00' }],
        timezone: 'Asia/Kolkata',
      },
      days: 14,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.timezone).toBe('Asia/Kolkata');
    expect(res.body.count).toBeGreaterThanOrEqual(3);
    const first = res.body.days[0].slots[0];
    expect(new Date(first.start).toISOString().slice(11, 16)).toBe('03:30'); // 09:00 Kolkata
    expect(
      (
        await api.post(t.admin, '/v2/booking-types/preview-slots', {
          draft: { durationMinutes: 60 },
          days: 15,
        })
      ).status,
    ).toBe(422);
  });

  it('D-10: a type with bookings still to come is not deleted (409); after they are cancelled it is, and the past bookings keep their snapshot', async () => {
    const type = await api.type(t.admin, { name: 'Deletable' });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'D', phone: '+919811100030' },
    });
    const refused = await api.as(t.admin).delete(`/v2/booking-types/${type.id}`);
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('BOOKING_TYPE_HAS_UPCOMING');
    expect((await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, {})).status).toBe(200);
    expect((await api.as(t.admin).delete(`/v2/booking-types/${type.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/booking-types/${type.id}`)).status).toBe(404);
    const kept = await api.appt(t.admin, a.id);
    expect(kept.bookingType).toBeNull();
    expect(kept.title).toContain('Deletable');
  });

  it('a capacity cut below the seats in use is refused', async () => {
    const type = await api.type(t.admin, { name: 'Group', capacity: 3 });
    const slots = await api.slots(t.admin, type.id);
    for (const phone of ['+919811100041', '+919811100042', '+919811100043']) {
      await api.staffBook(t.admin, {
        bookingTypeId: type.id,
        startsAt: slots[0]!.start,
        invitee: { name: phone, phone },
      });
    }
    const cut = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${type.id}`)
      .send({ capacity: 2, rowVersion: type.rowVersion });
    expect(cut.status).toBe(422);
    const grow = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${type.id}`)
      .send({ capacity: 5, rowVersion: type.rowVersion });
    expect(grow.status).toBe(200);
  });

  it('writes an audit row and an outbox event for every change, without the free text', async () => {
    const before = await api.auditCount(t.orgId, 'booking_types', 'insert');
    const type = await api.type(t.admin, { name: 'Audited' });
    expect(await api.auditCount(t.orgId, 'booking_types', 'insert')).toBe(before + 1);
    await api
      .as(t.admin)
      .patch(`/v2/booking-types/${type.id}`)
      .send({ name: 'Audited 2', rowVersion: type.rowVersion });
    expect(await api.auditCount(t.orgId, 'booking_types', 'update')).toBeGreaterThanOrEqual(1);
    const created = (await api.events(t.orgId, 'booking_type.created')).find(
      (e) => e.uuid === type.id,
    );
    expect(created).toMatchObject({ name: 'Audited', slug: type.slug });
    expect(
      (await api.events(t.orgId, 'booking_type.updated')).some((e) => e.uuid === type.id),
    ).toBe(true);
  });
});

describe('slots (TW-APPT-017..019, D-01, D-02)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('asl');
  });

  it('a type with no hours offers nothing; one with hours offers slots in the order of time, with their seats', async () => {
    const none = await api.type(t.admin, { availability: [] });
    expect(await api.slots(t.admin, none.id)).toEqual([]);
    const type = await api.type(t.admin);
    const slots = await api.slots(t.admin, type.id);
    expect(slots.length).toBeGreaterThan(20);
    expect(slots[0]!.remaining).toBe(1);
    expect(slots.map((s) => s.start)).toEqual([...slots.map((s) => s.start)].sort());
    for (const s of slots) expect(Date.parse(s.end) - Date.parse(s.start)).toBe(30 * 60_000);
  });

  it('the window: at most 62 days (422), a reversed range (422), local dates only', async () => {
    const type = await api.type(t.admin);
    expect(
      (
        await api
          .as(t.admin)
          .get(`/v2/booking-types/${type.id}/slots?from=2030-01-01&to=2030-04-01`)
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .get(`/v2/booking-types/${type.id}/slots?from=2030-02-01&to=2030-01-01`)
      ).status,
    ).toBe(422);
    expect(
      (await api.as(t.admin).get(`/v2/booking-types/${type.id}/slots?from=2030-1-1`)).status,
    ).toBe(422);
  });

  it('a booked slot disappears at once; buffers keep the neighbours away (the Reference rule); a cancelled one comes back', async () => {
    const type = await api.type(t.admin, { bufferBeforeMinutes: 30 });
    const slots = await api.slots(t.admin, type.id);
    const s = slots[10]!;
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: s.start,
      invitee: { name: 'B', phone: '+919811100050' },
    });
    const after = (await api.slots(t.admin, type.id)).map((x) => x.start);
    const at = Date.parse(s.start);
    expect(after).not.toContain(s.start);
    expect(after).not.toContain(new Date(at + 30 * 60_000).toISOString()); // inside bufferBefore of the next start
    expect(after).toContain(new Date(at + 60 * 60_000).toISOString());
    expect(after).toContain(new Date(at - 30 * 60_000).toISOString());
    expect((await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, {})).status).toBe(200);
    expect((await api.slots(t.admin, type.id)).map((x) => x.start)).toContain(s.start);
  });

  it('minimum notice and the booking horizon', async () => {
    const notice = await api.type(t.admin, { minNoticeMinutes: 2 * 24 * 60 });
    const first = (await api.slots(t.admin, notice.id))[0]!;
    expect(Date.parse(first.start)).toBeGreaterThanOrEqual(Date.now() + 2 * DAY - 60_000);
    const horizon = await api.type(t.admin, { maxAdvanceDays: 3 });
    const last = (await api.slots(t.admin, horizon.id)).at(-1)!;
    expect(Date.parse(last.start)).toBeLessThan(Date.now() + 3 * DAY + 60_000);
  });

  it('D-03: a closed date has no slots; special hours replace the weekly hours of that date', async () => {
    const type = await api.type(t.admin);
    const day = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
    const next = new Date(Date.now() + 6 * DAY).toISOString().slice(0, 10);
    await api
      .as(t.admin)
      .put(`/v2/booking-types/${type.id}/overrides/${day}`)
      .send({ isClosed: true });
    await api
      .as(t.admin)
      .put(`/v2/booking-types/${type.id}/overrides/${next}`)
      .send({ isClosed: false, from: '14:00', to: '15:00' });
    const slots = await api.slots(t.admin, type.id, `?from=${day}&to=${next}`);
    expect(slots.map((s) => s.start)).toEqual([`${next}T14:00:00.000Z`, `${next}T14:30:00.000Z`]);
  });

  it("D-01: daylight saving: 09:00 New York is 14:00 UTC before spring forward and 13:00 UTC after, and the zone's own date is used", async () => {
    const dst = nextSpringForward('America/New_York', Date.now());
    const type = await api.type(t.admin, {
      timezone: 'America/New_York',
      maxAdvanceDays: 365,
      availability: [],
    });
    for (const date of [dst.before, dst.day, dst.after]) {
      const r = await api
        .as(t.admin)
        .put(`/v2/booking-types/${type.id}/overrides/${date}`)
        .send({ isClosed: false, from: '09:00', to: '09:30' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const slots = await api.slots(t.admin, type.id, `?from=${dst.before}&to=${dst.after}`);
    expect(slots.map((s) => s.start)).toEqual([
      `${dst.before}T14:00:00.000Z`,
      `${dst.day}T13:00:00.000Z`,
      `${dst.after}T13:00:00.000Z`,
    ]);
    // The same booking, asked through the public page, is the same instant.
    const pub = await api.publicSlots(t.slug, type.slug, `?from=${dst.day}&to=${dst.day}`);
    expect(pub.map((s) => s.start)).toEqual([`${dst.day}T13:00:00.000Z`]);
  });
});

describe('staff appointments (TW-APPT-002..004, 039; EXT-APPT-02, 04, 06, 07)', () => {
  let t: Tenant;
  let type: BookingType;
  let slots: Array<{ start: string; end: string }>;
  beforeAll(async () => {
    t = await api.signup('asa');
    type = await api.type(t.admin, { name: 'Staff Demo' });
    slots = await api.slots(t.admin, type.id);
  });

  it("EXT-APPT-02: books for a customer: confirmed, a contact found or created by phone, a manage link, the type's host", async () => {
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'Ana Rao', phone: '+91 98111 00060', email: 'Ana@Example.com' },
      notes: 'Wants the early slot',
    });
    expect(a).toMatchObject({
      status: 'confirmed',
      source: 'manual',
      seat: 1,
      startsAt: slots[0]!.start,
      endsAt: slots[0]!.end,
      timezone: 'UTC',
      notes: 'Wants the early slot',
      invitee: { name: 'Ana Rao', phone: '+919811100060', email: 'ana@example.com' },
      payment: { status: 'none', total: '0.00' },
    });
    expect(a.title).toBe('Staff Demo — Ana Rao');
    expect(a.host?.id).toBe(type.host?.id);
    expect(a.contact?.id).toMatch(uuidRe);
    expect(a.manageUrl).toMatch(/\/b\/manage\/[A-Za-z0-9_-]{43}$/);
    const contact = await api.as(t.admin).get(`/v2/contacts/${a.contact!.id}`);
    expect(contact.body).toMatchObject({
      name: 'Ana Rao',
      phone: '+919811100060',
      email: 'ana@example.com',
    });
    // The same phone books again: the same contact, not a second one.
    const b = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[1]!.start,
      invitee: { name: 'Ana R.', phone: '+919811100060' },
    });
    expect(b.contact?.id).toBe(a.contact?.id);
    const linked = await api
      .as(t.admin)
      .get(`/v2/contacts/${a.contact!.id}/appointments?scope=all`);
    expect(linked.status).toBe(200);
    expect(linked.body.data.map((x: Appointment) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('TW-APPT-021 #2 / D-05: a taken seat is 409 APPT_SLOT_TAKEN; a time the type does not offer is 422 APPT_SLOT_UNAVAILABLE; staff may override the schedule but never a taken seat', async () => {
    const s = slots[3]!;
    await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: s.start,
      invitee: { name: 'First', phone: '+919811100061' },
    });
    const taken = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: type.id,
      startsAt: s.start,
      invitee: { name: 'Second', phone: '+919811100062' },
    });
    expect(taken.status).toBe(409);
    expect(code(taken)).toBe('APPT_SLOT_TAKEN');
    // Overlapping with a different start: Reference accepted this one.
    const overlap = new Date(Date.parse(s.start) + 10 * 60_000).toISOString();
    const odd = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: type.id,
      startsAt: overlap,
      ignoreAvailability: true,
      invitee: { name: 'Third', phone: '+919811100063' },
    });
    expect(odd.status).toBe(409);
    expect(code(odd)).toBe('APPT_SLOT_TAKEN');
    const off = new Date(Date.parse(slots[5]!.start) + 7 * 60_000).toISOString();
    const unavailable = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: type.id,
      startsAt: off,
      invitee: { name: 'Off', phone: '+919811100064' },
    });
    expect(unavailable.status).toBe(422);
    expect(code(unavailable)).toBe('APPT_SLOT_UNAVAILABLE');
    const forced = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: type.id,
      startsAt: off,
      ignoreAvailability: true,
      invitee: { name: 'Forced', phone: '+919811100064' },
    });
    expect(forced.status, JSON.stringify(forced.body)).toBe(201);
    const past = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: type.id,
      startsAt: new Date(Date.now() - 3 * DAY).toISOString(),
      invitee: { name: 'Past', phone: '+919811100065' },
    });
    expect(past.status).toBe(422);
  });

  it('validation: an invitee needs a name; a phone it cannot read is 422; an answer to a question of another service is 422', async () => {
    const start = slots[8]!.start;
    expect(
      (await api.post(t.admin, '/v2/appointments', { bookingTypeId: type.id, startsAt: start }))
        .status,
    ).toBe(422);
    expect(
      (
        await api.post(t.admin, '/v2/appointments', {
          bookingTypeId: type.id,
          startsAt: start,
          invitee: { name: 'N', phone: '123' },
        })
      ).status,
    ).toBe(422);
    const bad = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: type.id,
      startsAt: start,
      invitee: { name: 'N', phone: '+919811100066' },
      answers: { [crypto.randomUUID()]: 'x' },
    });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('APPT_ANSWERS_INVALID');
  });

  it('TW-APPT-033 / D-15: required answers are enforced, the answers are stored with their labels, and a mapped answer fills the invitee', async () => {
    const q = await api.type(t.admin, {
      name: 'With questions',
      questions: [
        { label: 'Your email', type: 'email', required: true, mapToContactField: 'email' },
        { label: 'Plan', type: 'select', options: ['Basic', 'Pro'], required: false },
      ],
    });
    const qs = q.questions;
    const s = (await api.slots(t.admin, q.id))[2]!.start;
    const missing = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: q.id,
      startsAt: s,
      invitee: { name: 'Q', phone: '+919811100070' },
    });
    expect(missing.status).toBe(422);
    expect(code(missing)).toBe('APPT_ANSWERS_INVALID');
    const wrong = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: q.id,
      startsAt: s,
      invitee: { name: 'Q', phone: '+919811100070' },
      answers: { [qs[0]!.id]: 'not-mail', [qs[1]!.id]: 'Gold' },
    });
    expect(wrong.body.errors.length).toBe(2);
    const ok = await api.staffBook(t.admin, {
      bookingTypeId: q.id,
      startsAt: s,
      invitee: { name: 'Q', phone: '+919811100070' },
      answers: { [qs[0]!.id]: 'q@example.com', [qs[1]!.id]: 'Pro' },
    });
    expect(ok.answers).toEqual([
      { questionId: qs[0]!.id, label: 'Your email', type: 'email', value: 'q@example.com' },
      { questionId: qs[1]!.id, label: 'Plan', type: 'select', value: 'Pro' },
    ]);
    // The mapped answer filled the invitee's email, which the invitee did not give.
    expect(ok.invitee.email).toBe('q@example.com');
  });

  it('D-04: the status machine: confirm needs pending, complete and no-show need a started confirmed booking, final statuses have no way out', async () => {
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[12]!.start,
      invitee: { name: 'M', phone: '+919811100080' },
    });
    const confirm = await api.post(t.admin, `/v2/appointments/${a.id}/confirm`, {});
    expect(confirm.status).toBe(409);
    expect(code(confirm)).toBe('APPT_INVALID_TRANSITION');
    expect(confirm.body.errors).toEqual([
      { path: 'from', message: 'confirmed' },
      { path: 'to', message: 'confirmed' },
    ]);
    const early = await api.post(t.admin, `/v2/appointments/${a.id}/complete`, {});
    expect(early.status).toBe(409);
    expect(code(early)).toBe('APPT_NOT_STARTED');
    expect((await api.post(t.admin, `/v2/appointments/${a.id}/no-show`, {})).status).toBe(409);
    expect((await api.post(t.admin, `/v2/appointments/${a.id}/decline`, {})).status).toBe(409);
    // It starts (arranged straight in the table), is checked in, then completed.
    await api.moveTo(a.id, -2);
    const checked = await api.post(t.admin, `/v2/appointments/${a.id}/check-in`, {});
    expect(checked.status).toBe(200);
    expect(checked.body.checkedInAt).not.toBeNull();
    expect(
      (await api.post(t.admin, `/v2/appointments/${a.id}/check-in`, {})).body.checkedInAt,
    ).toBe(checked.body.checkedInAt);
    const done = await api.post(t.admin, `/v2/appointments/${a.id}/complete`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe('completed');
    for (const action of ['cancel', 'confirm', 'decline', 'complete', 'no-show', 'check-in']) {
      const res = await api.post(t.admin, `/v2/appointments/${a.id}/${action}`, {});
      expect(res.status, action).toBe(409);
      expect(code(res), action).toBe('APPT_INVALID_TRANSITION');
    }
    expect(
      (
        await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, {
          startsAt: slots[20]!.start,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/appointments/${a.id}`)
          .send({ notes: 'still editable', rowVersion: done.body.rowVersion })
      ).status,
    ).toBe(200);
  });

  it("a no-show records the type's no-show fee; staff cancel records none; both are only recorded", async () => {
    const paid = await api.type(t.admin, {
      name: 'Fees',
      payment: {
        currency: 'USD',
        fee: '50.00',
        noShowFee: '20.00',
        cancelFee: '10.00',
        cancelWindowMinutes: 100_000,
      },
    });
    const s = await api.slots(t.admin, paid.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: paid.id,
      startsAt: s[0]!.start,
      invitee: { name: 'F1', phone: '+919811100090' },
    });
    const b = await api.staffBook(t.admin, {
      bookingTypeId: paid.id,
      startsAt: s[3]!.start,
      invitee: { name: 'F2', phone: '+919811100091' },
    });
    await api.moveTo(a.id, -3);
    const ns = await api.post(t.admin, `/v2/appointments/${a.id}/no-show`, {});
    expect(ns.status).toBe(200);
    expect(ns.body.status).toBe('no_show');
    expect(ns.body.payment.feeRecorded).toBe('20.00');
    const cancelled = await api.post(t.admin, `/v2/appointments/${b.id}/cancel`, {
      reason: 'Customer called',
    });
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'staff',
      cancelReason: 'Customer called',
    });
    expect(cancelled.body.payment.feeRecorded).toBe('0.00');
  });

  it('TW-APPT-004 / D-05: reschedule validates the target like a booking, keeps the status and does not block itself; moving onto a taken slot is 409', async () => {
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[30]!.start,
      invitee: { name: 'R', phone: '+919811100100' },
    });
    await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[32]!.start,
      invitee: { name: 'R2', phone: '+919811100101' },
    });
    const onto = await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, {
      startsAt: slots[32]!.start,
    });
    expect(onto.status).toBe(409);
    expect(code(onto)).toBe('APPT_SLOT_TAKEN');
    const off = await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, {
      startsAt: new Date(Date.parse(slots[34]!.start) + 11 * 60_000).toISOString(),
    });
    expect(off.status).toBe(422);
    const next = await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, {
      startsAt: slots[31]!.start,
      notify: false,
    });
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect(next.body).toMatchObject({ status: 'confirmed', startsAt: slots[31]!.start });
    // The old slot is free again; the move was audited and announced.
    expect((await api.slots(t.admin, type.id)).map((s) => s.start)).toContain(slots[30]!.start);
    const ev = (await api.eventsOf(t.orgId, 'appointment.rescheduled', a.id))[0]!;
    expect(ev).toMatchObject({ previousStartsAt: slots[30]!.start, by: 'staff', notify: false });
    // The same time again is a no-op; a stale version is 409; a started booking cannot move.
    expect(
      (
        await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, {
          startsAt: slots[31]!.start,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, {
          startsAt: slots[35]!.start,
          rowVersion: 1,
        })
      ).status,
    ).toBe(409);
    await api.moveTo(a.id, -1);
    const started = await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, {
      startsAt: slots[36]!.start,
    });
    expect(started.status).toBe(409);
    expect(code(started)).toBe('APPT_ALREADY_STARTED');
  });

  it('PATCH: edits the fields, needs the row version, encrypts the notes at rest and keeps them out of the audit trail', async () => {
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[40]!.start,
      invitee: { name: 'E', phone: '+919811100110' },
    });
    const secret = 'Allergic to latex, call the clinic';
    const res = await api
      .as(t.admin)
      .patch(`/v2/appointments/${a.id}`)
      .send({ notes: secret, location: 'Room 4', title: 'Renamed', rowVersion: a.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      notes: secret,
      location: 'Room 4',
      title: 'Renamed',
      rowVersion: a.rowVersion + 1,
    });
    const row = await api.rowOf(a.id);
    expect(row.notes).not.toContain('latex');
    expect(String(row.notes).length).toBeGreaterThan(20);
    const audit = await h.owner.query(
      `SELECT delta::text AS d FROM audit_log WHERE org_id = $1 AND module = 'appointments' AND record_id = $2 AND action = 'update'`,
      [t.orgId, row.id],
    );
    expect(audit.rows.map((r) => r.d).join(' ')).not.toContain('latex');
    const stale = await api
      .as(t.admin)
      .patch(`/v2/appointments/${a.id}`)
      .send({ notes: 'x', rowVersion: a.rowVersion });
    expect(stale.status).toBe(409);
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/appointments/${a.id}`)
          .send({ notes: null, rowVersion: res.body.rowVersion })
      ).body.notes,
    ).toBeNull();
    const host = await api
      .as(t.admin)
      .patch(`/v2/appointments/${a.id}`)
      .send({ hostId: crypto.randomUUID(), rowVersion: res.body.rowVersion + 1 });
    expect(code(host)).toBe('APPT_HOST_INVALID');
  });

  it("D-07: the list is cursor paged with scope tabs, status, search, type and date filters; the counts feed the tab badges; `mine` is the caller's hosting", async () => {
    const t2 = await api.signup('asl2');
    const ty = await api.type(t2.admin, { name: 'List type' });
    const s = await api.slots(t2.admin, ty.id);
    const made: Appointment[] = [];
    for (let i = 0; i < 7; i++) {
      made.push(
        await api.staffBook(t2.admin, {
          bookingTypeId: ty.id,
          startsAt: s[i * 2]!.start,
          invitee: { name: `Person ${i}`, phone: `+91981110020${i}`, email: `p${i}@list.test` },
        }),
      );
    }
    await api.post(t2.admin, `/v2/appointments/${made[0]!.id}/cancel`, {});
    await api.moveTo(made[1]!.id, -5);

    const page1 = await api.as(t2.admin).get('/v2/appointments?limit=3');
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.page.hasMore).toBe(true);
    const page2 = await api
      .as(t2.admin)
      .get(`/v2/appointments?limit=3&cursor=${page1.body.page.nextCursor}`);
    expect(page2.body.data).toHaveLength(2);
    expect(page2.body.page).toMatchObject({ hasMore: false, nextCursor: null });
    const seen = [...page1.body.data, ...page2.body.data].map((x: Appointment) => x.id);
    expect(new Set(seen).size).toBe(seen.length);
    // Upcoming = not started and active: the cancelled one and the started one are not in it, the rest are, soonest first.
    expect(seen).toHaveLength(5);
    expect(seen).not.toContain(made[0]!.id);
    expect(seen).not.toContain(made[1]!.id);
    const starts = [...page1.body.data, ...page2.body.data].map((x: Appointment) => x.startsAt);
    expect(starts).toEqual([...starts].sort());

    const past = await api.as(t2.admin).get('/v2/appointments?scope=past');
    expect(past.body.data.map((x: Appointment) => x.id)).toEqual([made[1]!.id]);
    const cancelled = await api.as(t2.admin).get('/v2/appointments?scope=all&status=cancelled');
    expect(cancelled.body.data.map((x: Appointment) => x.id)).toEqual([made[0]!.id]);
    expect(
      (await api.as(t2.admin).get('/v2/appointments?scope=all&q=person%205')).body.data.map(
        (x: Appointment) => x.id,
      ),
    ).toEqual([made[5]!.id]);
    expect(
      (await api.as(t2.admin).get('/v2/appointments?scope=all&q=p3@list')).body.data,
    ).toHaveLength(1);
    expect(
      (await api.as(t2.admin).get('/v2/appointments?scope=all&q=981110020')).body.data,
    ).toHaveLength(7);
    expect(
      (await api.as(t2.admin).get(`/v2/appointments?scope=all&bookingTypeId=${ty.id}`)).body.data,
    ).toHaveLength(7);
    expect(
      (
        await api
          .as(t2.admin)
          .get(`/v2/appointments?scope=all&bookingTypeId=${crypto.randomUUID()}`)
      ).body.data,
    ).toHaveLength(0);
    const window = await api
      .as(t2.admin)
      .get(
        `/v2/appointments?scope=all&from=${encodeURIComponent(s[4]!.start)}&to=${encodeURIComponent(s[8]!.start)}`,
      );
    expect(window.body.data.map((x: Appointment) => x.id).sort()).toEqual(
      [made[2]!.id, made[3]!.id].sort(),
    );
    expect(
      (await api.as(t2.admin).get('/v2/appointments?scope=all&mine=true')).body.data,
    ).toHaveLength(7);

    const counts = await api.as(t2.admin).get('/v2/appointments/counts');
    expect(counts.body).toMatchObject({
      pending: 0,
      confirmed: 6,
      cancelled: 1,
      declined: 0,
      completed: 0,
      noShow: 0,
      total: 7,
      upcoming: 5,
      past: 1,
      mine: { upcoming: 5 },
    });
    expect((await api.as(t2.admin).get('/v2/appointments?cursor=garbage')).status).toBe(422);
    expect((await api.as(t2.admin).get('/v2/appointments?status=bogus')).status).toBe(422);
  });

  it('EXT-APPT-06: the ICS file is an attachment with one event for this booking', async () => {
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[44]!.start,
      invitee: { name: 'I', phone: '+919811100120' },
    });
    const res = await api.as(t.admin).get(`/v2/appointments/${a.id}/ics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="appointment-[0-9a-f]{8}\.ics"$/,
    );
    const text = res.text as string;
    expect(text).toContain('BEGIN:VEVENT');
    expect(text).toContain(`UID:${a.id}@appointments`);
    expect(text).toContain(`DTSTART:${slots[44]!.start.replace(/[-:]/g, '').replace('.000', '')}`);
    expect(text).toContain('SUMMARY:Staff Demo');
    expect(text).not.toContain('manage');
  });

  it('D-19: the manage link can be copied and rotated: the old one stops working at once', async () => {
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[48]!.start,
      invitee: { name: 'L', phone: '+919811100130' },
    });
    const oldToken = a.manageUrl!.split('/').pop()!;
    expect((await api.manage(oldToken)).status).toBe(200);
    const rotated = await api.post(t.admin, `/v2/appointments/${a.id}/manage-link/rotate`, {});
    expect(rotated.status).toBe(200);
    const newToken = rotated.body.manageUrl.split('/').pop();
    expect(newToken).not.toBe(oldToken);
    expect((await api.manage(oldToken)).status).toBe(404);
    expect((await api.manage(newToken)).status).toBe(200);
    expect((await api.appt(t.admin, a.id)).manageUrl).toBe(rotated.body.manageUrl);
  });

  it('only a booking in a final status is deleted; the delete is audited and announced', async () => {
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[52]!.start,
      invitee: { name: 'X', phone: '+919811100140' },
    });
    const refused = await api.as(t.admin).delete(`/v2/appointments/${a.id}`);
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('APPT_NOT_DELETABLE');
    await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, {});
    expect((await api.as(t.admin).delete(`/v2/appointments/${a.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/appointments/${a.id}`)).status).toBe(404);
    expect(await api.eventsOf(t.orgId, 'appointment.deleted', a.id)).toHaveLength(1);
  });

  it('every booking writes its audit row and its outbox event in the same transaction, and nothing personal is in the event', async () => {
    const before = await api.auditCount(t.orgId, 'appointments', 'insert');
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[56]!.start,
      invitee: { name: 'Zed Private', phone: '+919811100150', email: 'zed.private@example.com' },
      notes: 'secret note',
    });
    expect(await api.auditCount(t.orgId, 'appointments', 'insert')).toBe(before + 1);
    const booked = (await api.eventsOf(t.orgId, 'appointment.booked', a.id))[0]!;
    expect(booked).toMatchObject({
      status: 'confirmed',
      source: 'manual',
      requiresApproval: false,
      paymentDue: false,
      notify: true,
      bookingTypeId: type.id,
    });
    const text = JSON.stringify(booked);
    for (const secret of [
      'Zed Private',
      '+919811100150',
      'zed.private@example.com',
      'secret note',
      'manage',
    ])
      expect(text).not.toContain(secret);
    await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, { notify: false });
    const cancelled = (await api.eventsOf(t.orgId, 'appointment.cancelled', a.id))[0]!;
    expect(cancelled).toMatchObject({ from: 'confirmed', by: 'staff', notify: false });
    expect(await api.auditCount(t.orgId, 'appointments', 'update')).toBeGreaterThan(0);
  });
});

describe("the customer's booking page (EXT-APPT-01, TW-APPT-024..026)", () => {
  let t: Tenant;
  let type: BookingType;
  beforeAll(async () => {
    t = await api.signup('apb');
    type = await api.type(t.admin, {
      name: 'Public Demo',
      description: 'Pick a time',
      introMessage: 'Tell us about you',
      locationType: 'address',
      locationValue: '12 MG Road',
      questions: [{ label: 'Company', type: 'text', required: true }],
      payment: { currency: 'USD', fee: '40.00' },
    });
  });

  it("browses without a login: the workspace's services and one service, with no staff or customer data", async () => {
    const page = await api
      .http()
      .get(`/v2/public/booking/${t.slug}`)
      .set('x-forwarded-for', freshIp());
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-robots-tag']).toContain('noindex');
    expect(page.body.organization.slug).toBe(t.slug);
    const svc = page.body.services.find((s: { slug: string }) => s.slug === type.slug);
    expect(svc).toMatchObject({
      name: 'Public Demo',
      durationMinutes: 30,
      locationType: 'address',
      locationValue: '12 MG Road',
      timezone: 'UTC',
      approvalRequired: false,
      price: { currency: 'USD', total: '40.00', dueNow: '0.00' },
    });
    expect(svc.questions).toEqual([
      { id: type.questions[0]!.id, label: 'Company', type: 'text', options: null, required: true },
    ]);
    expect(Object.keys(svc).sort()).toEqual([
      'approvalRequired',
      'color',
      'description',
      'durationMinutes',
      'introMessage',
      'locationType',
      'locationValue',
      'name',
      'price',
      'questions',
      'slug',
      'timezone',
    ]);
    const one = await api
      .http()
      .get(`/v2/public/booking/${t.slug}/${type.slug}`)
      .set('x-forwarded-for', freshIp());
    expect(one.status).toBe(200);
    expect(JSON.stringify(one.body)).not.toMatch(/host|rowVersion|"id":"[0-9a-f-]{36}","name"/);
    expect(
      (
        await api
          .http()
          .get(`/v2/public/booking/${t.slug}/no-such`)
          .set('x-forwarded-for', freshIp())
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .http()
          .get('/v2/public/booking/no-such-workspace')
          .set('x-forwarded-for', freshIp())
      ).status,
    ).toBe(404);
    expect(
      (await api.http().get('/v2/public/booking/bad%20slug!').set('x-forwarded-for', freshIp()))
        .status,
    ).toBe(404);
  });

  it('a paused service is not offered and cannot be booked', async () => {
    const p = await api.type(t.admin, { name: 'Paused one', isActive: false });
    const page = await api
      .http()
      .get(`/v2/public/booking/${t.slug}`)
      .set('x-forwarded-for', freshIp());
    expect(page.body.services.map((s: { slug: string }) => s.slug)).not.toContain(p.slug);
    expect(
      (
        await api
          .http()
          .get(`/v2/public/booking/${t.slug}/${p.slug}`)
          .set('x-forwarded-for', freshIp())
      ).status,
    ).toBe(404);
    const slots = await api.slots(t.admin, p.id);
    expect(
      (
        await api.publicBook(t.slug, p.slug, {
          startsAt: slots[0]!.start,
          name: 'P',
          email: 'p@example.com',
        })
      ).status,
    ).toBe(404);
  });

  it('books a slot: confirmed, the manage link, a contact made for the visitor; the slot is gone at once; the same visitor again gets the same booking', async () => {
    const slots = await api.publicSlots(t.slug, type.slug);
    const s = slots[1]!;
    const body = {
      startsAt: s.start,
      name: 'Pat Public',
      email: 'Pat@Example.com',
      phone: '+1 415 555 0100',
      timezone: 'America/Los_Angeles',
      notes: 'First visit',
      answers: { [type.questions[0]!.id]: 'Acme' },
    };
    const done = await api.publicBooked(t.slug, type.slug, body);
    expect(done).toMatchObject({
      status: 'confirmed',
      startsAt: s.start,
      endsAt: s.end,
      requiresApproval: false,
      paymentDue: null,
      replay: false,
    });
    expect(done.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(done.manageUrl).toBe(`http://localhost:3001/b/manage/${done.manageToken}`);
    expect((await api.publicSlots(t.slug, type.slug)).map((x) => x.start)).not.toContain(s.start);

    const replay = await api.publicBooked(t.slug, type.slug, body);
    expect(replay).toMatchObject({ replay: true, manageToken: done.manageToken });
    const rows = await h.owner.query(
      `SELECT count(*)::int AS n FROM appointments WHERE org_id = $1 AND starts_at = $2`,
      [t.orgId, s.start],
    );
    expect(rows.rows[0].n).toBe(1);

    const staff = await api.as(t.admin).get(`/v2/appointments?scope=all&q=pat@example`);
    expect(staff.body.data).toHaveLength(1);
    const a = staff.body.data[0] as Appointment;
    expect(a).toMatchObject({
      source: 'link',
      status: 'confirmed',
      inviteeTimezone: 'America/Los_Angeles',
      invitee: { name: 'Pat Public', email: 'pat@example.com', phone: '+14155550100' },
      answers: [{ label: 'Company', value: 'Acme' }],
    });
    expect(a.contact?.id).toMatch(uuidRe);
    expect(a.manageUrl).toBe(done.manageUrl);
    expect(a.host?.id).toBe(type.host?.id);
    // The event tells the consumers it came from a customer (no staff actor).
    const ev = (await api.eventsOf(t.orgId, 'appointment.booked', a.id))[0]!;
    expect(ev).toMatchObject({ source: 'link', notify: true });
  });

  it('validation: a name and an email or a phone, a real time zone, required answers; an invalid time is 422 and a taken one 409', async () => {
    const slots = await api.publicSlots(t.slug, type.slug);
    const s = slots[6]!.start;
    const answers = { [type.questions[0]!.id]: 'Co' };
    expect(
      (await api.publicBook(t.slug, type.slug, { startsAt: s, name: 'N', answers })).status,
    ).toBe(422);
    expect(
      (await api.publicBook(t.slug, type.slug, { startsAt: s, email: 'a@b.co', answers })).status,
    ).toBe(422);
    expect(
      (
        await api.publicBook(t.slug, type.slug, {
          startsAt: s,
          name: 'N',
          email: 'not-mail',
          answers,
        })
      ).status,
    ).toBe(422);
    expect(
      (await api.publicBook(t.slug, type.slug, { startsAt: s, name: 'N', phone: '12', answers }))
        .status,
    ).toBe(422);
    expect(
      (
        await api.publicBook(t.slug, type.slug, {
          startsAt: s,
          name: 'N',
          email: 'a@b.co',
          timezone: 'Nope/Nope',
          answers,
        })
      ).status,
    ).toBe(422);
    const noAnswer = await api.publicBook(t.slug, type.slug, {
      startsAt: s,
      name: 'N',
      email: 'a@b.co',
    });
    expect(noAnswer.status).toBe(422);
    expect(code(noAnswer)).toBe('APPT_ANSWERS_INVALID');
    const off = await api.publicBook(t.slug, type.slug, {
      startsAt: new Date(Date.parse(s) + 5 * 60_000).toISOString(),
      name: 'N',
      email: 'a@b.co',
      answers,
    });
    expect(off.status).toBe(422);
    expect(code(off)).toBe('APPT_SLOT_UNAVAILABLE');
    const past = await api.publicBook(t.slug, type.slug, {
      startsAt: new Date(Date.now() - DAY).toISOString(),
      name: 'N',
      email: 'a@b.co',
      answers,
    });
    expect(past.status).toBe(422);
    await api.publicBooked(t.slug, type.slug, {
      startsAt: s,
      name: 'Winner',
      email: 'w@example.com',
      answers,
    });
    const lost = await api.publicBook(t.slug, type.slug, {
      startsAt: s,
      name: 'Loser',
      email: 'l@example.com',
      answers,
    });
    expect(lost.status).toBe(409);
    expect(code(lost)).toBe('APPT_SLOT_TAKEN');
    expect(JSON.stringify(lost.body)).not.toContain('Winner');
  });

  it('EXT-APPT-05: parallel bookings of one slot: exactly one wins, whoever is faster, and the rest are told it is taken', async () => {
    const single = await api.type(t.admin, { name: 'Race one' });
    const s = (await api.publicSlots(t.slug, single.slug))[3]!.start;
    const N = 12;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        api.publicBook(t.slug, single.slug, {
          startsAt: s,
          name: `Racer ${i}`,
          email: `racer${i}@example.com`,
        }),
      ),
    );
    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(N - 1);
    for (const l of lost) expect(code(l)).toBe('APPT_SLOT_TAKEN');
    const rows = await h.owner.query(
      `SELECT seat, status FROM appointments WHERE org_id = $1 AND booking_type_id = (SELECT id FROM booking_types WHERE uuid = $2)`,
      [t.orgId, single.id],
    );
    expect(rows.rows).toEqual([{ seat: 1, status: 'confirmed' }]);
  });

  it('EXT-APPT-05: parallel bookings of a group slot: exactly as many winners as seats, each on its own seat', async () => {
    const group = await api.type(t.admin, { name: 'Race group', capacity: 3 });
    const s = (await api.publicSlots(t.slug, group.slug))[3]!.start;
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        api.publicBook(t.slug, group.slug, {
          startsAt: s,
          name: `G ${i}`,
          email: `group${i}@example.com`,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(6);
    const seats = await h.owner.query(
      `SELECT seat FROM appointments WHERE org_id = $1 AND booking_type_id = (SELECT id FROM booking_types WHERE uuid = $2) ORDER BY seat`,
      [t.orgId, group.id],
    );
    expect(seats.rows.map((r) => r.seat)).toEqual([1, 2, 3]);
    expect((await api.publicSlots(t.slug, group.slug)).map((x) => x.start)).not.toContain(s);
  });

  it('TW-APPT-024: the manage page shows the booking and what the customer may do, and nothing about the customer', async () => {
    const plain = await api.type(t.admin, {
      name: 'Manage me',
      locationType: 'address',
      locationValue: '9 High St',
    });
    const s = (await api.publicSlots(t.slug, plain.slug))[2]!;
    const done = await api.publicBooked(t.slug, plain.slug, {
      startsAt: s.start,
      name: 'Quiet Customer',
      email: 'quiet.customer@example.com',
      phone: '+14155550177',
    });
    const view = await api.manage(done.manageToken);
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(view.body).toMatchObject({
      status: 'confirmed',
      organization: { name: expect.any(String) },
      bookingType: {
        name: 'Manage me',
        durationMinutes: 30,
        locationType: 'address',
        locationValue: '9 High St',
      },
      startsAt: s.start,
      endsAt: s.end,
      timezone: 'UTC',
      canCancel: true,
      canReschedule: true,
      cancelFee: null,
    });
    expect(Object.keys(view.body).sort()).toEqual([
      'bookingType',
      'canCancel',
      'canReschedule',
      'cancelFee',
      'endsAt',
      'meetUrl',
      'organization',
      'startsAt',
      'status',
      'timezone',
      'title',
    ]);
    const text = JSON.stringify(view.body);
    for (const secret of [
      'Quiet Customer',
      'quiet.customer@example.com',
      '+14155550177',
      done.manageToken,
    ])
      expect(text).not.toContain(secret);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    // GET never changes anything (a chat preview cannot cancel).
    for (let i = 0; i < 3; i++) await api.manage(done.manageToken);
    expect((await api.manage(done.manageToken)).body.status).toBe('confirmed');
  });

  it('unknown, malformed and oversized tokens are 404 and cost no database lookup of the wrong kind', async () => {
    expect((await api.manage('A'.repeat(43))).status).toBe(404);
    expect((await api.manage('short')).status).toBe(404);
    expect((await api.manage('A'.repeat(300))).status).toBe(404);
    expect((await api.managePost('A'.repeat(43), 'cancel')).status).toBe(404);
    expect(
      (
        await api.managePost('not-a-token', 'reschedule', {
          startsAt: new Date(Date.now() + DAY).toISOString(),
        })
      ).status,
    ).toBe(404);
  });

  it('TW-APPT-025 / D-05: the customer reschedules from the link; the target must be an offered slot (Reference took any instant); the old slot is freed', async () => {
    const plain = await api.type(t.admin, { name: 'Move me' });
    const slots = await api.publicSlots(t.slug, plain.slug);
    const done = await api.publicBooked(t.slug, plain.slug, {
      startsAt: slots[4]!.start,
      name: 'Mover',
      email: 'mover@example.com',
    });
    const manageSlots = await api
      .http()
      .get(`/v2/public/booking-manage/${done.manageToken}/slots`)
      .set('x-forwarded-for', freshIp());
    expect(manageSlots.status).toBe(200);
    const offered = (manageSlots.body.days as Array<{ slots: Array<{ start: string }> }>)
      .flatMap((d) => d.slots)
      .map((x) => x.start);
    expect(offered).toContain(slots[4]!.start); // the booking's own slot is free for it
    const moved = await api.managePost(done.manageToken, 'reschedule', {
      startsAt: slots[8]!.start,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({
      status: 'confirmed',
      startsAt: slots[8]!.start,
      canCancel: true,
    });
    expect((await api.publicSlots(t.slug, plain.slug)).map((x) => x.start)).toContain(
      slots[4]!.start,
    );
    // Not on the grid, in the past, outside the horizon, or already taken: refused.
    const crafted = await api.managePost(done.manageToken, 'reschedule', {
      startsAt: new Date(Date.parse(slots[10]!.start) + 7 * 60_000).toISOString(),
    });
    expect(crafted.status).toBe(422);
    expect(code(crafted)).toBe('APPT_SLOT_UNAVAILABLE');
    expect(
      (
        await api.managePost(done.manageToken, 'reschedule', {
          startsAt: new Date(Date.now() - DAY).toISOString(),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await api.managePost(done.manageToken, 'reschedule', {
          startsAt: new Date(Date.now() + 90 * DAY).toISOString(),
        })
      ).status,
    ).toBe(422);
    await api.publicBooked(t.slug, plain.slug, {
      startsAt: slots[12]!.start,
      name: 'Other',
      email: 'other@example.com',
    });
    const taken = await api.managePost(done.manageToken, 'reschedule', {
      startsAt: slots[12]!.start,
    });
    expect(taken.status).toBe(409);
    expect(code(taken)).toBe('APPT_SLOT_TAKEN');
    expect((await api.managePost(done.manageToken, 'reschedule', {})).status).toBe(422);
    // The reschedule is announced, from the customer.
    const staff = await api.as(t.admin).get('/v2/appointments?scope=all&q=mover@example');
    const evs = await api.eventsOf(t.orgId, 'appointment.rescheduled', staff.body.data[0].id);
    expect(evs[0]).toMatchObject({ by: 'invitee', previousStartsAt: slots[4]!.start });
  });

  it('TW-APPT-026: the customer cancels from the link; the slot is freed; a second cancel is 410; a started booking cannot be cancelled by the customer', async () => {
    const fee = await api.type(t.admin, {
      name: 'Cancel fee',
      payment: { currency: 'USD', fee: '30.00', cancelFee: '7.50', cancelWindowMinutes: 500_000 },
    });
    const slots = await api.publicSlots(t.slug, fee.slug);
    const done = await api.publicBooked(t.slug, fee.slug, {
      startsAt: slots[2]!.start,
      name: 'Canceller',
      email: 'canceller@example.com',
    });
    const before = await api.manage(done.manageToken);
    expect(before.body.cancelFee).toEqual({ currency: 'USD', amount: '7.50' });
    const cancelled = await api.managePost(done.manageToken, 'cancel', { reason: 'Plans changed' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      canCancel: false,
      canReschedule: false,
    });
    expect((await api.publicSlots(t.slug, fee.slug)).map((x) => x.start)).toContain(
      slots[2]!.start,
    );
    const staff = (await api.as(t.admin).get('/v2/appointments?scope=all&q=canceller@example')).body
      .data[0] as Appointment;
    expect(staff).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'invitee',
      cancelReason: 'Plans changed',
    });
    expect(staff.payment.feeRecorded).toBe('7.50');
    const again = await api.managePost(done.manageToken, 'cancel');
    expect(again.status).toBe(410);
    expect(code(again)).toBe('APPT_LINK_UNAVAILABLE');
    expect(
      (await api.managePost(done.manageToken, 'reschedule', { startsAt: slots[3]!.start })).status,
    ).toBe(410);
    expect(
      (
        await api
          .http()
          .get(`/v2/public/booking-manage/${done.manageToken}/slots`)
          .set('x-forwarded-for', freshIp())
      ).status,
    ).toBe(410);
    // The page itself still shows the outcome.
    expect((await api.manage(done.manageToken)).body.status).toBe('cancelled');
    // Started: the customer cannot cancel it any more.
    const late = await api.publicBooked(t.slug, fee.slug, {
      startsAt: slots[5]!.start,
      name: 'Late',
      email: 'late@example.com',
    });
    const lateRow = (await api.as(t.admin).get('/v2/appointments?scope=all&q=late@example')).body
      .data[0] as Appointment;
    await api.moveTo(lateRow.id, -1);
    const refused = await api.managePost(late.manageToken, 'cancel');
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('APPT_ALREADY_STARTED');
    expect((await api.manage(late.manageToken)).body).toMatchObject({
      canCancel: false,
      canReschedule: false,
    });
  });

  it('EXT-APPT-06: the customer can download the ICS of their booking from the link', async () => {
    const plain = await api.type(t.admin, { name: 'Ics me' });
    const s = (await api.publicSlots(t.slug, plain.slug))[1]!;
    const done = await api.publicBooked(t.slug, plain.slug, {
      startsAt: s.start,
      name: 'Ics',
      email: 'ics@example.com',
    });
    const res = await api
      .http()
      .get(`/v2/public/booking-manage/${done.manageToken}/ics`)
      .set('x-forwarded-for', freshIp());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VEVENT');
    expect(res.text).toContain('SUMMARY:Ics me');
    expect(res.text).not.toContain('ics@example.com');
    expect(res.text).not.toContain(done.manageToken);
  });

  it('D-19: the public routes are throttled per IP: the eleventh booking attempt in a minute is 429 with a retry hint', async () => {
    const ip = '10.99.0.1';
    const body = {
      startsAt: new Date(Date.now() + 400 * DAY).toISOString(),
      name: 'Spam',
      email: 'spam@example.com',
      answers: { [type.questions[0]!.id]: 'x' },
    };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await api.publicBook(t.slug, type.slug, body, ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 422)).toBe(true);
    expect(statuses[10]).toBe(429);
    const limited = await api.publicBook(t.slug, type.slug, body, ip);
    expect(code(limited)).toBe('RATE_LIMITED');
    expect(limited.body.errors?.[0]?.path).toBe('retryAfterSeconds');
    // Another visitor is not affected.
    expect((await api.publicBook(t.slug, type.slug, body, freshIp())).status).toBe(422);
  });
});

describe('approval and payment (EXT-APPT-03, D-13)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('apa2');
  });

  it('EXT-APPT-03: a type that needs approval books as a request: pending, the slot is held, staff confirm or decline', async () => {
    const type = await api.type(t.admin, { name: 'Approval', approvalRequired: true });
    const slots = await api.publicSlots(t.slug, type.slug);
    const req = await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'Requester',
      email: 'req@example.com',
    });
    expect(req).toMatchObject({ status: 'pending', requiresApproval: true, paymentDue: null });
    expect((await api.manage(req.manageToken)).body.status).toBe('pending');
    const taken = await api.publicBook(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'Other',
      email: 'other@example.com',
    });
    expect(taken.status).toBe(409);
    const booked = (await api.eventsOf(t.orgId, 'appointment.booked')).find(
      (e) => e.bookingTypeId === type.id,
    )!;
    expect(booked).toMatchObject({ status: 'pending', requiresApproval: true });
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&status=pending')).body
      .data[0] as Appointment;
    const confirmed = await api.post(t.admin, `/v2/appointments/${a.id}/confirm`, {});
    expect(confirmed.body).toMatchObject({ status: 'confirmed' });
    expect((await api.eventsOf(t.orgId, 'appointment.confirmed', a.id))[0]).toMatchObject({
      from: 'pending',
      by: 'staff',
    });
    // A second request is declined: the slot comes back.
    const second = await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[1]!.start,
      name: 'Second',
      email: 'second@example.com',
    });
    expect(second.status).toBe('pending');
    const b = (await api.as(t.admin).get('/v2/appointments?scope=all&q=second@example')).body
      .data[0] as Appointment;
    const declined = await api.post(t.admin, `/v2/appointments/${b.id}/decline`, {
      reason: 'Fully booked that day',
    });
    expect(declined.body).toMatchObject({
      status: 'declined',
      cancelledBy: 'staff',
      cancelReason: 'Fully booked that day',
    });
    expect((await api.publicSlots(t.slug, type.slug)).map((x) => x.start)).toContain(
      slots[1]!.start,
    );
    expect((await api.manage(second.manageToken)).body.status).toBe('declined');
    expect((await api.post(t.admin, `/v2/appointments/${b.id}/confirm`, {})).status).toBe(409);
    // A staff booking is the approval: confirmed at once.
    const staffBooked = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[2]!.start,
      invitee: { name: 'Staff', phone: '+919811100300' },
    });
    expect(staffBooked.status).toBe('confirmed');
  });

  it('D-13: a paid type books as pending with the amount due and a payment hold; recording the payment confirms it; no gateway is involved', async () => {
    const type = await api.type(t.admin, {
      name: 'Paid',
      payment: {
        currency: 'USD',
        fee: '100.00',
        taxPercent: '10',
        depositMode: 'partial',
        deposit: '30.00',
        gatewaySlug: 'stripe',
      },
    });
    const slots = await api.publicSlots(t.slug, type.slug);
    const req = await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'Payer',
      email: 'payer@example.com',
    });
    expect(req).toMatchObject({
      status: 'pending',
      requiresApproval: false,
      paymentDue: { currency: 'USD', amount: '30.00' },
    });
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&q=payer@example')).body
      .data[0] as Appointment;
    expect(a.payment).toMatchObject({
      status: 'pending',
      total: '110.00',
      dueNow: '30.00',
      paid: '0.00',
      currency: 'USD',
    });
    expect(a.payment.holdExpiresAt).not.toBeNull();
    const due = (await api.eventsOf(t.orgId, 'appointment.payment_due', a.id))[0]!;
    expect(due).toMatchObject({ amount: '30.00', currency: 'USD', gatewaySlug: 'stripe' });

    const partial = await api.post(t.admin, `/v2/appointments/${a.id}/payments`, {
      amount: '10.00',
      method: 'cash',
    });
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(partial.body).toMatchObject({ status: 'pending' });
    expect(partial.body.payment).toMatchObject({ status: 'partial', paid: '10.00' });
    const settled = await api.post(t.admin, `/v2/appointments/${a.id}/payments`, {
      amount: '20.00',
      reference: 'TXN-1',
    });
    expect(settled.body).toMatchObject({ status: 'confirmed' });
    expect(settled.body.payment).toMatchObject({
      status: 'partial',
      paid: '30.00',
      holdExpiresAt: null,
    });
    expect(
      (await api.eventsOf(t.orgId, 'appointment.payment_received', a.id)).map((e) => e.amount),
    ).toEqual(['10.00', '20.00']);
    expect((await api.eventsOf(t.orgId, 'appointment.confirmed', a.id))[0]).toMatchObject({
      by: 'system',
      reason: 'payment',
    });
    const rest = await api.post(t.admin, `/v2/appointments/${a.id}/payments`, { amount: '80.00' });
    expect(rest.body.payment).toMatchObject({ status: 'paid', paid: '110.00' });
    for (const [amount, why] of [
      ['0.01', 'more than the price'],
      ['abc', 'not a number'],
    ] as const) {
      const res = await api.post(t.admin, `/v2/appointments/${a.id}/payments`, { amount });
      expect(res.status, why).toBe(422);
    }
    const over = await api.post(t.admin, `/v2/appointments/${a.id}/payments`, { amount: '0.01' });
    expect(code(over)).toBe('APPT_AMOUNT_INVALID');
    // A free booking takes no payment; a cancelled one takes none either.
    const free = await api.type(t.admin, { name: 'Free' });
    const fs = await api.slots(t.admin, free.id);
    const fa = await api.staffBook(t.admin, {
      bookingTypeId: free.id,
      startsAt: fs[0]!.start,
      invitee: { name: 'F', phone: '+919811100310' },
    });
    expect(
      code(await api.post(t.admin, `/v2/appointments/${fa.id}/payments`, { amount: '5' })),
    ).toBe('APPT_AMOUNT_INVALID');
    await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, {});
    expect(
      code(await api.post(t.admin, `/v2/appointments/${a.id}/payments`, { amount: '1' })),
    ).toBe('APPT_INVALID_TRANSITION');
  });

  it('a payment due with no gateway waits for staff (no hold to expire under the customer); a full-payment type is due in full', async () => {
    const type = await api.type(t.admin, {
      name: 'No gateway',
      payment: { currency: 'USD', fee: '20.00', depositMode: 'full' },
    });
    const slots = await api.publicSlots(t.slug, type.slug);
    const req = await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'NG',
      email: 'ng@example.com',
    });
    expect(req).toMatchObject({ status: 'pending', paymentDue: { amount: '20.00' } });
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&q=ng@example')).body
      .data[0] as Appointment;
    expect(a.payment.holdExpiresAt).toBeNull();
    const paid = await api.post(t.admin, `/v2/appointments/${a.id}/payments`, { amount: '20.00' });
    expect(paid.body).toMatchObject({ status: 'confirmed', payment: { status: 'paid' } });
  });

  it('a payment on an approval-required booking settles the money but leaves the approval to staff', async () => {
    const type = await api.type(t.admin, {
      name: 'Both',
      approvalRequired: true,
      payment: { currency: 'USD', fee: '20.00', depositMode: 'full' },
    });
    const slots = await api.publicSlots(t.slug, type.slug);
    await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'Both',
      email: 'both@example.com',
    });
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&q=both@example')).body
      .data[0] as Appointment;
    const paid = await api.post(t.admin, `/v2/appointments/${a.id}/payments`, { amount: '20.00' });
    expect(paid.body).toMatchObject({ status: 'pending', payment: { status: 'paid' } });
    expect((await api.post(t.admin, `/v2/appointments/${a.id}/confirm`, {})).body.status).toBe(
      'confirmed',
    );
  });
});

describe('the monthly cap (TW-APPT-035, D-17)', () => {
  it('a plan limit of N bookings a month: the N+1th is 422 PLAN_LIMIT_REACHED for staff and "not available" for the public; cancelling frees one; 0 is unlimited', async () => {
    const t = await api.signup('apc');
    const type = await api.type(t.admin, { name: 'Capped' });
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"appointments":2}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'C1', phone: '+919811100400' },
    });
    await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[1]!.start,
      invitee: { name: 'C2', phone: '+919811100401' },
    });
    const third = await api.post(t.admin, '/v2/appointments', {
      bookingTypeId: type.id,
      startsAt: slots[2]!.start,
      invitee: { name: 'C3', phone: '+919811100402' },
    });
    expect(third.status).toBe(422);
    expect(code(third)).toBe('PLAN_LIMIT_REACHED');
    const pub = await api.publicBook(t.slug, type.slug, {
      startsAt: slots[2]!.start,
      name: 'C3',
      email: 'c3@example.com',
    });
    expect(pub.status).toBe(409);
    expect(code(pub)).toBe('APPT_BOOKING_UNAVAILABLE');
    expect(JSON.stringify(pub.body)).not.toMatch(/limit|upgrade|plans/i);
    await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, {});
    expect(
      (
        await api.publicBook(t.slug, type.slug, {
          startsAt: slots[2]!.start,
          name: 'C3',
          email: 'c3@example.com',
        })
      ).status,
    ).toBe(201);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"appointments":-1}}' WHERE org_id = $1`,
      [t.orgId],
    );
    await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[3]!.start,
      invitee: { name: 'C4', phone: '+919811100403' },
    });
  });
});

describe("the flow's side: BookingOffersService (TW-APPT-019, 020, 021, 034)", () => {
  it('lists the active types with the offer gate, drills down days then times nine to a page, reserves a seat for ten minutes, and books with the same guard', async () => {
    const { BookingOffersService } = await import('../../../src/modules/appointments-booking');
    const offers = h.app.get(BookingOffersService);
    const t = await api.signup('apf');
    const type = await api.type(t.admin, {
      name: 'Flow type',
      questions: [{ label: 'Company', type: 'text', required: true }],
      payment: { currency: 'USD', fee: '10.00', depositMode: 'full' },
    });
    const offer = await offers.offer(t.orgId);
    expect(offer.available).toBe(true);
    if (!offer.available) throw new Error('unreachable');
    expect(offer.types.map((x) => x.name)).toEqual(['Flow type']);
    expect(offer.types[0]).toMatchObject({
      durationMinutes: 30,
      currency: 'USD',
      dueNow: '10.00',
      hasGateway: false,
    });

    const days = await offers.days(t.orgId, type.id);
    expect(days.days).toHaveLength(9);
    expect(days.hasMore).toBe(true);
    expect(days.days[0]!.label).toMatch(/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2}$/);
    expect((await offers.days(t.orgId, type.id, days.nextOffset)).days.length).toBeGreaterThan(0);
    const times = await offers.times(t.orgId, type.id, days.days[1]!.date);
    expect(times.times).toHaveLength(9);
    expect(times.hasMore).toBe(true);
    expect(times.times[0]!.label).toBe('12:00 AM');

    const start = new Date(times.times[0]!.start);
    const hold = await offers.reserve(t.orgId, type.id, start, 'chat-1');
    expect(hold.reservationId).toMatch(uuidRe);
    // The reserved slot is not offered to anyone else, but is to the session that holds it.
    expect(
      (await offers.times(t.orgId, type.id, days.days[1]!.date)).times.map((x) => x.start),
    ).not.toContain(start.toISOString());
    const other = await offers.reserve(t.orgId, type.id, start, 'chat-2').catch((e) => e);
    expect(other.code).toBe('APPT_SLOT_TAKEN');
    const res = await offers.book(t.orgId, {
      typeId: type.id,
      startsAt: start,
      phone: '+919811100500',
      name: 'Chat Customer',
      answers: { [type.questions[0]!.id]: 'Acme' },
      reservationId: hold.reservationId,
      sessionRef: 'chat-1',
    });
    expect(res.appointment).toMatchObject({
      status: 'pending',
      source: 'chat',
      inviteePhone: '+919811100500',
    });
    expect(res.manageUrl).toMatch(/^\/b\/manage\//);
    const left = await h.owner.query(
      `SELECT count(*)::int AS n FROM slot_reservations WHERE org_id = $1`,
      [t.orgId],
    );
    expect(left.rows[0].n).toBe(0);
    const again = await offers.book(t.orgId, {
      typeId: type.id,
      startsAt: start,
      phone: '+919811100500',
      name: 'Chat Customer',
      answers: { [type.questions[0]!.id]: 'Acme' },
    });
    expect(again.replay).toBe(true);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"appointment_booking":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    expect(await offers.offer(t.orgId)).toEqual({ available: false, reason: 'feature_off' });
  });
});
