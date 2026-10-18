import type { ContactMeetingResponse } from '@crm/contracts';
import type { ContactMeetingRow } from './contact-meetings.repository';

/**
 * `canManageBooking` is decided by the service (it needs the caller's grants); it is false for a typed-in row and for any row the
 * caller may not change on the appointment.
 */
export function toContactMeetingResponse(
  row: ContactMeetingRow,
  canManageBooking = false,
): ContactMeetingResponse {
  return {
    id: row.uuid,
    contactId: row.contactUuid,
    title: row.title,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    location: row.location,
    createdBy: row.createdByUuid,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source,
    appointmentId: row.appointmentUuid,
    status: row.appointmentStatus,
    joinUrl: row.joinUrl,
    canManageBooking,
  };
}
