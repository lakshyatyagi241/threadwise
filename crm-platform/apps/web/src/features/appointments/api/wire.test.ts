import {
  appointmentResponseSchema,
  bookingTypeResponseSchema,
  calendarListResponseSchema,
  calendarStatusResponseSchema,
  createBookingTypeSchema,
  listAppointmentsQuerySchema,
  appointmentCountsQuerySchema,
  previewSlotsSchema,
  publicBookInputSchema,
  publicBookingTypeSchema,
  publicManageViewSchema,
  slotsResponseSchema,
  updateBookingTypeSchema,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { newDraft, draftToInput, typeToDraft, validateDraft } from '../lib/booking-form';
import { withAnswerIndexes } from './real-service';
import type { PublicBookInput } from './schemas';
import {
  countParams,
  duplicateOf,
  listParams,
  slotQuery,
  toAppointment,
  toCalendar,
  toCalendarOptions,
  toBookBody,
  toBookingType,
  toPreviewBody,
  toPublicManage,
  toPublicType,
  toSlotList,
  toTypeBody,
} from './wire';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-02T10:00:00.000Z';

const typeWire = bookingTypeResponseSchema.parse({
  id: U(1),
  name: 'Site visit',
  slug: 'site-visit',
  description: null,
  locationType: 'whatsapp',
  locationValue: null,
  color: '#C2410C',
  introMessage: 'Hello',
  durationMinutes: 60,
  incrementMinutes: 60,
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 15,
  minNoticeMinutes: 240,
  maxAdvanceDays: 30,
  maxPerDay: null,
  capacity: 1,
  timezone: null,
  effectiveTimezone: 'Asia/Kolkata',
  approvalRequired: true,
  isActive: true,
  sortOrder: 0,
  host: null,
  publicPath: '/book/acme/site-visit',
  publicUrl: 'http://localhost:3001/book/acme/site-visit',
  availability: [{ weekday: 1, from: '09:00', to: '17:00' }],
  overrides: [{ date: '2026-12-25', isClosed: true, from: null, to: null, reason: 'Christmas' }],
  questions: [
    {
      id: U(2),
      label: 'Phone',
      type: 'phone',
      options: null,
      required: true,
      mapToContactField: 'phone',
      sortOrder: 0,
    },
    {
      id: U(3),
      label: 'Size',
      type: 'select',
      options: ['S', 'L'],
      required: false,
      mapToContactField: null,
      sortOrder: 1,
    },
  ],
  reminders: [
    { id: U(4), offsetMinutes: 1440, label: '24h', isActive: true },
    { id: U(5), offsetMinutes: 60, label: null, isActive: false },
  ],
  templates: [
    {
      event: 'reminder',
      channel: 'email',
      waTemplateId: null,
      plainBody: 'See you {{slot}}',
      variableMap: null,
    },
  ],
  payment: {
    currency: 'INR',
    fee: '1500.00',
    taxPercent: '18',
    total: '1770.00',
    gatewaySlug: null,
    depositMode: 'partial',
    deposit: '500.00',
    dueNow: '500.00',
    autoSendLink: true,
    cancelFee: '200.00',
    noShowFee: '0.00',
    cancelWindowMinutes: 1440,
  },
  calendar: { calendarId: null, createMeet: false, spreadsheetId: null, sheetRange: 'Sheet1!A1' },
  appointmentsCount: 4,
  upcomingCount: 1,
  rowVersion: 3,
  createdAt: NOW,
  updatedAt: NOW,
});

describe('booking type from the API', () => {
  it('becomes the screens model: minor units, closed, requiresApproval, the zone the hours are read in', () => {
    const t = toBookingType(typeWire);
    expect(t).toMatchObject({
      requiresApproval: true,
      timezone: 'Asia/Kolkata',
      locationType: 'whatsapp',
      rowVersion: 3,
      appointmentsCount: 4,
      publicUrl: 'http://localhost:3001/book/acme/site-visit',
    });
    expect(t.price).toMatchObject({
      currency: 'INR',
      feeMinor: 150000,
      taxPct: 18,
      depositMode: 'partial',
      depositValueMinor: 50000,
      cancelFeeMinor: 20000,
    });
    expect(t.overrides).toEqual([
      { date: '2026-12-25', closed: true, from: null, to: null, reason: 'Christmas' },
    ]);
    // Only active reminders; Reference's "mobile" is the API's phone.
    expect(t.reminders).toEqual([{ offsetMinutes: 1440, label: '24h' }]);
    expect(t.questions.map((q) => [q.id, q.mapToContactField, q.options])).toEqual([
      [U(2), 'mobile', []],
      [U(3), null, ['S', 'L']],
    ]);
  });

  it('has no public link while paused', () => {
    expect(toBookingType({ ...typeWire, isActive: false }).publicUrl).toBeNull();
  });

  it('round-trips through the editor draft into a body the API accepts', () => {
    const draft = typeToDraft(toBookingType(typeWire));
    expect(validateDraft(draft)).toEqual({});
    const create = toTypeBody(draftToInput(draft));
    expect(createBookingTypeSchema.safeParse(create).success).toBe(true);
    expect(create.payment).toMatchObject({
      currency: 'INR',
      fee: '1500.00',
      taxPercent: '18',
      depositMode: 'partial',
      deposit: '500.00',
      cancelFee: '200.00',
    });
    expect(create.approvalRequired).toBe(true);
    expect(create.overrides).toEqual([
      { date: '2026-12-25', isClosed: true, from: null, to: null, reason: 'Christmas' },
    ]);
    expect(create.questions?.map((q) => [q.id, q.mapToContactField])).toEqual([
      [U(2), 'phone'],
      [U(3), null],
    ]);

    const update = toTypeBody(draftToInput(draft), 3);
    const parsed = updateBookingTypeSchema.safeParse(update);
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues)).toBe(true);
    expect(update.rowVersion).toBe(3);
  });

  it('sends a closed day without hours and a select question with its choices only', () => {
    const t = toBookingType(typeWire);
    const body = toTypeBody({
      ...draftToInput(typeToDraft(t)),
      overrides: [{ date: '2026-12-26', closed: true, from: '09:00', to: '10:00', reason: null }],
    });
    expect(body.overrides?.[0]).toMatchObject({ isClosed: true, from: null, to: null });
    const q = toTypeBody(
      draftToInput({
        ...typeToDraft(t),
        questions: [
          { id: 'a', label: 'X', type: 'text', optionsText: 'a\nb', required: true, map: '' },
        ],
      }),
    );
    expect(q.questions?.[0]).toMatchObject({ type: 'text', options: null });
  });

  it('a brand new type is a valid create', () => {
    const body = toTypeBody(
      draftToInput({ ...newDraft({ timezone: 'UTC', currency: 'USD' }), name: 'Demo' }),
    );
    const parsed = createBookingTypeSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues)).toBe(true);
  });

  it('duplicates as a paused copy with new questions', () => {
    const copy = duplicateOf(toBookingType(typeWire));
    expect(copy).toMatchObject({ name: 'Site visit (copy)', slug: '', isActive: false });
    expect(copy.questions.every((q) => !('id' in q))).toBe(true);
    expect(createBookingTypeSchema.safeParse(toTypeBody(copy)).success).toBe(true);
  });

  it('builds a preview body the API accepts', () => {
    const d = draftToInput({
      ...newDraft({ timezone: 'Asia/Kolkata', currency: 'INR' }),
      name: 'x',
    });
    const body = toPreviewBody(
      {
        timezone: 'Asia/Kolkata',
        durationMinutes: 30,
        incrementMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minNoticeMinutes: 0,
        maxAdvanceDays: 30,
        maxPerDay: null,
        capacity: 1,
        availability: d.availability,
        overrides: [{ date: '2026-12-25', closed: true, from: null, to: null, reason: null }],
      },
      7,
    );
    expect(previewSlotsSchema.safeParse(body).success).toBe(true);
  });
});

