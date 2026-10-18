import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { AppointmentMeetingMirror } from '../../../src/modules/appointments-booking/appointment-meeting-mirror.service';
import { AppointmentsRepository } from '../../../src/modules/appointments-booking/appointments.repository';
import { MeetingMirrorBackfillService } from '../../../src/modules/appointments-booking/meeting-mirror-backfill.jobs';
import {
  AppointmentsApi,
  startHarness,
  uuidRe,
  type Appointment,
  type BookingType,
  type Harness,
  type Slot,
  type Tenant,
} from './support';

/**
 * Bookings in the contact's Meetings tab (BL-281, phases P0 and P1), end to end against a real Postgres: an appointment that has a
 * contact has one `contact_meetings` row, written in the booking's own transaction whatever the source (staff, public link, chat flow),
 * kept in step on a move / a contact change / a join link, kept (tagged by its status) when the booking closes, removed with the
 * appointment, and back-filled once for the bookings that existed before. Plus the list's order and `when` filter, the permissions the
 * rows are shown under, and tenant isolation.
 */
let h: Harness;
let api: AppointmentsApi;
let db: DatabaseService;
let apptsRepo: AppointmentsRepository;
let backfill: MeetingMirrorBackfillService;

beforeAll(async () => {
  h = await startHarness();
  api = new AppointmentsApi(h);
  db = h.app.get(DatabaseService);
  apptsRepo = h.app.get(AppointmentsRepository);
  backfill = h.app.get(MeetingMirrorBackfillService);
}, 600_000);

afterAll(async () => {
  await h?.stop();
}, 120_000);

