import type { z } from 'zod';
import type {
  AppointmentResponse,
  BookingTypeResponse,
  CalendarListResponse,
  CalendarStatusResponse,
  PublicBookResponse,
  PublicBookingPage,
  PublicBookingType,
  PublicManageView,
  SlotsResponse,
  createBookingTypeSchema,
  previewSlotsSchema,
  publicBookInputSchema,
  updateBookingTypeSchema,
} from '@crm/contracts';
import type { Slot } from '../lib/slots';
import { minorToInput, parseMajor } from '../lib/money';
import { addDays, dayKeyOf } from '../lib/zone';
import type {
  Appointment,
  CalendarConnection,
  CalendarOption,
  BookingType,
  BookingTypeInput,
  PreviewDraft,
  PublicBooking,
  PublicBookInput,
  PublicDirectory,
  PublicManage,
  PublicType,
  PublicTypePage,
  SlotList,
} from './schemas';

/**
 * The seam between the API's wire format (`@crm/contracts`: decimal-string money, grouped slot days, `isClosed`, answers keyed
 * by question id) and the shapes the screens work with (`./schemas`: integer minor units, flat slots, `closed`, answers with
 * labels). Everything that reads or writes the real API converts here, and nowhere else, so a contract change lands in one file.
 */

const minor = (value: string, currency: string | null): number =>
  parseMajor(value, currency ?? 'USD') ?? 0;
const major = (value: number, currency: string): string => minorToInput(value, currency);

// ---- appointments --------------------------------------------------------------------------------------------------

