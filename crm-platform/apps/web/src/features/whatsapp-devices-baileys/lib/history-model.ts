import {
  HISTORY_IMPORT_MODES,
  isHistoryImportActive,
  type HistoryImportMode,
  type HistoryImportState,
  type HistoryImportStatus,
} from '@crm/contracts';

/** The three choices of the step before the QR, in the order they are shown. `none` is first and the default. */
export const HISTORY_CHOICES: readonly HistoryImportMode[] = HISTORY_IMPORT_MODES;
export const DEFAULT_HISTORY_CHOICE: HistoryImportMode = 'none';

/** How often the card re-reads a run that can still change (the device page also refreshes every 10 s). */
export const HISTORY_POLL_MS = 3_000;
export const historyPollMs = (state: HistoryImportState): number | false =>
  isHistoryImportActive(state) ? HISTORY_POLL_MS : false;

export type HistoryTone = 'neutral' | 'success' | 'warning' | 'danger';

/** The badge colour of a state. A run that stopped on a limit is a warning (the person can act), a failure is danger. */
export function historyTone(state: HistoryImportState): HistoryTone {
  switch (state) {
    case 'done':
      return 'success';
    case 'idle':
    case 'limit_reached':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Whether the person may stop the run: it is waiting or taking batches. */
export const canCancelHistory = (s: HistoryImportStatus): boolean => isHistoryImportActive(s.state);

/** Whether a run produced anything to count (an idle run has nothing yet). */
export const hasHistoryCounts = (s: HistoryImportStatus): boolean =>
  s.chats > 0 || s.contacts > 0 || s.messages > 0;

/** The error line key (under `whatsapp-devices-baileys.history`) of a run that stopped on something, or null. A cancelled run has none. */
export const historyErrorKey = (s: HistoryImportStatus): string | null =>
  s.lastError ? `error.${s.lastError.code}` : null;

/** The bar shows progress only while running; a finished run is full, a waiting one empty. */
export function historyPercent(s: HistoryImportStatus): number {
  if (s.state === 'done' && !s.lastError) return 100;
  return Math.max(0, Math.min(100, s.progress));
}
