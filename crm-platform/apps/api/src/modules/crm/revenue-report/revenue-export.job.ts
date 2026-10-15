import { z } from 'zod';

/**
 * One job on `revenue-report-export` per requested file of the revenue report. The job carries ids only: the worker re-reads the
 * export row (its filters, its scope), so a job for an export that was already built, failed or removed does nothing.
 */
export const REVENUE_EXPORT_JOB = 'revenue-report.export';

export const revenueExportJobSchema = z.object({
  orgId: z.number().int().positive(),
  exportUuid: z.string().uuid(),
});
export type RevenueExportJob = z.infer<typeof revenueExportJobSchema>;

/**
 * One attempt: the runner claims the row `queued -> running` and records its own failure on it, so a second attempt could only find it
 * `running` and do nothing. A worker that dies mid-build leaves the row `running`; the daily sweep marks it failed.
 */
export const REVENUE_EXPORT_JOB_OPTIONS = { attempts: 1 };

/** `:` is reserved by BullMQ. */
export const revenueExportJobId = (exportUuid: string): string => `revenue-export-${exportUuid}`;
