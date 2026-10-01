/**
 * Due-date rules (TW-TASK-009). The server cuts the buckets in the workspace zone and sends `bucket` and `overdue` on every
 * task; these functions apply the same rule on the client for what the server has not answered yet (a task just edited, the
 * board's grouping, the development stand-in) and for the date inputs. Pure: `now` and the zone are arguments.
 */
import type { TaskBucket, TaskResponse } from '@crm/contracts';

export const BUCKET_ORDER: readonly TaskBucket[] = ['overdue', 'today', 'upcoming', 'no_date'];

/** `YYYY-MM-DD` of an instant on the calendar of `timeZone` (the viewer's zone when absent or unknown). */
export function dayKey(d: Date, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return timeZone ? dayKey(d) : '';
  }
}

/**
 * Where an OPEN task sits against the clock: the due instant already passed is overdue (a task due at 09:00 is overdue at
 * 09:01 the same day), a later time today is today, any later day is upcoming. A done task has no bucket.
 */
export function bucketOf(
  dueAt: string | null | undefined,
  status: 'open' | 'done',
  now: Date,
  timeZone?: string,
): TaskBucket | null {
  if (status === 'done') return null;
  if (!dueAt) return 'no_date';
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 'no_date';
  if (due.getTime() < now.getTime()) return 'overdue';
  return dayKey(due, timeZone) === dayKey(now, timeZone) ? 'today' : 'upcoming';
}

export const isOverdue = (
  task: Pick<TaskResponse, 'status' | 'dueAt'>,
  now: Date,
  timeZone?: string,
): boolean => bucketOf(task.dueAt, task.status, now, timeZone) === 'overdue';

/** Soonest due first, undated last; ties by title so the order is stable. */
export function compareByDue(
  a: Pick<TaskResponse, 'dueAt' | 'title'>,
  b: Pick<TaskResponse, 'dueAt' | 'title'>,
): number {
  if (a.dueAt && b.dueAt) {
    const d = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    return d !== 0 ? d : a.title.localeCompare(b.title);
  }
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return a.title.localeCompare(b.title);
}

/** The open tasks in the four buckets, each soonest first. Done tasks are left out. */
export function groupByBucket(
  tasks: readonly TaskResponse[],
  now: Date,
  timeZone?: string,
): Record<TaskBucket, TaskResponse[]> {
  const out: Record<TaskBucket, TaskResponse[]> = { overdue: [], today: [], upcoming: [], no_date: [] };
  for (const t of tasks) {
    const b = bucketOf(t.dueAt, t.status, now, timeZone);
    if (b) out[b].push(t);
  }
  for (const k of BUCKET_ORDER) out[k].sort(compareByDue);
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The value of a `datetime-local` input for an instant, in the viewer's zone ('' for none). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An instant with an offset (what the API requires) from a `datetime-local` value; null for empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type DuePreset = 'today' | 'tomorrow' | 'nextWeek';

/** Quick due choices: today and tomorrow at 17:00, next Monday at 09:00 (local). Today after 17:00 is the next full hour. */
export function presetDue(kind: DuePreset, now: Date): string {
  const d = new Date(now);
  if (kind === 'today') {
    d.setHours(17, 0, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setTime(now.getTime());
      d.setHours(d.getHours() + 1, 0, 0, 0);
    }
  } else if (kind === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    d.setHours(17, 0, 0, 0);
  } else {
    const ahead = (8 - d.getDay()) % 7 || 7; // next Monday, never today
    d.setDate(d.getDate() + ahead);
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

export type DueRelative = 'yesterday' | 'today' | 'tomorrow' | 'date';

/** How a due date reads relative to today, by calendar day in `timeZone`. */
export function relativeDay(dueAt: string, now: Date, timeZone?: string): DueRelative {
  const due = new Date(dueAt);
  const day = (d: Date) => Date.parse(`${dayKey(d, timeZone)}T00:00:00Z`);
  const diff = Math.round((day(due) - day(now)) / 86_400_000);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday' : 'date';
}
