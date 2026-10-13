import type { MessageLogEvent, MessageLogEventName } from '@crm/contracts';
import { MESSAGE_LOG_HOT_DAYS, MESSAGE_LOG_RETENTION_DAYS } from '@crm/contracts';

/**
 * The pure rules of the message log: how a stored event row reads as a log line, which days are archived, what range an export may
 * ask for, and the CSV. No database, no clock (callers pass `now`), so every rule is checked by a table of cases in the unit tests.
 */

export const DAY_MS = 86_400_000;

/** One stored event as the repository returns it (live row or a line of an archive). */
export interface StoredEvent {
  event: string;
  detail: Record<string, unknown>;
  at: Date;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/**
 * A stored event as one log line. The pipeline and the receipts wrote their details with different keys over time (`code`/`reason` from
 * the dispatcher, `errorCode`/`errorMessage` from a provider receipt); both read the same here, so the page and the export never have
 * to know which writer a row came from. `byUserUuid` is resolved by the caller (the row holds the internal id).
 */
export function toLogEvent(e: StoredEvent, byUserUuid: string | null): MessageLogEvent {
  const d = e.detail ?? {};
  return {
    event: e.event as MessageLogEventName,
    at: e.at.toISOString(),
    // A receipt's row carries the provider's own time (`providerAt`); every row the pipeline wrote itself does not.
    source: d.providerAt !== undefined ? 'provider' : 'system',
    providerMessageId: str(d.providerMessageId),
    errorCode: str(d.errorCode) ?? str(d.code),
    errorMessage: str(d.errorMessage) ?? str(d.reason),
    attempt: int(d.attempt),
    byUserId: byUserUuid,
    applied: bool(d.applied),
    replayed: bool(d.replayed),
    detail: d,
  };
}

/** The internal user id a manual `retry` event recorded, or null for every other event. */
export function retryUserId(e: StoredEvent): number | null {
  if (e.event !== 'retry' || e.detail?.manual !== true) return null;
  const by = e.detail.by;
  return typeof by === 'number' && Number.isInteger(by) ? by : null;
}

// --- days and windows -------------------------------------------------------------------------------------------------------

/** `YYYY-MM-DD` of an instant in UTC. */
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** Midnight UTC that starts the given `YYYY-MM-DD`. */
export const dayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export const addDays = (day: string, n: number): string =>
  dayOf(new Date(dayStart(day).getTime() + n * DAY_MS));

/**
 * The first instant that is still in the live table: events older than this are archived. A whole UTC day is archived at once, so
 * the cut is the start of the day `MESSAGE_LOG_HOT_DAYS` before `now`.
 */
export function hotCutoff(now: Date): Date {
  return dayStart(addDays(dayOf(now), -MESSAGE_LOG_HOT_DAYS));
}

/** Events older than this are past the retention and gone: the archive purge deletes every day before it. */
export function retentionCutoff(now: Date): Date {
  return dayStart(addDays(dayOf(now), -MESSAGE_LOG_RETENTION_DAYS));
}

/** Days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type ExportRangeProblem = 'order' | 'future' | 'too_old';

/** What an export's dates are allowed to be: from <= to, not in the future, not older than the retention. Null when fine. */
export function exportRangeProblem(from: string, to: string, now: Date): ExportRangeProblem | null {
  if (from > to) return 'order';
  if (to > dayOf(now)) return 'future';
  if (dayStart(from).getTime() < retentionCutoff(now).getTime()) return 'too_old';
  return null;
}

/**
 * How many days after a message was created its events are looked for in the archive. A send, its receipts and an agent's Retry come
 * within days; a window this long keeps the read of one message to a few small objects instead of the whole year.
 */
export const ARCHIVE_LOOKAHEAD_DAYS = 14;

// --- the CSV -----------------------------------------------------------------------------------------------------------------

export const CSV_BOM = String.fromCharCode(0xfeff);

export const CSV_HEADER = [
  'Time (UTC)',
  'Message ID',
  'Recipient',
  'Channel',
  'Message type',
  'Template',
  'Message status now',
  'Event',
  'Attempt',
  'Provider message ID',
  'Error code',
  'Error message',
  'Applied',
  'Replayed',
  'Retried by',
] as const;

/** A cell that a spreadsheet would run as a formula is prefixed so it is shown as text instead. */
export function csvSafe(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** What the export knows about a message besides its events (left blank when the message row itself is gone). */
export interface ExportMessageInfo {
  uuid: string;
  recipient: string;
  channel: string;
  kind: string;
  template: string;
  status: string;
}

export function csvLine(
  e: MessageLogEvent,
  m: ExportMessageInfo | undefined,
  retriedBy: string | null,
): string {
  return [
    e.at,
    m?.uuid ?? '',
    csvSafe(m?.recipient ?? ''),
    m?.channel ?? '',
    m?.kind ?? '',
    csvSafe(m?.template ?? ''),
    m?.status ?? '',
    e.event,
    e.attempt ?? '',
    e.providerMessageId ?? '',
    e.errorCode ?? '',
    csvSafe(e.errorMessage ?? ''),
    e.applied === null ? '' : e.applied ? 'yes' : 'no',
    e.replayed === null ? '' : e.replayed ? 'yes' : 'no',
    retriedBy ?? '',
  ]
    .map(csvCell)
    .join(',');
}
