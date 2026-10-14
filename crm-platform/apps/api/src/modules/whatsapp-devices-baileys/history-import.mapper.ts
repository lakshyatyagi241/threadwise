import {
  historyImportErrorCodeSchema,
  historyImportStateSchema,
  NOT_REQUESTED_STATUS,
  type HistoryImportStatus,
} from '@crm/contracts';

/** The columns of one run the screens read (also joined onto the device list). */
export interface RunFields {
  state: string | null;
  mode: string | null;
  chats_count: number | null;
  contacts_count: number | null;
  messages_count: number | null;
  progress: number | null;
  window_days: number | null;
  started_at: Date | null;
  finished_at: Date | null;
  error_code: string | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The only place a run row becomes an API response. A device that never opted in has no row and reads `not_requested`. */
export function toHistoryStatus(r: RunFields | null): HistoryImportStatus {
  if (!r || !r.state) return { ...NOT_REQUESTED_STATUS };
  const state = historyImportStateSchema.safeParse(r.state);
  const code = r.error_code ? historyImportErrorCodeSchema.safeParse(r.error_code) : null;
  return {
    state: state.success ? state.data : 'failed',
    mode: r.mode === 'recent' || r.mode === 'full' ? r.mode : 'none',
    chats: Number(r.chats_count ?? 0),
    contacts: Number(r.contacts_count ?? 0),
    messages: Number(r.messages_count ?? 0),
    progress: Number(r.progress ?? 0),
    windowDays: r.window_days === null ? null : Number(r.window_days),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    lastError: code?.success ? { code: code.data } : null,
  };
}