interface Meeting {
  id: string;
  contactId: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  source?: 'manual' | 'booking';
  appointmentId?: string | null;
  status?: string | null;
  joinUrl?: string | null;
  canManageBooking?: boolean;
  rowVersion: number;
  createdAt: string;
}
interface MeetingPage {
  data: Meeting[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

const meetings = async (token: string, contactId: string, qs = ''): Promise<MeetingPage> => {
  const res = await api.as(token).get(`/v2/contacts/${contactId}/meetings${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as MeetingPage;
};
const rowsFor = async (orgId: number, appointmentId: string) =>
  (
    await h.owner.query(
      `SELECT m.*, a.uuid AS appt_uuid FROM contact_meetings m
         JOIN appointments a ON a.org_id = m.org_id AND a.id = m.appointment_id
        WHERE m.org_id = $1 AND a.uuid = $2`,
      [orgId, appointmentId],
    )
  ).rows as Array<Record<string, unknown>>;
const eventsFor = async (orgId: number, type: string, appointmentId: string) =>
  (await api.events(orgId, type)).filter((p) => p.appointmentId === appointmentId);
const bookedFor = (page: MeetingPage, appt: Appointment) =>
  page.data.find((m) => m.appointmentId === appt.id);

describe('a booking from every source appears in the contact Meetings (P1)', () => {
  let t: Tenant;
  let type: BookingType;
  let slots: Slot[];
  beforeAll(async () => {
    t = await api.signup('mmk');
    type = await api.type(t.admin, { name: 'Intro call', locationType: 'virtual' });
    slots = await api.slots(t.admin, type.id);
  });

  it('a staff booking for an existing contact: one row, source booking, the appointment id, its status, times, place, and the audit and event', async () => {
    const [contactId] = await api.seedContacts(t, [
      { name: 'Priya Mehta', phone: '+919811200001' },
    ]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      contactId,
    });
    expect(appt.contact?.id).toBe(contactId);

    const list = await meetings(t.admin, contactId!);
    expect(list.data).toHaveLength(1);
    const m = bookedFor(list, appt)!;
    expect(m).toMatchObject({
      contactId,
      title: appt.title,
      startsAt: new Date(appt.startsAt).toISOString(),
      endsAt: new Date(appt.endsAt).toISOString(),
      source: 'booking',
      appointmentId: appt.id,
      status: 'confirmed',
      canManageBooking: true,
    });
    expect(m.id).toMatch(uuidRe);

    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(1);
    const created = await eventsFor(t.orgId, 'contact_meeting.created', appt.id);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ uuid: m.id, source: 'booking', appointmentId: appt.id });
    // The same booking still fires the appointment's own event exactly once: the mirror adds no second booking event.
    expect((await api.eventsOf(t.orgId, 'appointment.booked', appt.id)).length).toBe(1);
    expect(await api.auditCount(t.orgId, 'contact_meetings', 'insert')).toBeGreaterThanOrEqual(1);
  });

  it('the public booking page (source link) creates the contact and the row', async () => {
    const pubType = await api.type(t.admin, { name: 'Public intro' });
    const pubSlots = await api.publicSlots(t.slug, pubType.slug);
    const booked = await api.publicBooked(t.slug, pubType.slug, {
      startsAt: pubSlots[1]!.start,
      name: 'Lina Public',
      email: 'lina.public@example.com',
      phone: '+919811200002',
      answers: {},
    });
    expect(booked.status).toBe('confirmed');
    const appt = (await api.as(t.admin).get('/v2/appointments?scope=all&q=Lina')).body
      .data[0] as Appointment;
    expect(appt.source).toBe('link');
    const list = await meetings(t.admin, appt.contact!.id);
    expect(bookedFor(list, appt)).toMatchObject({ source: 'booking', status: 'confirmed' });
    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(1);
  });

  it('a chat booking (source chat, the flow side) creates the contact and the row', async () => {
    const { BookingOffersService } = await import('../../../src/modules/appointments-booking');
    const offers = h.app.get(BookingOffersService);
    const chatType = await api.type(t.admin, { name: 'Chat intro' });
    const days = await offers.days(t.orgId, chatType.id);
    const times = await offers.times(t.orgId, chatType.id, days.days[1]!.date);
    const res = await offers.book(t.orgId, {
      typeId: chatType.id,
      startsAt: new Date(times.times[0]!.start),
      phone: '+919811200003',
      name: 'Chet Chat',
      answers: {},
    });
    expect(res.appointment.source).toBe('chat');
    const row = (
      await h.owner.query(
        `SELECT m.source, m.contact_id FROM contact_meetings m JOIN appointments a ON a.org_id = m.org_id AND a.id = m.appointment_id
          WHERE m.org_id = $1 AND a.uuid = $2`,
        [t.orgId, res.appointment.uuid],
      )
    ).rows;
    expect(row).toHaveLength(1);
    expect(row[0]!.source).toBe('booking');
  });

  it('a booking with no contact (no phone, no email) has no row', async () => {
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[2]!.start,
      invitee: { name: 'Walk In' },
    });
    expect(appt.contact).toBeNull();
    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(0);
  });
});

describe('the row follows the appointment (P1)', () => {
  let t: Tenant;
  let type: BookingType;
  let slots: Slot[];
  beforeAll(async () => {
    t = await api.signup('mmf');
    type = await api.type(t.admin, { name: 'Follow', locationType: 'virtual' });
    slots = await api.slots(t.admin, type.id);
  });

  it('reschedule moves the same row: still one, new times, one meeting update event', async () => {
    const [contactId] = await api.seedContacts(t, [{ name: 'Rita Move', phone: '+919811200010' }]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      contactId,
    });
    const before = bookedFor(await meetings(t.admin, contactId!), appt)!;
    const moved = await api.post(t.admin, `/v2/appointments/${appt.id}/reschedule`, {
      startsAt: slots[5]!.start,
      notify: false,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const list = await meetings(t.admin, contactId!);
    expect(list.data).toHaveLength(1);
    const after = bookedFor(list, appt)!;
    expect(after.id).toBe(before.id);
    expect(after.startsAt).toBe(new Date(slots[5]!.start).toISOString());
    expect(after.rowVersion).toBeGreaterThan(before.rowVersion);
    const updated = await eventsFor(t.orgId, 'contact_meeting.updated', appt.id);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ source: 'booking', appointmentId: appt.id });
  });

  it('editing the title and the place on the appointment reaches the row; a change that does not touch the row writes nothing', async () => {
    const [contactId] = await api.seedContacts(t, [{ name: 'Tess Edit', phone: '+919811200011' }]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[1]!.start,
      contactId,
    });
    const eventsBefore = (await eventsFor(t.orgId, 'contact_meeting.updated', appt.id)).length;
    const noteOnly = await api
      .as(t.admin)
      .patch(`/v2/appointments/${appt.id}`)
      .send({ notes: 'bring the file', rowVersion: appt.rowVersion });
    expect(noteOnly.status, JSON.stringify(noteOnly.body)).toBe(200);
    expect((await eventsFor(t.orgId, 'contact_meeting.updated', appt.id)).length).toBe(
      eventsBefore,
    );

    const edited = await api
      .as(t.admin)
      .patch(`/v2/appointments/${appt.id}`)
      .send({ title: 'Renamed visit', location: 'Room 4', rowVersion: noteOnly.body.rowVersion });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const m = bookedFor(await meetings(t.admin, contactId!), appt)!;
    expect(m).toMatchObject({ title: 'Renamed visit', location: 'Room 4' });
    expect((await eventsFor(t.orgId, 'contact_meeting.updated', appt.id)).length).toBe(
      eventsBefore + 1,
    );
    // The trail says that the title and place changed, never what they said.
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'contact_meetings' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(JSON.stringify(audit.rows[0]!.delta)).not.toContain('Renamed visit');
    expect(JSON.stringify(audit.rows[0]!.delta)).not.toContain('Room 4');
  });

  it('cancelling keeps the row, tagged cancelled, out of upcoming and in past; completing a confirmed one tags it completed', async () => {
    const [contactId] = await api.seedContacts(t, [
      { name: 'Cleo Cancel', phone: '+919811200012' },
    ]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[2]!.start,
      contactId,
    });
    expect((await meetings(t.admin, contactId!, '?when=upcoming')).data).toHaveLength(1);
    const cancelled = await api.post(t.admin, `/v2/appointments/${appt.id}/cancel`, {
      notify: false,
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    const all = await meetings(t.admin, contactId!);
    expect(all.data).toHaveLength(1);
    expect(bookedFor(all, appt)).toMatchObject({ status: 'cancelled', source: 'booking' });
    expect((await meetings(t.admin, contactId!, '?when=upcoming')).data).toHaveLength(0);
    const past = await meetings(t.admin, contactId!, '?when=past');
    expect(past.data.map((x) => x.appointmentId)).toEqual([appt.id]);
    // No second event for the same booking, and the row is still the one it was.
    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(1);
    expect(await eventsFor(t.orgId, 'contact_meeting.deleted', appt.id)).toHaveLength(0);

    const [other] = await api.seedContacts(t, [{ name: 'Cody Done', phone: '+919811200013' }]);
    const done = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[3]!.start,
      contactId: other,
    });
    await api.moveTo(done.id, -3);
    expect((await api.post(t.admin, `/v2/appointments/${done.id}/complete`, {})).status).toBe(200);
    expect(bookedFor(await meetings(t.admin, other!), done)).toMatchObject({ status: 'completed' });
  });

  it('a declined request keeps its row tagged declined and is not upcoming', async () => {
    const approvalType = await api.type(t.admin, {
      name: 'Needs approval',
      approvalRequired: true,
    });
    const s = await api.publicSlots(t.slug, approvalType.slug);
    const booked = await api.publicBooked(t.slug, approvalType.slug, {
      startsAt: s[0]!.start,
      name: 'Dev Decline',
      phone: '+919811200014',
      answers: {},
    });
    expect(booked.requiresApproval).toBe(true);
    const appt = (await api.as(t.admin).get('/v2/appointments?scope=all&q=Dev')).body
      .data[0] as Appointment;
    const contactId = appt.contact!.id;
    expect(bookedFor(await meetings(t.admin, contactId), appt)).toMatchObject({
      status: 'pending',
    });
    expect((await api.post(t.admin, `/v2/appointments/${appt.id}/decline`, {})).status).toBe(200);
    expect(bookedFor(await meetings(t.admin, contactId), appt)).toMatchObject({
      status: 'declined',
    });
    expect((await meetings(t.admin, contactId, '?when=upcoming')).data).toHaveLength(0);
  });

  it('changing the contact moves the row; removing it deletes the row; linking a contact later creates it', async () => {
    const [a, b] = await api.seedContacts(t, [
      { name: 'Alma First', phone: '+919811200015' },
      { name: 'Bram Second', phone: '+919811200016' },
    ]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      contactId: a,
    });
    const first = bookedFor(await meetings(t.admin, a!), appt)!;

    const toB = await api
      .as(t.admin)
      .patch(`/v2/appointments/${appt.id}`)
      .send({ contactId: b, rowVersion: appt.rowVersion });
    expect(toB.status, JSON.stringify(toB.body)).toBe(200);
    expect((await meetings(t.admin, a!)).data).toHaveLength(0);
    const moved = bookedFor(await meetings(t.admin, b!), appt)!;
    expect(moved.id).toBe(first.id);
    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(1);

    const none = await api
      .as(t.admin)
      .patch(`/v2/appointments/${appt.id}`)
      .send({ contactId: null, rowVersion: toB.body.rowVersion });
    expect(none.status, JSON.stringify(none.body)).toBe(200);
    expect((await meetings(t.admin, b!)).data).toHaveLength(0);
    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(0);
    expect(await eventsFor(t.orgId, 'contact_meeting.deleted', appt.id)).toHaveLength(1);

    const back = await api
      .as(t.admin)
      .patch(`/v2/appointments/${appt.id}`)
      .send({ contactId: a, rowVersion: none.body.rowVersion });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const again = bookedFor(await meetings(t.admin, a!), appt)!;
    expect(again).toBeDefined();
    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(1);
  });

  it('a booking made with no contact gets its row when a contact is linked later', async () => {
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[6]!.start,
      invitee: { name: 'Late Link' },
    });
    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(0);
    const [contactId] = await api.seedContacts(t, [
      { name: 'Lola Linked', phone: '+919811200017' },
    ]);
    const linked = await api
      .as(t.admin)
      .patch(`/v2/appointments/${appt.id}`)
      .send({ contactId, rowVersion: appt.rowVersion });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(bookedFor(await meetings(t.admin, contactId!), appt)).toMatchObject({
      source: 'booking',
      status: 'confirmed',
    });
  });

  it('deleting a finished appointment deletes its row with it; the foreign key alone would only orphan it', async () => {
    const [contactId] = await api.seedContacts(t, [
      { name: 'Dora Delete', phone: '+919811200018' },
    ]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[7]!.start,
      contactId,
    });
    expect((await api.as(t.admin).delete(`/v2/appointments/${appt.id}`)).status).toBe(409);
    expect(
      (await api.post(t.admin, `/v2/appointments/${appt.id}/cancel`, { notify: false })).status,
    ).toBe(200);
    expect((await api.as(t.admin).delete(`/v2/appointments/${appt.id}`)).status).toBe(204);
    expect((await meetings(t.admin, contactId!)).data).toHaveLength(0);
    expect(await eventsFor(t.orgId, 'contact_meeting.deleted', appt.id)).toHaveLength(1);
  });

  it('the database backstop: deleting an appointment behind the application keeps the meeting but unlinks it (ON DELETE SET NULL, org_id untouched)', async () => {
    const [contactId] = await api.seedContacts(t, [
      { name: 'Orla Orphan', phone: '+919811200019' },
    ]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[8]!.start,
      contactId,
    });
    await h.owner.query(`DELETE FROM appointments WHERE uuid = $1`, [appt.id]);
    const left = await meetings(t.admin, contactId!);
    expect(left.data).toHaveLength(1);
    expect(left.data[0]).toMatchObject({ source: 'booking', appointmentId: null, status: null });
  });
});

describe('one booking, one meeting: the unique index (P0)', () => {
  it('a second row for the same appointment is refused by the database, and syncing twice is idempotent', async () => {
    const t = await api.signup('mmu');
    const type = await api.type(t.admin, { name: 'Unique' });
    const slots = await api.slots(t.admin, type.id);
    const [contactId] = await api.seedContacts(t, [{ name: 'Uma Unique', phone: '+919811200020' }]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      contactId,
    });
    const dup = h.owner.query(
      `INSERT INTO contact_meetings (org_id, contact_id, title, source, appointment_id)
       SELECT m.org_id, m.contact_id, 'dup', 'booking', m.appointment_id FROM contact_meetings m
        JOIN appointments a ON a.org_id = m.org_id AND a.id = m.appointment_id WHERE a.uuid = $1`,
      [appt.id],
    );
    await expect(dup).rejects.toMatchObject({ code: '23505' });

    const mirror = h.app.get(AppointmentMeetingMirror);
    for (let i = 0; i < 3; i++) {
      await db.txAs({ orgId: t.orgId, userId: null }, async (tx) => {
        const row = (await apptsRepo.findByUuid(tx, t.orgId, appt.id))!;
        await mirror.sync(tx, t.orgId, row);
      });
    }
    expect(await rowsFor(t.orgId, appt.id)).toHaveLength(1);
    // Nothing changed, so nothing was announced again.
    expect(await eventsFor(t.orgId, 'contact_meeting.updated', appt.id)).toHaveLength(0);
    expect(await eventsFor(t.orgId, 'contact_meeting.created', appt.id)).toHaveLength(1);
  });

  it('a typed-in meeting can never carry an appointment id, and a booking row must name its source (check constraints)', async () => {
    const t = await api.signup('mmc');
    const type = await api.type(t.admin);
    const slots = await api.slots(t.admin, type.id);
    const [contactId] = await api.seedContacts(t, [{ name: 'Cora Check', phone: '+919811200021' }]);
    const appt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'x' },
    });
    const apptId = (await h.owner.query(`SELECT id FROM appointments WHERE uuid = $1`, [appt.id]))
      .rows[0].id;
    const contactRow = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactId]))
      .rows[0].id;
    await expect(
      h.owner.query(
        `INSERT INTO contact_meetings (org_id, contact_id, title, source, appointment_id) VALUES ($1,$2,'x','manual',$3)`,
        [t.orgId, contactRow, apptId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      h.owner.query(
        `INSERT INTO contact_meetings (org_id, contact_id, title, source) VALUES ($1,$2,'x','calendar')`,
        [t.orgId, contactRow],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('the back-fill of existing bookings (P1)', () => {
  it('writes the row for every non-closed booking with a contact, in every workspace, skips the rest, and a second run writes nothing', async () => {
    const [a, b] = [await api.signup('mba'), await api.signup('mbb')];
    const written: Array<{ t: Tenant; appt: Appointment; contact: string }> = [];
    for (const t of [a, b]) {
      const type = await api.type(t.admin, { name: 'Old booking' });
      const slots = await api.slots(t.admin, type.id);
      const [c1, c2, c3] = await api.seedContacts(t, [
        { name: 'Old One', phone: '+919811200030' },
        { name: 'Old Two', phone: '+919811200031' },
        { name: 'Old Three', phone: '+919811200032' },
      ]);
      const live = await api.staffBook(t.admin, {
        bookingTypeId: type.id,
        startsAt: slots[0]!.start,
        contactId: c1,
      });
      const closed = await api.staffBook(t.admin, {
        bookingTypeId: type.id,
        startsAt: slots[1]!.start,
        contactId: c2,
      });
      const noContact = await api.staffBook(t.admin, {
        bookingTypeId: type.id,
        startsAt: slots[2]!.start,
        invitee: { name: 'Nobody' },
      });
      const stays = await api.staffBook(t.admin, {
        bookingTypeId: type.id,
        startsAt: slots[3]!.start,
        contactId: c3,
      });
      expect(noContact.contact).toBeNull();
      await api.post(t.admin, `/v2/appointments/${closed.id}/cancel`, { notify: false });
      // The bookings predate the mirror: take every row away, as a database from before the release has none.
      await h.owner.query(`DELETE FROM contact_meetings WHERE org_id = $1 AND source = 'booking'`, [
        t.orgId,
      ]);
      expect(await rowsFor(t.orgId, live.id)).toHaveLength(0);
      written.push({ t, appt: live, contact: c1! }, { t, appt: stays, contact: c3! });
      // A typed-in meeting beside them is left alone.
      const typed = await api.post(t.admin, `/v2/contacts/${c1}/meetings`, { title: 'Typed in' });
      expect(typed.status, JSON.stringify(typed.body)).toBe(201);
      void closed;
    }

    const first = await backfill.run();
    expect(first.written).toBe(4);
    expect(first.next).toBeNull();
    for (const { t, appt, contact } of written) {
      const list = await meetings(t.admin, contact);
      const m = bookedFor(list, appt)!;
      expect(m).toMatchObject({ source: 'booking', status: 'confirmed', appointmentId: appt.id });
      // The back-filled row keeps the appointment's own creation time, not the time of the deploy.
      const created = (
        await h.owner.query(`SELECT created_at FROM appointments WHERE uuid = $1`, [appt.id])
      ).rows[0].created_at as Date;
      expect(new Date(m.createdAt).getTime()).toBe(created.getTime());
    }
    const closedRows = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_meetings m JOIN appointments a ON a.org_id = m.org_id AND a.id = m.appointment_id
        WHERE a.status IN ('cancelled','declined') AND m.org_id IN ($1, $2)`,
      [a.orgId, b.orgId],
    );
    expect(closedRows.rows[0].n).toBe(0);
    const typedLeft = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_meetings WHERE source = 'manual' AND title = 'Typed in' AND org_id IN ($1, $2)`,
      [a.orgId, b.orgId],
    );
    expect(typedLeft.rows[0].n).toBe(2);

    const second = await backfill.run();
    expect(second.written).toBe(0);
    const total = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_meetings WHERE source = 'booking' AND org_id IN ($1, $2)`,
      [a.orgId, b.orgId],
    );
    expect(total.rows[0].n).toBe(4);
  });

  it('batches: a small batch size resumes from where it stopped, and racing a live booking ends as one row', async () => {
    const t = await api.signup('mbc');
    const type = await api.type(t.admin, { name: 'Batch' });
    const slots = await api.slots(t.admin, type.id);
    const contacts = await api.seedContacts(
      t,
      [0, 1, 2, 3, 4].map((i) => ({ name: `Batch ${i}`, phone: `+91981120004${i}` })),
    );
    const appts: Appointment[] = [];
    for (const [i, c] of contacts.entries()) {
      appts.push(
        await api.staffBook(t.admin, {
          bookingTypeId: type.id,
          startsAt: slots[i]!.start,
          contactId: c,
        }),
      );
    }
    await h.owner.query(`DELETE FROM contact_meetings WHERE org_id = $1 AND source = 'booking'`, [
      t.orgId,
    ]);
    const first = await backfill.run(0, 2, 2);
    expect(first.scanned).toBeGreaterThan(0);
    expect(first.next).not.toBeNull();
    // A racing writer: the mirror creates one of the remaining rows between two batches.
    const mirror = h.app.get(AppointmentMeetingMirror);
    await db.txAs({ orgId: t.orgId, userId: null }, async (tx) => {
      const row = (await apptsRepo.findByUuid(tx, t.orgId, appts[4]!.id))!;
      await mirror.sync(tx, t.orgId, row);
    });
    const rest = await backfill.run(first.next!);
    expect(rest.next).toBeNull();
    for (const a of appts) expect(await rowsFor(t.orgId, a.id)).toHaveLength(1);
  });
});

