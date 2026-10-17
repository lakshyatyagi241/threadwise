import type { ContactNoteResponse } from '@crm/contracts';
import type { ContactNoteRow } from './contact-notes.repository';

export function toContactNoteResponse(row: ContactNoteRow): ContactNoteResponse {
  return {
    id: row.uuid,
    contactId: row.contactUuid,
    body: row.body,
    createdBy: row.createdByUuid,
    createdByName: row.createdByName,
    updatedBy: row.updatedByUuid,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
