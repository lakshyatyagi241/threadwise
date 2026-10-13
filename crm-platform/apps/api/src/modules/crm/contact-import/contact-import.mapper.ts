import type { ContactImportJob, ImportJobStatus } from '@crm/contracts';
import type { ImportJobRow } from './contact-import.repository';

export function toImportJobResponse(
  row: ImportJobRow,
  createdBy: string | null = null,
): ContactImportJob {
  return {
    id: row.uuid,
    status: row.status as ImportJobStatus,
    fileName: row.fileName,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    created: row.createdCount,
    updated: row.updatedCount,
    invalid: row.invalidCount,
    duplicatesInFile: row.duplicatesInFile,
    limitExceeded: row.limitExceeded,
    error: row.error,
    createdBy,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