export function toAppointment(r: AppointmentResponse): Appointment {
  const cur = r.payment.currency;
  return {
    id: r.id,
    rowVersion: r.rowVersion,
    status: r.status,
    title: r.title,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    timezone: r.timezone,
    inviteeTimezone: r.inviteeTimezone,
    bookingType: r.bookingType
      ? {
          id: r.bookingType.id,
          name: r.bookingType.name,
          color: r.bookingType.color,
          durationMinutes: r.bookingType.durationMinutes,
        }
      : null,
    contact: r.contact
      ? { id: r.contact.id, name: r.contact.name, phone: null, email: null }
      : null,
    customer: { name: r.invitee.name, phone: r.invitee.phone, email: r.invitee.email },
    location: r.location,
    meetUrl: r.meetUrl,
    calendarSync: r.calendar.sync ?? null,
    answers: r.answers.map((a) => ({
      label: a.label,
      answer: a.value,
      ...(a.questionId ? { questionId: a.questionId } : {}),
    })),
    notes: r.notes,
    source: r.source,
    paymentStatus: r.payment.status,
    depositPaidMinor: minor(r.payment.paid, cur),
    currency: cur,
    manageUrl: r.manageUrl,
    checkedInAt: r.checkedInAt,
    needsReview: r.needsReview,
    host: r.host,
    cancelledBy: r.cancelledBy,
    cancelReason: r.cancelReason,
    cancelledAt: r.cancelledAt,
    ...(r.reminders ? { reminders: r.reminders } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** The list query the API reads: `tab` is its `scope`, `typeId` its `bookingTypeId`; a range lists every status in it. */
export function listParams(
  q: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {
    limit: typeof q.limit === 'number' ? q.limit : undefined,
    cursor: typeof q.cursor === 'string' ? q.cursor : undefined,
    q: typeof q.q === 'string' ? q.q : undefined,
    bookingTypeId: typeof q.typeId === 'string' ? q.typeId : undefined,
    status: typeof q.status === 'string' ? q.status : undefined,
  };
  if (typeof q.from === 'string') {
    out.scope = 'all';
    out.from = q.from;
    out.to = typeof q.to === 'string' ? q.to : undefined;
  } else out.scope = q.tab === 'past' ? 'past' : 'upcoming';
  return out;
}

export function countParams(
  q: Record<string, string | number | boolean | undefined>,
): Record<string, string | undefined> {
  return {
    q: typeof q.q === 'string' ? q.q : undefined,
    bookingTypeId: typeof q.typeId === 'string' ? q.typeId : undefined,
  };
}

// ---- booking types -------------------------------------------------------------------------------------------------

export function toBookingType(r: BookingTypeResponse): BookingType {
  const cur = r.payment.currency ?? 'USD';
  return {
    id: r.id,
    rowVersion: r.rowVersion,
    name: r.name,
    slug: r.slug,
    description: r.description,
    locationType: r.locationType,
    locationValue: r.locationValue,
    color: r.color,
    durationMinutes: r.durationMinutes,
    incrementMinutes: r.incrementMinutes,
    bufferBeforeMinutes: r.bufferBeforeMinutes,
    bufferAfterMinutes: r.bufferAfterMinutes,
    minNoticeMinutes: r.minNoticeMinutes,
    maxAdvanceDays: r.maxAdvanceDays,
    maxPerDay: r.maxPerDay,
    capacity: r.capacity,
    requiresApproval: r.approvalRequired,
    // The zone the hours are really read in, so a type that follows the workspace zone still shows one.
    timezone: r.effectiveTimezone,
    introMessage: r.introMessage,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    price: {
      currency: cur,
      feeMinor: minor(r.payment.fee, cur),
      taxPct: Number(r.payment.taxPercent) || 0,
      depositMode: r.payment.depositMode,
      depositValueMinor: minor(r.payment.deposit, cur),
      gatewaySlug: r.payment.gatewaySlug,
      autoSendLink: r.payment.autoSendLink,
      cancelFeeMinor: minor(r.payment.cancelFee, cur),
      noShowFeeMinor: minor(r.payment.noShowFee, cur),
      cancelWindowMinutes: r.payment.cancelWindowMinutes,
    },
    integration: {
      calendarId: r.calendar.calendarId,
      createMeet: r.calendar.createMeet,
      spreadsheetId: r.calendar.spreadsheetId,
      sheetRange: r.calendar.sheetRange,
    },
    availability: r.availability.map((w) => ({ weekday: w.weekday, from: w.from, to: w.to })),
    overrides: r.overrides.map((o) => ({
      date: o.date,
      closed: o.isClosed,
      from: o.from,
      to: o.to,
      reason: o.reason,
    })),
    templates: r.templates.map((t) => ({
      event: t.event,
      channel: t.channel,
      waTemplateId: t.waTemplateId,
      libraryTemplateId: t.libraryTemplateId,
      plainBody: t.plainBody,
    })),
    // Every rule, switched on or off: the editor shows both.
    reminders: r.reminders.map((x) => ({
      id: x.id,
      offsetMinutes: x.offsetMinutes,
      label: x.label,
      isActive: x.isActive,
      kind: x.kind,
      channels: x.channels,
      subject: x.subject,
      body: x.body,
      waTemplateId: x.waTemplateId,
    })),
    questions: r.questions.map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      options: q.options ?? [],
      required: q.required,
      // Reference calls the phone field "mobile"; the editor keeps that word, the API says phone.
      mapToContactField: q.mapToContactField === 'phone' ? 'mobile' : q.mapToContactField,
    })),
    appointmentsCount: r.appointmentsCount,
    publicUrl: r.isActive ? r.publicUrl : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** The API's rules from the editor's: a saved rule keeps its id, so the row (and what it has already sent) is kept. */
export function toReminderBody(list: BookingTypeInput['reminders']) {
  return list.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    offsetMinutes: r.offsetMinutes,
    label: r.label,
    isActive: r.isActive,
    kind: r.kind,
    channels: r.channels,
    subject: r.subject,
    body: r.body,
    waTemplateId: r.waTemplateId,
  }));
}

type CreateBody = z.input<typeof createBookingTypeSchema>;
type UpdateBody = z.input<typeof updateBookingTypeSchema>;

