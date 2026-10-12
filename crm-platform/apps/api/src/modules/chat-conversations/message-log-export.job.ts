import { z } from 'zod';

/**
 * One job on `msg-log-export` per requested export of the message log. The job carries ids only: the worker re-reads the export row, so
 * a job for an export that was already built, failed or removed does nothing.
 */
export const MESSAGE_LOG_EXPORT_JOB = 'message-log.export';

export const messageLogExportJobSchema = z.object({
  orgId: z.number().int().positive(),
  exportUuid: z.string().uuid(),
});
export type MessageLogExportJob = z.infer<typeof messageLogExportJobSchema>;

/**
 * One attempt: the runner claims the row `queued -> running` and records its own failure on it, so a second attempt could only find it
 * `running` and do nothing. A worker that dies mid-build leaves the row `running`; the daily sweep marks it failed and the user requests
 * it again.
 */
export const MESSAGE_LOG_EXPORT_JOB_OPTIONS = { attempts: 1 };

/** `:` is reserved by BullMQ. */
export const messageLogExportJobId = (exportUuid: string): string => `msglog-export-${exportUuid}`;
