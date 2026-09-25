import type { ContactMeetingResponse } from '@crm/contracts';
import type { ContactMeetingRow } from './contact-meetings.repository';

export function toContactMeetingResponse(row: ContactMeetingRow): ContactMeetingResponse {
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
  };
}