/** The body of a create (no `rowVersion`) or a full update (`rowVersion`): every child list is sent, which replaces it. */
export function toTypeBody(i: BookingTypeInput): CreateBody;
export function toTypeBody(i: BookingTypeInput, rowVersion: number): UpdateBody;
export function toTypeBody(i: BookingTypeInput, rowVersion?: number): CreateBody | UpdateBody {
  const cur = i.price.currency;
  const body: CreateBody = {
    name: i.name,
    slug: i.slug || undefined,
    description: i.description,
    locationType: i.locationType,
    locationValue: i.locationValue,
    color: i.color,
    introMessage: i.introMessage,
    approvalRequired: i.requiresApproval,
    isActive: i.isActive,
    durationMinutes: i.durationMinutes,
    incrementMinutes: i.incrementMinutes,
    bufferBeforeMinutes: i.bufferBeforeMinutes,
    bufferAfterMinutes: i.bufferAfterMinutes,
    minNoticeMinutes: i.minNoticeMinutes,
    maxAdvanceDays: i.maxAdvanceDays,
    maxPerDay: i.maxPerDay,
    capacity: i.capacity,
    timezone: i.timezone,
    availability: i.availability.map((w) => ({ weekday: w.weekday, from: w.from, to: w.to })),
    overrides: i.overrides.map((o) => ({
      date: o.date,
      isClosed: o.closed,
      from: o.closed ? null : o.from,
      to: o.closed ? null : o.to,
      reason: o.reason,
    })),
    questions: i.questions.map((q) => ({
      ...(q.id ? { id: q.id } : {}),
      label: q.label,
      type: q.type,
      options: q.type === 'select' ? q.options : null,
      required: q.required,
      mapToContactField:
        q.mapToContactField === 'mobile'
          ? 'phone'
          : ((q.mapToContactField as 'name' | 'email' | 'phone' | null) ?? null),
    })),
    reminders: toReminderBody(i.reminders),
    templates: i.templates.map((t) => ({
      event: t.event,
      channel:
        (t.channel as 'whatsapp' | 'email' | 'telegram' | 'instagram' | 'facebook' | undefined) ??
        'whatsapp',
      waTemplateId: t.waTemplateId,
      ...(t.libraryTemplateId ? { libraryTemplateId: t.libraryTemplateId } : {}),
      plainBody: t.plainBody,
    })),
    payment: {
      currency: cur,
      fee: major(i.price.feeMinor, cur),
      taxPercent: String(i.price.taxPct),
      gatewaySlug: i.price.gatewaySlug,
      depositMode: i.price.depositMode,
      deposit: major(i.price.depositValueMinor, cur),
      autoSendLink: i.price.autoSendLink,
      cancelFee: major(i.price.cancelFeeMinor, cur),
      noShowFee: major(i.price.noShowFeeMinor, cur),
      cancelWindowMinutes: i.price.cancelWindowMinutes,
    },
    calendar: {
      calendarId: i.integration.calendarId,
      createMeet: i.integration.createMeet,
      spreadsheetId: i.integration.spreadsheetId,
      sheetRange: i.integration.sheetRange,
    },
  };
  return rowVersion === undefined ? body : ({ ...body, rowVersion } as UpdateBody);
}

/** A copy of a type, paused, for "Duplicate" (the API has no duplicate route). */
export function duplicateOf(t: BookingType): BookingTypeInput {
  const {
    id: _id,
    rowVersion: _rv,
    appointmentsCount: _n,
    publicUrl: _u,
    createdAt: _c,
    updatedAt: _up,
    sortOrder: _s,
    ...rest
  } = t;
  void [_id, _rv, _n, _u, _c, _up, _s];
  return {
    ...rest,
    name: `${t.name} (copy)`.slice(0, 191),
    slug: '',
    isActive: false,
    // the copy's questions are new rows, not the original's
    questions: t.questions.map(({ id: _qid, ...q }) => q),
    // ... and so are its reminder rules
    reminders: t.reminders.map(({ id: _rid, ...r }) => r),
  };
}

type PreviewBody = z.input<typeof previewSlotsSchema>;

export function toPreviewBody(draft: PreviewDraft, days: number): PreviewBody {
  return {
    draft: {
      timezone: draft.timezone,
      durationMinutes: draft.durationMinutes,
      incrementMinutes: draft.incrementMinutes,
      bufferBeforeMinutes: draft.bufferBeforeMinutes,
      bufferAfterMinutes: draft.bufferAfterMinutes,
      minNoticeMinutes: draft.minNoticeMinutes,
      maxAdvanceDays: draft.maxAdvanceDays,
      maxPerDay: draft.maxPerDay,
      capacity: draft.capacity,
      availability: draft.availability.map((w) => ({ weekday: w.weekday, from: w.from, to: w.to })),
      overrides: draft.overrides.map((o) => ({
        date: o.date,
        isClosed: o.closed,
        from: o.closed ? null : o.from,
        to: o.closed ? null : o.to,
        reason: o.reason,
      })),
    },
    days,
  };
}

// ---- slots ---------------------------------------------------------------------------------------------------------

/**
 * The API asks for local dates in the booking type's zone, the pickers think in instants. A day either side of the instants
 * (in UTC) is more than enough to cover any zone; `inRange` then keeps only the slots that start inside the instants.
 */
export function slotQuery(range: { from: string; to: string }): { from: string; to: string } {
  const from = addDays(dayKeyOf(range.from, 'UTC'), -1);
  const to = addDays(dayKeyOf(new Date(Date.parse(range.to) - 1), 'UTC'), 1);
  return { from, to };
}

