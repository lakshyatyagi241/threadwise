import type { Tx } from '@crm/db';
import { RETENTION_ITEMS, retentionProblem } from '@crm/contracts';
import { MESSAGE_LOG_HOT_DAYS, MESSAGE_LOG_RETENTION_DAYS } from '@crm/contracts';
import { loadPolicy } from '../data-retention';

/** The two windows of the message log in force now. `retentionDays` null: the archive keeps every day for ever. */
export interface MessageLogWindows {
  /** Days an event stays in `message_events` before the daily sweep archives it. */
  hotDays: number;
  /** Days after the event that the archive keeps it. */
  retentionDays: number | null;
}

/** The built-in windows (nothing saved on the retention dashboard). */
export const DEFAULT_MESSAGE_LOG_WINDOWS: MessageLogWindows = {
  hotDays: MESSAGE_LOG_HOT_DAYS,
  retentionDays: MESSAGE_LOG_RETENTION_DAYS,
};

/** The smallest live window the dashboard allows: an event is never archived younger than this. */
export const MESSAGE_LOG_MIN_HOT_DAYS = RETENTION_ITEMS.find((i) => i.id === 'message_log')!.live
  .min;

/**
 * The windows the retention dashboard saved for the message log, else the built-in ones. The archive's length counts from the end of the
 * live window, so the event's total age is live + archive days. A stored row outside the item's range is ignored.
 * Needs a privileged transaction: the policy table is platform-only.
 */
export async function messageLogWindows(tx: Tx): Promise<MessageLogWindows> {
  const saved = await loadPolicy(tx, 'message_log');
  if (!saved) return DEFAULT_MESSAGE_LOG_WINDOWS;
  const values = { liveDays: saved.liveDays, archiveDays: saved.archiveDays };
  if (retentionProblem('message_log', values) !== null) return DEFAULT_MESSAGE_LOG_WINDOWS;
  return {
    hotDays: saved.liveDays,
    retentionDays: saved.archiveDays === null ? null : saved.liveDays + saved.archiveDays,
  };
}