describe('appointment from the API', () => {
  const wire = appointmentResponseSchema.parse({
    id: U(10),
    status: 'confirmed',
    title: 'Site visit - Ana',
    description: null,
    startsAt: '2026-10-05T09:00:00.000Z',
    endsAt: '2026-10-05T10:00:00.000Z',
    timezone: 'Asia/Kolkata',
    inviteeTimezone: 'Europe/Madrid',
    location: '12 MG Road',
    meetUrl: null,
    bookingType: {
      id: U(1),
      name: 'Site visit',
      color: '#C2410C',
      durationMinutes: 60,
      locationType: 'address',
    },
    seat: 1,
    invitee: { name: 'Ana', email: 'ana@acme.test', phone: '+34600111222' },
    contact: { id: U(20), name: 'Ana Lopez' },
    host: { id: U(21), name: 'Priya' },
    source: 'link',
    answers: [{ questionId: U(2), label: 'Phone', type: 'phone', value: '+34600111222' }],
    notes: 'Bring the plan',
    payment: {
      status: 'partial',
      currency: 'INR',
      total: '1770.00',
      dueNow: '500.00',
      paid: '500.00',
      feeRecorded: '0.00',
      holdExpiresAt: null,
    },
    needsReview: true,
    checkedInAt: null,
    statusChangedAt: NOW,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    calendar: { eventId: null, calendarId: null },
    manageUrl: 'http://localhost:3001/b/manage/abc',
    rowVersion: 2,
    createdAt: NOW,
    updatedAt: NOW,
  });

  it('maps people, answers, payment and flags', () => {
    const a = toAppointment(wire);
    expect(a.customer).toEqual({ name: 'Ana', email: 'ana@acme.test', phone: '+34600111222' });
    expect(a.contact).toMatchObject({ id: U(20), name: 'Ana Lopez' });
    expect(a.answers).toEqual([{ label: 'Phone', answer: '+34600111222', questionId: U(2) }]);
    expect(a).toMatchObject({
      paymentStatus: 'partial',
      depositPaidMinor: 50000,
      currency: 'INR',
      needsReview: true,
      source: 'link',
      rowVersion: 2,
    });
    expect(a.host?.name).toBe('Priya');
  });

  it('turns the screen query into the API query', () => {
    const upcoming = listParams({
      tab: 'upcoming',
      typeId: U(1),
      q: 'ana',
      limit: 25,
      cursor: 'c',
    });
    expect(upcoming).toMatchObject({
      scope: 'upcoming',
      bookingTypeId: U(1),
      q: 'ana',
      limit: 25,
      cursor: 'c',
    });
    expect(listAppointmentsQuerySchema.safeParse(upcoming).success).toBe(true);
    const past = listParams({ tab: 'past', status: 'cancelled' });
    expect(past).toMatchObject({ scope: 'past', status: 'cancelled' });
    const range = listParams({
      from: '2026-10-05T00:00:00.000Z',
      to: '2026-10-12T00:00:00.000Z',
      status: 'pending,confirmed',
      limit: 200,
    });
    expect(range).toMatchObject({
      scope: 'all',
      from: '2026-10-05T00:00:00.000Z',
      status: 'pending,confirmed',
    });
    const parsed = listAppointmentsQuerySchema.safeParse(range);
    expect(parsed.success && parsed.data.status).toEqual(['pending', 'confirmed']);
    expect(
      appointmentCountsQuerySchema.safeParse(countParams({ typeId: U(1), q: 'x' })).success,
    ).toBe(true);
  });
});

