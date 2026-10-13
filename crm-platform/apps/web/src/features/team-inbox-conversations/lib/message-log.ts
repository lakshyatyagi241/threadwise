import type { MessageLogEvent, MessageStatus } from '@crm/contracts';
import { MESSAGE_LOG_RETENTION_DAYS } from '@crm/contracts';

/**
 * What the message log screens decide without a component: which wording a log line gets, whether it is a problem, and the dates the
 * export form starts with. Words themselves live in `messages/<locale>/team-inbox-conversations.json` under `log` and `logs`.
 */

/** The key (under `log.event`) that names one log line. `sent` and `failed` read differently when the provider wrote them. */
export type LogEventKey =
  | 'queued'
  | 'attempt'
  | 'accepted'
  | 'sentReceipt'
  | 'delivered'
  | 'read'
  | 'failedReceipt'
  | 'failedSend'
  | 'retryAuto'
  | 'retryManual';

export function logEventKey(e: Pick<MessageLogEvent, 'event' | 'source' | 'detail'>): LogEventKey {
  switch (e.event) {
    case 'queued':
      return 'queued';
    case 'attempt':
      return 'attempt';
    case 'sent':
      return e.source === 'provider' ? 'sentReceipt' : 'accepted';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
      return e.source === 'provider' ? 'failedReceipt' : 'failedSend';
    case 'retry':
      return e.detail.manual === true ? 'retryManual' : 'retryAuto';
  }
}

/** A line that is a problem: shown in the danger colour with the reason under it. */
export const isProblem = (e: Pick<MessageLogEvent, 'event'>): boolean => e.event === 'failed';

/** Receipts that did not move the message (late, or for an earlier send) are shown greyed, never hidden. */
export const isIgnored = (e: Pick<MessageLogEvent, 'applied'>): boolean => e.applied === false;

/** The last problem on the log is what the message shows now; used to open the dialog on the reason. */
export function lastProblem(events: readonly MessageLogEvent[]): MessageLogEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (isProblem(events[i]!)) return events[i]!;
  return null;
}

const DAY_MS = 86_400_000;
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** What the export form starts with: the last 7 days, as UTC dates (the API reads days in UTC). */
export function defaultExportRange(now: Date = new Date()): { from: string; to: string } {
  return { from: dayOf(new Date(now.getTime() - 6 * DAY_MS)), to: dayOf(now) };
}

/** The oldest day an export can reach, as `YYYY-MM-DD`. */
export const oldestExportDay = (now: Date = new Date()): string =>
  dayOf(new Date(now.getTime() - MESSAGE_LOG_RETENTION_DAYS * DAY_MS));

export type RangeProblem = 'order' | 'future' | 'tooOld' | 'invalid';

/** The same rules the API applies, so a bad range is told before it is sent. */
export function exportRangeProblem(
  from: string,
  to: string,
  now: Date = new Date(),
): RangeProblem | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(from) || !iso.test(to)) return 'invalid';
  if (from > to) return 'order';
  if (to > dayOf(now)) return 'future';
  if (from < oldestExportDay(now)) return 'tooOld';
  return null;
}

/** Statuses a person can narrow an export to (`received` is the customer's own message: it has no delivery log). */
export const EXPORT_STATUSES: readonly MessageStatus[] = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
];
