/** The columns of `scheduled_messages` a run reads. */
export interface ScheduledRow {
  id: number | string;
  uuid: string;
  status: string;
  schedule_type: string;
  scheduled_time: Date | string;
  next_run_at: Date | string | null;
  timezone: string;
  repeat_interval: string | null;
  repeat_every: number | null;
  days_of_week: unknown;
  end_date: string | Date | null;
  template_type: string;
  template_id: number | string | null;
  template_overrides: unknown;
  message_content: string | null;
  media_file: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  provider: string | null;
  device_id: number | string | null;
  send_attempts: number;
  /** The last occurrence's recipients are kept until the next run starts (see the run). */
  recipients_spent?: boolean;
}

export const isRecurring = (row: Pick<ScheduledRow, 'schedule_type'>) =>
  row.schedule_type === 'recurring';

/** The instant this run was due: the stored next run, else the first time. */
export const runAt = (row: Pick<ScheduledRow, 'next_run_at' | 'scheduled_time'>): Date =>
  new Date(row.next_run_at ?? row.scheduled_time);

/** `YYYY-MM-DD` of an end date, whichever way the driver hands it back. */
export const dateOnly = (v: string | Date | null): string | null =>
  v === null ? null : typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);

/** The days of the week as numbers; the column is free JSON, so anything else is ignored. */
export const weekdays = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [];
