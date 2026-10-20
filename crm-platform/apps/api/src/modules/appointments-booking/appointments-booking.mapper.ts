import type {
  AppointmentResponse,
  BookingTypeOption,
  BookingTypeResponse,
  CalendarDriftReason,
  CalendarUnreadableReason,
} from '@crm/contracts';
import { money, percentToBp, totalWithTax } from './appointment-rules';
import type { AppointmentRow } from './appointments.repository';
import type { BookingTypeRow, TypeChildren } from './booking-types.repository';

/** The mapper is the only place an internal id becomes a uuid. */

export interface TypeContext {
  orgSlug: string;
  webUrl: string;
  /** The workspace's zone: the fallback for a type that names none. */
  orgTimezone: string;
  /** The currency a type with no price row of its own would use. */
  orgCurrency: string | null;
}

export const effectiveTimezone = (
  row: Pick<BookingTypeRow, 'timezone'>,
  orgTimezone: string,
): string => row.timezone ?? orgTimezone;

export function toBookingTypeResponse(
  row: BookingTypeRow,
  c: TypeChildren,
  ctx: TypeContext,
): BookingTypeResponse {
  const fin = c.financial;
  const currency = fin?.currency ?? ctx.orgCurrency;
  const feeMinor = fin?.feeMinor ?? 0n;
  const taxPct = fin?.taxPct ?? '0.00';
  const total = totalWithTax(feeMinor, percentToBp(taxPct));
  const dueNow =
    fin?.depositMode === 'full'
      ? total
      : fin?.depositMode === 'partial'
        ? fin.depositValueMinor
        : 0n;
  const publicPath = `/book/${ctx.orgSlug}/${row.slug}`;
  return {
    id: row.uuid,
    name: row.name,
    slug: row.slug,
    description: row.description,
    locationType: row.locationType,
    locationValue: row.locationValue,
    color: row.color,
    introMessage: row.introMessage,
    durationMinutes: row.durationMinutes,
    incrementMinutes: row.incrementMinutes,
    bufferBeforeMinutes: row.bufferBeforeMinutes,
    bufferAfterMinutes: row.bufferAfterMinutes,
    minNoticeMinutes: row.minNoticeMinutes,
    maxAdvanceDays: row.maxAdvanceDays,
    maxPerDay: row.maxPerDay,
    capacity: row.capacity,
    timezone: row.timezone,
    effectiveTimezone: effectiveTimezone(row, ctx.orgTimezone),
    approvalRequired: row.approvalRequired,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    host: row.hostUuid ? { id: row.hostUuid, name: row.hostName ?? '' } : null,
    publicPath,
    publicUrl: `${ctx.webUrl}${publicPath}`,
    availability: c.rules,
    overrides: c.overrides,
    questions: c.questions.map((q) => ({
      id: q.uuid,
      label: q.label,
      type: q.type,
      options: q.options,
      required: q.required,
      mapToContactField: q.mapToContactField,
      sortOrder: q.sortOrder,
    })),
    reminders: c.reminders.map((r) => ({
      id: r.uuid,
      offsetMinutes: r.offsetMinutes,
      label: r.label,
      isActive: r.isActive,
      kind: r.kind,
      stepKind: r.stepKind,
      channels: r.channels,
      subject: r.subject,
      body: r.body,
      waTemplateId: r.waTemplateUuid,
      waTemplateStatus: r.waTemplateStatus,
      waTemplateName: r.waTemplateName,
      libraryTemplateId: r.libraryTemplateUuid,
      buttonsEnabled: r.buttonsEnabled,
      skipIfConfirmed: r.skipIfConfirmed,
      undeliveredFallbackMinutes: r.undeliveredFallbackMinutes,
      notice: r.notice,
    })),
    templates: c.templates.map((t) => ({
      event: t.event,
      channel: t.channel,
      waTemplateId: t.waTemplateUuid,
      libraryTemplateId: t.libraryTemplateUuid,
      plainBody: t.plainBody,
      variableMap: t.variableMap,
    })),
    payment: {
      currency,
      fee: money(feeMinor, currency),
      taxPercent: taxPct,
      total: money(total, currency),
      gatewaySlug: fin?.gatewaySlug ?? null,
      depositMode: fin?.depositMode ?? 'none',
      deposit: money(fin?.depositValueMinor ?? 0n, currency),
      dueNow: money(dueNow, currency),
      autoSendLink: fin?.autoSendLink ?? true,
      cancelFee: money(fin?.cancelFeeMinor ?? 0n, currency),
      noShowFee: money(fin?.noShowFeeMinor ?? 0n, currency),
      cancelWindowMinutes: fin?.cancelWindowMinutes ?? 1440,
    },
    calendar: {
      calendarId: c.integration?.calendarId ?? null,
      createMeet: c.integration?.createMeet ?? row.locationType === 'virtual',
      spreadsheetId: c.integration?.spreadsheetId ?? null,
      sheetRange: c.integration?.sheetRange ?? 'Sheet1!A1',
    },
    appointmentsCount: row.appointmentsCount,
    upcomingCount: row.upcomingCount,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const toBookingTypeOption = (row: BookingTypeRow): BookingTypeOption => ({
  id: row.uuid,
  name: row.name,
  durationMinutes: row.durationMinutes,
  isActive: row.isActive,
});

export interface AppointmentDecrypted {
  notes: string | null;
  manageUrl: string | null;
}

export function toAppointmentResponse(
  row: AppointmentRow,
  plain: AppointmentDecrypted,
): AppointmentResponse {
  return {
    id: row.uuid,
    status: row.status,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    inviteeTimezone: row.inviteeTimezone,
    location: row.location,
    meetUrl: row.meetUrl,
    bookingType: row.bookingTypeUuid
      ? {
          id: row.bookingTypeUuid,
          name: row.bookingTypeName ?? '',
          color: row.bookingTypeColor,
          durationMinutes: row.bookingTypeDuration ?? 0,
          locationType: row.bookingTypeLocation ?? 'address',
        }
      : null,
    seat: row.seat,
    invitee: { name: row.inviteeName, email: row.inviteeEmail, phone: row.inviteePhone },
    contact: row.contactUuid ? { id: row.contactUuid, name: row.contactName } : null,
    host: row.hostUuid ? { id: row.hostUuid, name: row.hostName ?? '' } : null,
    source: row.source,
    answers: row.answers,
    notes: plain.notes,
    payment: {
      status: row.paymentStatus,
      currency: row.currency,
      total: money(row.priceMinor, row.currency),
      dueNow: money(row.dueNowMinor, row.currency),
      paid: money(row.depositPaidMinor, row.currency),
      feeRecorded: money(row.feeRecordedMinor, row.currency),
      holdExpiresAt: row.holdExpiresAt ? row.holdExpiresAt.toISOString() : null,
    },
    needsReview: row.needsReview,
    checkedInAt: row.checkedInAt ? row.checkedInAt.toISOString() : null,
    statusChangedAt: row.statusChangedAt.toISOString(),
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    calendar: {
      eventId: row.calendarEventId,
      calendarId: row.calendarId,
      sync: row.calendarEventId
        ? {
            state: row.googleSyncState,
            reason: row.googleSyncReason as CalendarDriftReason | CalendarUnreadableReason | null,
            detectedAt: row.googleDriftDetectedAt?.toISOString() ?? null,
            googleStartsAt: row.googleDriftStartsAt?.toISOString() ?? null,
            googleEndsAt: row.googleDriftEndsAt?.toISOString() ?? null,
            checkedAt: row.googleCheckedAt?.toISOString() ?? null,
          }
        : null,
    },
    manageUrl: plain.manageUrl,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The few fields an outbox event carries: identifiers and what a consumer decides on, never the notes, the manage token or the
 * invitee's name (the title is made of it): a consumer reads the booking itself at delivery.
 */
export function appointmentEventPayload(row: AppointmentRow): Record<string, unknown> {
  return {
    uuid: row.uuid,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    bookingTypeId: row.bookingTypeUuid,
    contactId: row.contactUuid,
    hostId: row.hostUuid,
    source: row.source,
    paymentStatus: row.paymentStatus,
    rowVersion: row.rowVersion,
  };
}
