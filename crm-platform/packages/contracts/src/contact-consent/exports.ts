import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Asynchronous export of the consent proof (spec docs/specs/contact-consent-ledger.md, section 12). The synchronous CSV carries at
 * most CONSENT_EXPORT_SYNC_MAX rows; a larger ledger is built by the worker, kept CONSENT_EXPORT_TTL_DAYS days and announced by email.
 */
export const CONSENT_EXPORT_SYNC_MAX = 50_000;
export const CONSENT_EXPORT_TTL_DAYS = 7;
/** An async export is stopped past this many rows (the file is held in memory while it is built). */
export const CONSENT_EXPORT_MAX_ROWS = 5_000_000;

export const consentExportStatusSchema = z.enum([
  'queued',
  'running',
  'ready',
  'failed',
  'expired',
]);
export type ConsentExportStatus = z.infer<typeof consentExportStatusSchema>;

export const consentExportSchema = z.object({
  id: uuidSchema,
  status: consentExportStatusSchema,
  /** Rows in the file, once it is ready. */
  rowCount: z.number().int().nonnegative().nullable(),
  fileBytes: z.number().int().nonnegative().nullable(),
  /** A sentence for a failed export. */
  error: z.string().nullable(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  /** After this the file is deleted and the export is `expired`. */
  expiresAt: z.string().datetime().nullable(),
  /** The address the file was announced to. */
  emailedTo: z.string().nullable(),
});
export type ConsentExport = z.infer<typeof consentExportSchema>;

export const consentExportListSchema = z.object({
  data: z.array(consentExportSchema),
  /** Events in the ledger, counted up to CONSENT_EXPORT_SYNC_MAX + 1: above CONSENT_EXPORT_SYNC_MAX the direct download is cut short. */
  ledgerRows: z.number().int().nonnegative(),
  /** True when `ledgerRows` is more than the direct download carries: the screen offers the prepared file instead. */
  needsAsync: z.boolean(),
});
export type ConsentExportList = z.infer<typeof consentExportListSchema>;
