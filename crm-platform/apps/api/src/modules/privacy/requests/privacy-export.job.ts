import { z } from 'zod';

/**
 * One job on `privacy-export` per requested export of a data-subject request. The job carries ids only: the worker re-reads the export
 * row, so a job for an export that was already built, failed or removed does nothing. It never carries the person's data.
 */
export const PRIVACY_EXPORT_JOB = 'privacy.export';

export const privacyExportJobSchema = z.object({
  orgId: z.number().int().positive(),
  exportUuid: z.string().uuid(),
});
export type PrivacyExportJob = z.infer<typeof privacyExportJobSchema>;

/** One attempt: the runner claims the row `queued -> running` and records its own failure on it; a stuck `running` row is failed by the sweep. */
export const PRIVACY_EXPORT_JOB_OPTIONS = { attempts: 1 };

/** `:` is reserved by BullMQ. */
export const privacyExportJobId = (exportUuid: string): string => `privacy-export-${exportUuid}`;
