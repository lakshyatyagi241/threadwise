import type { ActivitySource, ContactActivityResponse } from '@crm/contracts';
import type { ContactActivityRow } from './contact-activities.repository';

export function toContactActivityResponse(row: ContactActivityRow): ContactActivityResponse {
  return {
    id: row.uuid,
    contactId: row.contactUuid,
    activityType: row.activityType,
    title: row.title,
    body: row.body,
    source: row.source as ActivitySource,
    actorId: row.actorUuid,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
