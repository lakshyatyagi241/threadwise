import { z } from 'zod';

/**
 * One job on `consent-export` per requested asynchronous export of the consent proof. The job carries ids only: the worker re-reads the
 * export row, so a job for an export that was already built, failed or removed does nothing.
 */
export const CONSENT_EXPORT_JOB = 'consent.export';

export const consentExportJobSchema = z.object({
  orgId: z.number().int().positive(),
  exportUuid: z.string().uuid(),
});
export type ConsentExportJob = z.infer<typeof consentExportJobSchema>;

/**
 * One attempt: the runner claims the row `queued -> running` and records its own failure on it, so a second attempt could only find it
 * `running` and do nothing. A worker that dies mid-build leaves the row `running`; the daily sweep marks it failed.
 */
export const CONSENT_EXPORT_JOB_OPTIONS = { attempts: 1 };

/** `:` is reserved by BullMQ. */
export const consentExportJobId = (exportUuid: string): string => `consent-export-${exportUuid}`;