describe('the list: order, window, paging (P0)', () => {
  let t: Tenant;
  let contactId: string;
  const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  const typed = async (title: string, startsAt?: string, endsAt?: string) => {
    const res = await api.post(t.admin, `/v2/contacts/${contactId}/meetings`, {
      title,
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Meeting;
  };
  beforeAll(async () => {
    t = await api.signup('mml');
    contactId = (await api.seedContacts(t, [{ name: 'Lena List', phone: '+919811200050' }]))[0]!;
    await typed('far future', at(72));
    await typed('soon', at(2), at(3));
    await typed('running now', at(-1), at(1));
    await typed('long ago', at(-100), at(-99));
    await typed('no time at all');
    const tieAt = at(10);
    await typed('tie a', tieAt);
    await typed('tie b', tieAt);
  });

  it('without `when` the list is what it always was: newest logged first', async () => {
    const list = await meetings(t.admin, contactId);
    expect(list.data.map((m) => m.title)).toEqual([
      'tie b',
      'tie a',
      'no time at all',
      'long ago',
      'running now',
      'soon',
      'far future',
    ]);
    expect(list.data.every((m) => m.source === 'manual' && m.appointmentId === null)).toBe(true);
    expect(list.data.every((m) => m.canManageBooking === false)).toBe(true);
  });

  it('upcoming: not over yet (a running meeting counts), soonest first, ties by when they were logged; no undated rows', async () => {
    const list = await meetings(t.admin, contactId, '?when=upcoming');
    expect(list.data.map((m) => m.title)).toEqual([
      'running now',
      'soon',
      'tie a',
      'tie b',
      'far future',
    ]);
  });

  it('past: dated and over, latest first', async () => {
    const list = await meetings(t.admin, contactId, '?when=past');
    expect(list.data.map((m) => m.title)).toEqual(['long ago']);
  });

  it('all: latest start first, ties newest logged first, undated last', async () => {
    const list = await meetings(t.admin, contactId, '?when=all');
    expect(list.data.map((m) => m.title)).toEqual([
      'far future',
      'tie b',
      'tie a',
      'soon',
      'running now',
      'long ago',
      'no time at all',
    ]);
  });

  it('pages of two follow the same order with no row lost or repeated, for every window', async () => {
    for (const when of ['upcoming', 'past', 'all']) {
      const whole = (await meetings(t.admin, contactId, `?when=${when}`)).data.map((m) => m.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page: MeetingPage = await meetings(
          t.admin,
          contactId,
          `?when=${when}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        seen.push(...page.data.map((m) => m.id));
        if (!page.page.hasMore) break;
        cursor = page.page.nextCursor;
        expect(cursor).toBeTruthy();
      }
      expect(seen, when).toEqual(whole);
    }
  });

  it('a cursor that is not ours, or an unknown window, is a 400', async () => {
    const bad = await api.as(t.admin).get(`/v2/contacts/${contactId}/meetings?when=all&cursor=abc`);
    expect(bad.status).toBe(400);
    const unknown = await api.as(t.admin).get(`/v2/contacts/${contactId}/meetings?when=soonish`);
    expect(unknown.status).toBe(422);
  });
});

describe('who sees a booked row, and what they may do with it (P1)', () => {
  let t: Tenant;
  let type: BookingType;
  let slots: Slot[];
  let contactId: string;
  let adminAppt: Appointment;
  beforeAll(async () => {
    t = await api.signup('mmp');
    type = await api.type(t.admin, { name: 'Perms' });
    slots = await api.slots(t.admin, type.id);
    contactId = (await api.seedContacts(t, [{ name: 'Pia Perms', phone: '+919811200060' }]))[0]!;
    adminAppt = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      contactId,
    });
  });

  it('a user who can read the contact but has no appointments permission sees the booked row, read-only', async () => {
    const reader = await api.member(t, 'mmreader', [['record.contacts.read']]);
    const list = await meetings(reader.token, contactId);
    const m = bookedFor(list, adminAppt)!;
    expect(m).toMatchObject({ source: 'booking', status: 'confirmed', canManageBooking: false });
    // The appointment itself is not theirs to read.
    expect((await api.as(reader.token).get(`/v2/appointments/${adminAppt.id}`)).status).toBe(403);
  });

  it('nobody edits or deletes a booked row through the meetings routes (409): not a contact editor, not the admin', async () => {
    const editor = await api.member(t, 'mmeditor', [
      ['record.contacts.read'],
      ['record.contacts.update'],
      ['record.appointments.read'],
      ['record.appointments.update'],
    ]);
    const m = bookedFor(await meetings(editor.token, contactId), adminAppt)!;
    for (const token of [editor.token, t.admin]) {
      const patch = await api
        .as(token)
        .patch(`/v2/contacts/${contactId}/meetings/${m.id}`)
        .send({ title: 'hijack', rowVersion: m.rowVersion });
      expect(patch.status, JSON.stringify(patch.body)).toBe(409);
      const del = await api.as(token).delete(`/v2/contacts/${contactId}/meetings/${m.id}`);
      expect(del.status, JSON.stringify(del.body)).toBe(409);
    }
    const still = bookedFor(await meetings(t.admin, contactId), adminAppt)!;
    expect(still.title).toBe(m.title);
  });

  it('canManageBooking follows record.appointments.update and its scope: own = hosted or booked by me', async () => {
    const agent = await api.member(t, 'mmagent', [
      ['record.booking-types.read'],
      ['record.contacts.read'],
      ['record.appointments.read', 'own'],
      ['record.appointments.create'],
      ['record.appointments.update', 'own'],
    ]);
    const mine = await api.staffBook(agent.token, {
      bookingTypeId: type.id,
      startsAt: slots[1]!.start,
      contactId,
    });
    const list = await meetings(agent.token, contactId);
    expect(bookedFor(list, mine)!.canManageBooking).toBe(true);
    expect(bookedFor(list, adminAppt)!.canManageBooking).toBe(false);
    // The admin (scope all) manages both.
    const admins = await meetings(t.admin, contactId);
    expect(bookedFor(admins, mine)!.canManageBooking).toBe(true);
    expect(bookedFor(admins, adminAppt)!.canManageBooking).toBe(true);
  });

  it('the contact scope still applies: a user whose scope does not reach the contact gets 404, booking or not', async () => {
    const own = await api.member(t, 'mmown', [['record.contacts.read', 'own']]);
    const res = await api.as(own.token).get(`/v2/contacts/${contactId}/meetings`);
    expect(res.status).toBe(404);
  });

  it('a typed-in meeting is still created, edited and deleted as before, and its events say source manual', async () => {
    const created = await api.post(t.admin, `/v2/contacts/${contactId}/meetings`, {
      title: 'By hand',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      source: 'manual',
      appointmentId: null,
      status: null,
      canManageBooking: false,
    });
    const patched = await api
      .as(t.admin)
      .patch(`/v2/contacts/${contactId}/meetings/${created.body.id}`)
      .send({ title: 'By hand, edited', rowVersion: created.body.rowVersion });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(
      (await api.as(t.admin).delete(`/v2/contacts/${contactId}/meetings/${created.body.id}`))
        .status,
    ).toBe(204);
    const evs = (await api.events(t.orgId, 'contact_meeting.created')).filter(
      (p) => p.uuid === created.body.id,
    );
    expect(evs[0]).toMatchObject({ source: 'manual', appointmentId: null });
  });
});

describe('tenant isolation', () => {
  it("another workspace cannot list a contact's meetings, and its own contacts never show a foreign booking", async () => {
    const a = await api.signup('mia');
    const b = await api.signup('mib');
    const type = await api.type(a.admin);
    const slots = await api.slots(a.admin, type.id);
    const [contactId] = await api.seedContacts(a, [{ name: 'Iso Late', phone: '+919811200070' }]);
    const appt = await api.staffBook(a.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      contactId,
    });

    expect((await api.as(b.admin).get(`/v2/contacts/${contactId}/meetings`)).status).toBe(404);
    const [bContact] = await api.seedContacts(b, [{ name: 'Iso Mate', phone: '+919811200071' }]);
    expect((await meetings(b.admin, bContact!)).data).toHaveLength(0);
    // The foreign key is composite: a row cannot point at another workspace's appointment even by a direct write.
    const apptId = (await h.owner.query(`SELECT id FROM appointments WHERE uuid = $1`, [appt.id]))
      .rows[0].id;
    const bContactId = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [bContact]))
      .rows[0].id;
    await expect(
      h.owner.query(
        `INSERT INTO contact_meetings (org_id, contact_id, title, source, appointment_id) VALUES ($1,$2,'x','booking',$3)`,
        [b.orgId, bContactId, apptId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
