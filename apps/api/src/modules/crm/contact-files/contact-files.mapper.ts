import type { ContactFileResponse } from '@crm/contracts';
import type { ContactFileRow } from './contact-files.repository';

export function toContactFileResponse(row: ContactFileRow): ContactFileResponse {
  return {
    id: row.uuid,
    contactId: row.contactUuid,
    fileName: row.fileName,
    fileSizeBytes: row.fileSizeBytes,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    uploadedBy: row.uploadedByUuid,
    createdAt: row.createdAt.toISOString(),
  };
}
