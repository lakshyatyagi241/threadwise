import type { ContactMeetingResponse, MeetingConferencing } from '@crm/contracts';
import type { MeetingConferencingRow } from './contact-meeting-conferencing.repository';
import type { ContactMeetingRow } from './contact-meetings.repository';

/** What the list reads of a meeting's video link and calendar entry: null when none was asked for. */
export function toMeetingConferencing(
  row: MeetingConferencingRow | null | undefined,
): MeetingConferencing | null {
  if (!row || (row.videoProvider === null && !row.addToCalendar)) return null;
  return {
    videoProvider: row.videoProvider,
    videoStatus: row.videoStatus,
    videoError: row.videoError,
    calendarProvider: row.calendarProvider,
    calendarStatus: row.calendarStatus,
    calendarError: row.calendarError,
    invited: row.addToCalendar && row.sendInvitation,
  };
}

/**
 * `canManageBooking` is decided by the service (it needs the caller's grants); it is false for a typed-in row and for any row the
 * caller may not change on the appointment.
 */
export function toContactMeetingResponse(
  row: ContactMeetingRow,
  canManageBooking = false,
  conferencing?: MeetingConferencingRow | null,
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
    conferencing: toMeetingConferencing(conferencing),
  };
}
