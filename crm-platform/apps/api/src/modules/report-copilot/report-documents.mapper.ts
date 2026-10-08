import type { ReportDocument } from '@crm/contracts';
import type { ReportDocumentRow } from './report-documents.repository';

/** The only place a stored document becomes an API response: the uuid is the id, the internal key and the extracted text stay behind. */
export function toReportDocument(row: ReportDocumentRow): ReportDocument {
  return {
    id: row.uuid,
    name: row.name,
    extension: row.extension,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    charCount: row.charCount,
    truncated: row.truncated,
    status: row.status === 'failed' ? 'failed' : 'ready',
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
  };
}
