import { UnsupportedSendError, type SendCommand } from '../node-bridge-runtime';

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
  message_content: string | null;
  media_file: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  provider: string | null;
  device_id: number | string | null;
  send_attempts: number;
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

/**
 * What to send one recipient, from the schedule's message kind (WaDesk `messageType`). Plain text, media with or without a
 * caption, and a location. Templates are sent by the template pipeline, which is not here yet: a template schedule is
 * refused up front, with the reason, instead of failing every recipient one by one.
 */
export function commandFor(row: ScheduledRow, to: string, body: string): SendCommand {
  switch (row.template_type) {
    case 'text':
      return { type: 'text', to, body };
    case 'media':
    case 'media_with_caption': {
      const url = row.media_file ?? '';
      if (!/^https?:\/\//i.test(url)) {
        throw new UnsupportedSendError(
          "This schedule's media is stored as a file, and file storage is not available to the sender yet.",
        );
      }
      return {
        type: 'media',
        to,
        mediaUrl: url,
        ...(row.template_type === 'media_with_caption' && body ? { caption: body } : {}),
      };
    }
    case 'location': {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new UnsupportedSendError('This location schedule has no coordinates.');
      }
      return { type: 'location', to, latitude, longitude, ...(body ? { name: body } : {}) };
    }
    default:
      throw new UnsupportedSendError(
        `Scheduled ${row.template_type} messages are sent by the template pipeline, which is not available yet.`,
      );
  }
}
