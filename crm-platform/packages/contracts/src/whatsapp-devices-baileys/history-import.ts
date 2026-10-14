import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Opt-in import of the existing chats of a personal WhatsApp number (TW-WAHIST, docs/specs/personal-whatsapp-connect.md section 14).
 * The choice is made BEFORE the QR is scanned, because WhatsApp sends a number's history only once, right after its first link.
 */

/** `none`: nothing is imported (the default, and what every number did before). `recent`: the last chats WhatsApp sends on a first link. `full`: also WhatsApp's older history. */
export const HISTORY_IMPORT_MODES = ['none', 'recent', 'full'] as const;
export const historyImportModeSchema = z.enum(HISTORY_IMPORT_MODES);
export type HistoryImportMode = z.infer<typeof historyImportModeSchema>;

/**
 * `not_requested`: the person never chose to import. `idle`: chosen, waiting for the link and for WhatsApp to send. `running`: batches are
 * arriving. `done`, `failed`, `cancelled`, `limit_reached` (the workspace's contact limit stopped it) are final.
 */
export const HISTORY_IMPORT_STATES = [
  'not_requested',
  'idle',
  'running',
  'done',
  'failed',
  'cancelled',
  'limit_reached',
] as const;
export const historyImportStateSchema = z.enum(HISTORY_IMPORT_STATES);
export type HistoryImportState = z.infer<typeof historyImportStateSchema>;

/** Short codes for `lastError`; the web owns the words. */
export const HISTORY_IMPORT_ERROR_CODES = [
  'history_not_received',
  'message_cap_reached',
  'chat_cap_reached',
  'contact_limit_reached',
  'worker_error',
] as const;
export const historyImportErrorCodeSchema = z.enum(HISTORY_IMPORT_ERROR_CODES);
export type HistoryImportErrorCode = z.infer<typeof historyImportErrorCodeSchema>;

export const historyImportStatusSchema = z.object({
  state: historyImportStateSchema,
  /** The choice of the run; `none` when never requested. */
  mode: historyImportModeSchema,
  /** Conversations the run created (a chat the inbox already had is not counted). */
  chats: z.number().int().min(0),
  /** Contacts the run created. Groups never create one. */
  contacts: z.number().int().min(0),
  /** Messages the run stored. A redelivered one is not counted twice. */
  messages: z.number().int().min(0),
  /** 0 to 100, WhatsApp's own progress figure. */
  progress: z.number().int().min(0).max(100),
  /** How far back messages are kept, in days (from platform settings at the time of the run). */
  windowDays: z.number().int().nullable(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  finishedAt: z.string().datetime({ offset: true }).nullable(),
  lastError: z.object({ code: historyImportErrorCodeSchema }).nullable(),
});
export type HistoryImportStatus = z.infer<typeof historyImportStatusSchema>;

export const NOT_REQUESTED_STATUS: HistoryImportStatus = {
  state: 'not_requested',
  mode: 'none',
  chats: 0,
  contacts: 0,
  messages: 0,
  progress: 0,
  windowDays: null,
  startedAt: null,
  finishedAt: null,
  lastError: null,
};

/** `GET /v2/devices/:id/history-import`. */
export const historyImportResponseSchema = z.object({
  deviceId: uuidSchema,
  status: historyImportStatusSchema,
});
export type HistoryImportResponse = z.infer<typeof historyImportResponseSchema>;

/** `POST /v2/devices/:id/history-import/cancel`: whether a run was active and has been stopped. */
export const cancelHistoryImportResultSchema = z.object({
  cancelled: z.boolean(),
  status: historyImportStatusSchema,
});
export type CancelHistoryImportResult = z.infer<typeof cancelHistoryImportResultSchema>;

/** The states in which batches may still be accepted. */
export const HISTORY_IMPORT_ACTIVE_STATES: readonly HistoryImportState[] = ['idle', 'running'];
export const isHistoryImportActive = (s: HistoryImportState): boolean =>
  HISTORY_IMPORT_ACTIVE_STATES.includes(s);