describe('slots', () => {
  const wire = slotsResponseSchema.parse({
    timezone: 'Asia/Kolkata',
    durationMinutes: 30,
    days: [
      {
        date: '2026-10-06',
        slots: [
          { start: '2026-10-06T04:00:00.000Z', end: '2026-10-06T04:30:00.000Z', remaining: 2 },
        ],
      },
      {
        date: '2026-10-05',
        slots: [
          { start: '2026-10-05T04:00:00.000Z', end: '2026-10-05T04:30:00.000Z', remaining: 1 },
        ],
      },
    ],
  });

  it('asks for local dates a day either side of the instants', () => {
    expect(slotQuery({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' })).toEqual(
      { from: '2026-09-30', to: '2026-11-01' },
    );
  });

  it('flattens the days in time order and keeps only starts inside the instants', () => {
    const all = toSlotList(wire);
    expect(all.slots.map((s) => s.start)).toEqual([
      '2026-10-05T04:00:00.000Z',
      '2026-10-06T04:00:00.000Z',
    ]);
    expect(all.timezone).toBe('Asia/Kolkata');
    const some = toSlotList(wire, {
      from: '2026-10-06T00:00:00.000Z',
      to: '2026-10-07T00:00:00.000Z',
    });
    expect(some.slots).toHaveLength(1);
    expect(some.slots[0]!.remaining).toBe(2);
  });
});

describe('the visitor pages', () => {
  const service = publicBookingTypeSchema.parse({
    slug: 'site-visit',
    name: 'Site visit',
    description: null,
    introMessage: null,
    durationMinutes: 60,
    locationType: 'address',
    locationValue: '12 MG Road',
    color: null,
    timezone: 'Asia/Kolkata',
    approvalRequired: true,
    price: { currency: 'INR', total: '1770.00', dueNow: '500.00' },
    questions: [{ id: U(2), label: 'Size', type: 'select', options: ['S', 'L'], required: true }],
  });

  it('shows the total as the fee and the deposit as due now', () => {
    const t = toPublicType(service);
    expect(t).toMatchObject({
      requiresApproval: true,
      currency: 'INR',
      feeMinor: 177000,
      taxPct: 0,
      dueNowMinor: 50000,
    });
    expect(t.questions[0]).toMatchObject({ id: U(2), options: ['S', 'L'] });
    expect(toPublicType({ ...service, price: null })).toMatchObject({
      currency: null,
      feeMinor: 0,
      dueNowMinor: 0,
    });
  });

  it('sends answers keyed by question id and leaves empty details out', () => {
    const input: PublicBookInput = {
      startsAt: '2026-10-05T04:00:00.000Z',
      name: 'Ana',
      email: 'ana@acme.test',
      phone: '',
      inviteeTimezone: 'Europe/Madrid',
      answers: [
        { label: 'Size', answer: 'S', questionId: U(2) },
        { label: 'Loose', answer: 'x' },
      ],
    };
    const body = toBookBody(input);
    expect(body.answers).toEqual({ [U(2)]: 'S' });
    expect(body.phone).toBeNull();
    expect(body.timezone).toBe('Europe/Madrid');
    expect(publicBookInputSchema.safeParse(body).success).toBe(true);
  });

  it('moves a server error about a question id onto the position the form knows', () => {
    const input: PublicBookInput = {
      startsAt: 'x',
      name: 'x',
      email: 'x',
      inviteeTimezone: 'UTC',
      answers: [
        { label: 'A', answer: '1', questionId: U(7) },
        { label: 'B', answer: '2', questionId: U(8) },
      ],
    };
    const err = new ApiError(422, 'VALIDATION_FAILED', 'bad', 'r1', [
      { path: `answers.${U(8)}`, message: 'required' },
      { path: 'email', message: 'invalid' },
    ]);
    const out = withAnswerIndexes(err, input) as ApiError;
    expect(out.fieldErrors).toEqual([
      { path: 'answers.1', message: 'required' },
      { path: 'email', message: 'invalid' },
    ]);
    expect(out.status).toBe(422);
    expect(out.requestId).toBe('r1');
    // Anything else passes through untouched.
    const plain = new Error('x');
    expect(withAnswerIndexes(plain, input)).toBe(plain);
  });

  it('builds the manage page from the view and the token in the address', () => {
    const view = publicManageViewSchema.parse({
      status: 'confirmed',
      organization: { name: 'Acme' },
      bookingType: {
        name: 'Site visit',
        durationMinutes: 60,
        locationType: 'address',
        locationValue: '12 MG Road',
      },
      title: 'Site visit',
      startsAt: '2026-10-05T04:00:00.000Z',
      endsAt: '2026-10-05T05:00:00.000Z',
      timezone: 'Asia/Kolkata',
      meetUrl: null,
      canCancel: true,
      canReschedule: false,
      cancelFee: { currency: 'INR', amount: '200.00' },
    });
    const m = toPublicManage(view, 'tok123');
    expect(m.org.name).toBe('Acme');
    expect(m.booking).toMatchObject({
      typeName: 'Site visit',
      location: '12 MG Road',
      manageToken: 'tok123',
      canCancel: true,
      canReschedule: false,
      cancelFee: { currency: 'INR', amount: '200.00' },
    });
    expect(m.booking.manageUrl.endsWith('/b/manage/tok123')).toBe(true);
  });
});

describe('the Google Calendar link', () => {
  it('reads the server status as the card shows it', () => {
    const wire = calendarStatusResponseSchema.parse({
      provider: 'google',
      connected: true,
      account: 'ana@example.com',
      status: 'connected',
      calendarId: 'team@example.com',
      calendarName: 'Team calendar',
      connectedAt: NOW,
    });
    expect(toCalendar(wire)).toEqual({
      provider: 'google',
      status: 'connected',
      account: 'ana@example.com',
      calendarId: 'team@example.com',
      calendarName: 'Team calendar',
      connectedAt: NOW,
    });
  });

  it('keeps a grant that needs reconnecting visible with its account, and an unavailable one empty', () => {
    const refused = calendarStatusResponseSchema.parse({
      provider: 'google',
      connected: false,
      account: 'ana@example.com',
      status: 'needs_reconnect',
      calendarId: 'primary',
      calendarName: null,
      connectedAt: NOW,
    });
    expect(toCalendar(refused)).toMatchObject({
      status: 'needs_reconnect',
      account: 'ana@example.com',
    });
    const none = calendarStatusResponseSchema.parse({
      provider: 'google',
      connected: false,
      account: null,
      status: 'unavailable',
      calendarId: null,
      calendarName: null,
      connectedAt: null,
    });
    expect(toCalendar(none)).toMatchObject({
      status: 'unavailable',
      account: null,
      connectedAt: null,
    });
  });

  it('rejects a status this app does not know (the contract is the authority)', () => {
    expect(
      calendarStatusResponseSchema.safeParse({
        provider: 'google',
        connected: false,
        account: null,
        status: 'broken',
        calendarId: null,
        calendarName: null,
        connectedAt: null,
      }).success,
    ).toBe(false);
  });

  it('lists the calendars for the picker without the access role', () => {
    const wire = calendarListResponseSchema.parse({
      data: [
        {
          id: 'ana@example.com',
          name: 'ana@example.com',
          primary: true,
          timezone: 'UTC',
          accessRole: 'owner',
        },
        {
          id: 'team@example.com',
          name: 'Team',
          primary: false,
          timezone: null,
          accessRole: 'writer',
        },
      ],
    });
    expect(toCalendarOptions(wire)).toEqual([
      { id: 'ana@example.com', name: 'ana@example.com', primary: true, timezone: 'UTC' },
      { id: 'team@example.com', name: 'Team', primary: false, timezone: null },
    ]);
  });
});