export function toSlotList(r: SlotsResponse, range?: { from: string; to: string }): SlotList {
  const lo = range ? Date.parse(range.from) : -Infinity;
  const hi = range ? Date.parse(range.to) : Infinity;
  const slots: Slot[] = [];
  for (const day of r.days) {
    for (const s of day.slots) {
      const t = Date.parse(s.start);
      if (t >= lo && t < hi) slots.push({ start: s.start, end: s.end, remaining: s.remaining });
    }
  }
  slots.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { timezone: r.timezone, slots };
}

// ---- the Google Calendar link --------------------------------------------------------------------------------------

/** The server's answer for `GET /appointments/calendar`. The calendar's own name stays empty until an admin picks one. */
export function toCalendar(r: CalendarStatusResponse): CalendarConnection {
  return {
    provider: 'google',
    status: r.status,
    account: r.account,
    calendarId: r.calendarId,
    calendarName: r.calendarName,
    connectedAt: r.connectedAt,
  };
}

export function toCalendarOptions(r: CalendarListResponse): CalendarOption[] {
  return r.data.map((c) => ({ id: c.id, name: c.name, primary: c.primary, timezone: c.timezone }));
}

// ---- the visitor's pages -------------------------------------------------------------------------------------------

export function toPublicType(s: PublicBookingType): PublicType {
  const cur = s.price?.currency ?? null;
  const total = s.price ? minor(s.price.total, cur) : 0;
  return {
    slug: s.slug,
    name: s.name,
    description: s.description,
    locationType: s.locationType,
    locationValue: s.locationValue,
    color: s.color,
    durationMinutes: s.durationMinutes,
    introMessage: s.introMessage,
    timezone: s.timezone,
    // The page reads the horizon from the slots it is given; the API does not send it, so ask for the widest the picker uses.
    maxAdvanceDays: 365,
    requiresApproval: s.approvalRequired,
    currency: cur,
    // The API sends the total (fee plus tax), not its parts: the fee line carries it and tax shows as none.
    feeMinor: total,
    taxPct: 0,
    dueNowMinor: s.price ? minor(s.price.dueNow, cur) : 0,
    questions: s.questions.map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      options: q.options ?? [],
      required: q.required,
      mapToContactField: null,
    })),
    consent: s.consent ?? null,
  };
}

export const toPublicDirectory = (p: PublicBookingPage): PublicDirectory => ({
  org: { name: p.organization.name, slug: p.organization.slug },
  types: p.services.map(toPublicType),
});

export const toPublicTypePage = (p: {
  organization: { name: string; slug: string };
  service: PublicBookingType;
}): PublicTypePage => ({
  org: { name: p.organization.name, slug: p.organization.slug },
  type: toPublicType(p.service),
});

const manageUrlOf = (token: string): string =>
  `${typeof window === 'undefined' ? '' : window.location.origin}/b/manage/${token}`;

export function toPublicManage(v: PublicManageView, token: string): PublicManage {
  const t = v.bookingType;
  return {
    org: { name: v.organization.name },
    booking: {
      status: v.status,
      typeName: t?.name ?? v.title,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      timezone: v.timezone,
      location: t && t.locationType === 'address' ? t.locationValue : (t?.locationValue ?? null),
      locationType: t?.locationType ?? null,
      meetUrl: v.meetUrl,
      description: null,
      manageToken: token,
      manageUrl: manageUrlOf(token),
      canReschedule: v.canReschedule,
      canCancel: v.canCancel,
      cancelFee: v.cancelFee,
    },
  };
}

/** A booking just made, as the success page shows it: the answer carries the times, the page's own service the rest. */
export function toPublicBooked(
  r: PublicBookResponse,
  type: PublicType,
  org: { name: string; slug?: string },
): { org: { name: string; slug?: string }; booking: PublicBooking } {
  const open = r.status === 'pending' || r.status === 'confirmed';
  return {
    org,
    booking: {
      status: r.status,
      typeName: type.name,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      timezone: r.timezone,
      location: type.locationValue,
      locationType: type.locationType,
      meetUrl: null,
      description: type.description,
      manageToken: r.manageToken,
      manageUrl: r.manageUrl || manageUrlOf(r.manageToken),
      canReschedule: open,
      canCancel: open,
    },
  };
}

type BookBody = z.input<typeof publicBookInputSchema>;

export function toBookBody(input: PublicBookInput): BookBody {
  const answers: Record<string, string> = {};
  for (const a of input.answers) if (a.questionId) answers[a.questionId] = a.answer;
  return {
    startsAt: input.startsAt,
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    timezone: input.inviteeTimezone,
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
    ...(input.consent ? { consent: input.consent } : {}),
  };
}
