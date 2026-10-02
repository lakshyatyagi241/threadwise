import type { TaskBucket, TaskSort } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

/**
 * Pure rules of the tasks module (TW-TASK-009 and the list cursor), kept out of the repository so a unit test can pin them
 * without a database.
 */

/** A timeline task's text becomes the task's title (first line, at most 255 characters) and, when longer, its notes. */
export function titleFromBody(body: string): { title: string; notes: string | null } {
  const trimmed = body.trim();
  const firstLine = (trimmed.split(/\r?\n/, 1)[0] ?? '').trim();
  const title = (firstLine || trimmed).slice(0, 255).trim() || 'Task';
  const needsNotes = trimmed.length > title.length;
  return { title, notes: needsNotes ? trimmed.slice(0, 5000) : null };
}

/**
 * Where an open task sits against the clock, mirroring the SQL in the repository (`bucketSql`): the same four-way split, computed
 * for a single instant. `dayEnd` is the start of the NEXT day in the workspace's zone.
 */
export function bucketOf(
  status: 'open' | 'done',
  dueAt: Date | null,
  now: Date,
  dayEnd: Date,
): TaskBucket | null {
  if (status !== 'open') return null;
  if (!dueAt) return 'no_date';
  if (dueAt.getTime() < now.getTime()) return 'overdue';
  if (dueAt.getTime() < dayEnd.getTime()) return 'today';
  return 'upcoming';
}

/** The default order when the caller names none: done tasks by completion, everything else soonest due first. */
export function defaultSort(status: 'open' | 'done' | 'all', sort: TaskSort | undefined): TaskSort {
  if (sort) return sort;
  return status === 'done' ? 'completed' : 'due';
}

/**
 * The list's keyset: one sort key per row plus the id as tiebreaker. The key travels as a microsecond ISO string (a JS Date
 * keeps milliseconds only, and rows that share a millisecond would land on the wrong side of the bound), or `infinity` /
 * `-infinity` for a missing due / done stamp. The sort is part of the cursor so a cursor from one order cannot be replayed
 * against another.
 */
export function encodeTaskCursor(sort: TaskSort, key: string, id: number): string {
  return Buffer.from(`${sort}|${key}|${id}`, 'utf8').toString('base64url');
}

export function decodeTaskCursor(raw: string, sort: TaskSort): { key: string; id: number } {
  try {
    const [s, key, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (s !== sort || !key || !id || !/^\d+$/.test(id)) throw new Error('malformed');
    if (key !== 'infinity' && key !== '-infinity' && Number.isNaN(new Date(key).getTime())) {
      throw new Error('malformed');
    }
    return { key, id: Number(id) };
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
}
