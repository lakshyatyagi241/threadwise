import { z } from 'zod';

/**
 * One job on `audit-log-export` per requested export of the audit log. The job carries ids only: the worker re-reads the export row
 * (and its filters), so a job for an export that was already built, failed or removed does nothing.
 */
export const AUDIT_LOG_EXPORT_JOB = 'audit-log.export';

export const auditLogExportJobSchema = z.object({
  orgId: z.number().int().positive(),
  exportUuid: z.string().uuid(),
});
export type AuditLogExportJob = z.infer<typeof auditLogExportJobSchema>;

/**
 * One attempt: the runner claims the row `queued -> running` and records its own failure on it, so a second attempt could only find it
 * `running` and do nothing. A worker that dies mid-build leaves the row `running`; the daily sweep marks it failed.
 */
export const AUDIT_LOG_EXPORT_JOB_OPTIONS = { attempts: 1 };

/** `:` is reserved by BullMQ. */
export const auditLogExportJobId = (exportUuid: string): string => `audit-export-${exportUuid}`;
