import { describe, expect, it } from 'vitest';
import {
  availabilityListSchema,
  createAppointmentSchema,
  createBookingTypeSchema,
  dateOverrideSchema,
  listAppointmentsQuerySchema,
  previewSlotsSchema,
  publicBookInputSchema,
  slotsQuerySchema,
  updateBookingTypeSchema,
} from '@crm/contracts';

const uuid = '5c1e7a40-1111-4222-8333-444455556666';

describe('booking type contracts (WD-APPT-006..015)', () => {
  const ok = { name: 'Demo', durationMinutes: 30 };

  it("applies WaDesk's defaults", () => {
    const r = createBookingTypeSchema.parse(ok);
    expect(r).toMatchObject({
      locationType: 'address',
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minNoticeMinutes: 240,
      maxAdvanceDays: 30,
      capacity: 1,
      approvalRequired: false,
      isActive: true,
    });
  });

  it('enforces the ranges (5-1440 minutes, 1-365 days, capacity 1-500, a real zone, #RRGGBB)', () => {
    for (const bad of [
      { durationMinutes: 4 },
      { durationMinutes: 1441 },
      { maxAdvanceDays: 0 },
      { maxAdvanceDays: 366 },
      { capacity: 0 },
      { capacity: 501 },
      { maxPerDay: 0 },
      { timezone: 'Mars/Phobos' },
      { color: 'green' },
      { locationType: 'moon' },
      { name: '   ' },
    ]) {
      expect(
        createBookingTypeSchema.safeParse({ ...ok, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
    expect(
      createBookingTypeSchema.safeParse({
        ...ok,
        timezone: 'Asia/Kolkata',
        color: '#075E54',
        locationType: 'whatsapp',
      }).success,
    ).toBe(true);
  });

  it('weekly intervals: weekday 0-6, HH:MM, to after from, no overlap (WaDesk checked none of it)', () => {
    const w = (weekday: number, from: string, to: string) => ({ weekday, from, to });
    expect(
      availabilityListSchema.safeParse([w(1, '09:00', '12:00'), w(1, '13:00', '17:00')]).success,
    ).toBe(true);
    expect(availabilityListSchema.safeParse([w(7, '09:00', '12:00')]).success).toBe(false);
    expect(availabilityListSchema.safeParse([w(1, '12:00', '09:00')]).success).toBe(false);
    expect(availabilityListSchema.safeParse([w(1, '09:00', '09:00')]).success).toBe(false);
    expect(availabilityListSchema.safeParse([w(1, '9:00', '12:00')]).success).toBe(false);
    expect(
      availabilityListSchema.safeParse([w(1, '09:00', '12:00'), w(1, '11:00', '14:00')]).success,
    ).toBe(false);
    // Touching intervals are fine; the same hours on another weekday are not an overlap.
    expect(
      availabilityListSchema.safeParse([
        w(1, '09:00', '12:00'),
        w(1, '12:00', '14:00'),
        w(2, '09:00', '12:00'),
      ]).success,
    ).toBe(true);
  });

  it('overrides: a closed date has no hours, special hours need both and an order (D-03)', () => {
    expect(dateOverrideSchema.safeParse({ date: '2026-12-25', isClosed: true }).success).toBe(true);
    expect(
      dateOverrideSchema.safeParse({
        date: '2026-12-25',
        isClosed: true,
        from: '09:00',
        to: '10:00',
      }).success,
    ).toBe(false);
    expect(
      dateOverrideSchema.safeParse({ date: '2026-12-24', from: '09:00', to: '12:00' }).success,
    ).toBe(true);
    expect(dateOverrideSchema.safeParse({ date: '2026-12-24', from: '09:00' }).success).toBe(false);
    expect(
      dateOverrideSchema.safeParse({ date: '2026-12-24', from: '12:00', to: '09:00' }).success,
    ).toBe(false);
    expect(dateOverrideSchema.safeParse({ date: '2026-02-30', isClosed: true }).success).toBe(
      false,
    );
  });

  it('reminders: distinct offsets, at most eight, 1 minute to 30 days', () => {
    const r = (m: number) => ({ offsetMinutes: m });
    expect(createBookingTypeSchema.safeParse({ ...ok, reminders: [r(1440), r(180)] }).success).toBe(
      true,
    );
    expect(createBookingTypeSchema.safeParse({ ...ok, reminders: [r(60), r(60)] }).success).toBe(
      false,
    );
    expect(
      createBookingTypeSchema.safeParse({
        ...ok,
        reminders: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => r(i + 1)),
      }).success,
    ).toBe(false);
    expect(createBookingTypeSchema.safeParse({ ...ok, reminders: [r(0)] }).success).toBe(false);
    expect(createBookingTypeSchema.safeParse({ ...ok, reminders: [r(43_201)] }).success).toBe(
      false,
    );
  });

  it('questions: a select needs options; the mapping is name, email or phone', () => {
    expect(
      createBookingTypeSchema.safeParse({ ...ok, questions: [{ label: 'Pick', type: 'select' }] })
        .success,
    ).toBe(false);
    expect(
      createBookingTypeSchema.safeParse({
        ...ok,
        questions: [{ label: 'Pick', type: 'select', options: ['A'] }],
      }).success,
    ).toBe(true);
    expect(
      createBookingTypeSchema.safeParse({
        ...ok,
        questions: [{ label: 'Mail', type: 'email', mapToContactField: 'email' }],
      }).success,
    ).toBe(true);
    expect(
      createBookingTypeSchema.safeParse({
        ...ok,
        questions: [{ label: 'Mail', type: 'email', mapToContactField: 'mobile' }],
      }).success,
    ).toBe(false);
  });

  it('money is a decimal string, never a number (D-11)', () => {
    expect(
      createBookingTypeSchema.safeParse({
        ...ok,
        payment: { fee: '150.00', taxPercent: '18', depositMode: 'partial', deposit: '30' },
      }).success,
    ).toBe(true);
    expect(createBookingTypeSchema.safeParse({ ...ok, payment: { fee: 150 } }).success).toBe(false);
    expect(createBookingTypeSchema.safeParse({ ...ok, payment: { fee: '-1' } }).success).toBe(
      false,
    );
    expect(
      createBookingTypeSchema.safeParse({ ...ok, payment: { taxPercent: '101' } }).success,
    ).toBe(false);
    expect(createBookingTypeSchema.safeParse({ ...ok, payment: { currency: 'inr' } }).success).toBe(
      true,
    );
    expect(
      createBookingTypeSchema.safeParse({ ...ok, payment: { currency: 'RUPEE' } }).success,
    ).toBe(false);
  });

  it('an update needs the row version and keeps what it does not name', () => {
    expect(updateBookingTypeSchema.safeParse({ name: 'x' }).success).toBe(false);
    const r = updateBookingTypeSchema.parse({ rowVersion: 2 });
    expect(r.availability).toBeUndefined();
    expect(r.overrides).toBeUndefined();
  });
});

describe('appointment and public contracts', () => {
  it('staff create needs a contact or an invitee, and a time with an offset', () => {
    const base = { bookingTypeId: uuid, startsAt: '2026-10-05T03:30:00Z' };
    expect(createAppointmentSchema.safeParse(base).success).toBe(false);
    expect(
      createAppointmentSchema.safeParse({
        ...base,
        invitee: { name: 'Ana', phone: '+919800000001' },
      }).success,
    ).toBe(true);
    expect(createAppointmentSchema.safeParse({ ...base, contactId: uuid }).success).toBe(true);
    expect(
      createAppointmentSchema.safeParse({
        ...base,
        startsAt: '2026-10-05T03:30:00',
        contactId: uuid,
      }).success,
    ).toBe(false);
  });

  it('a public booking needs a name and an email or a phone number', () => {
    const base = { startsAt: '2026-10-05T03:30:00Z', name: 'Pat' };
    expect(publicBookInputSchema.safeParse(base).success).toBe(false);
    expect(publicBookInputSchema.safeParse({ ...base, email: 'pat@example.com' }).success).toBe(
      true,
    );
    expect(publicBookInputSchema.safeParse({ ...base, phone: '+14155550100' }).success).toBe(true);
    expect(publicBookInputSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(publicBookInputSchema.safeParse({ ...base, name: '', email: 'a@b.co' }).success).toBe(
      false,
    );
    expect(
      publicBookInputSchema.safeParse({ ...base, email: 'a@b.co', timezone: 'Nowhere/Land' })
        .success,
    ).toBe(false);
    expect(publicBookInputSchema.parse({ ...base, email: 'PAT@Example.com' }).email).toBe(
      'pat@example.com',
    );
  });

  it('list query: defaults to upcoming, 50 a page; status is a list; booleans read from a query string', () => {
    const q = listAppointmentsQuerySchema.parse({});
    expect(q).toMatchObject({ scope: 'upcoming', limit: 50 });
    expect(
      listAppointmentsQuerySchema.parse({
        status: 'pending,confirmed',
        mine: 'false',
        needsReview: 'true',
      }),
    ).toMatchObject({
      status: ['pending', 'confirmed'],
      mine: false,
      needsReview: true,
    });
    expect(listAppointmentsQuerySchema.safeParse({ status: 'bogus' }).success).toBe(false);
    expect(listAppointmentsQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('slots query takes local dates; the preview takes 1 to 14 days', () => {
    expect(slotsQuerySchema.safeParse({ from: '2026-10-05', to: '2026-10-19' }).success).toBe(true);
    expect(slotsQuerySchema.safeParse({ from: '2026-10-5' }).success).toBe(false);
    const d = previewSlotsSchema.parse({ draft: { durationMinutes: 30 } });
    expect(d.days).toBe(7);
    expect(d.draft.availability).toEqual([]);
    expect(previewSlotsSchema.safeParse({ draft: { durationMinutes: 30 }, days: 15 }).success).toBe(
      false,
    );
  });
});
