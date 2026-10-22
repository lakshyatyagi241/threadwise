import type { BulkConversationsResponse, BulkItemResult } from '@crm/contracts';
import { dayParts, weekdayIn, zonedInstant } from './time';

/**
 * The multi-select of the conversation list as pure functions over a set of ids: a plain click toggles one, a shift-click selects
 * the run between the last click (the anchor) and this one, "select all in view" takes every row loaded. The server is the
 * authority on what each conversation allows; nothing here knows about permissions.
 */

export type Selection = ReadonlySet<string>;
export const EMPTY_SELECTION: Selection = new Set();

export function toggleId(selection: Selection, id: string): Selection {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The rows between `anchor` and `id` (both included, either order). Without a usable anchor it is just `id`. */
export function rangeIds(
  rows: ReadonlyArray<{ id: string }>,
  anchor: string | null,
  id: string,
): string[] {
  const to = rows.findIndex((r) => r.id === id);
  const from = anchor ? rows.findIndex((r) => r.id === anchor) : -1;
  if (to < 0) return [];
  if (from < 0) return [id];
  const [lo, hi] = from < to ? [from, to] : [to, from];
  return rows.slice(lo, hi + 1).map((r) => r.id);
}

/** Shift-click: add the whole run to the selection (a shift-click never deselects). */
export function selectRange(
  selection: Selection,
  rows: ReadonlyArray<{ id: string }>,
  anchor: string | null,
  id: string,
): Selection {
  const next = new Set(selection);
  for (const r of rangeIds(rows, anchor, id)) next.add(r);
  return next;
}

export function selectAllInView(rows: ReadonlyArray<{ id: string }>): Selection {
  return new Set(rows.map((r) => r.id));
}

export function allInViewSelected(
  rows: ReadonlyArray<{ id: string }>,
  selection: Selection,
): boolean {
  return rows.length > 0 && rows.every((r) => selection.has(r.id));
}

/** Select all in view, or clear the selection when every row in view is already picked. */
export function toggleAllInView(
  rows: ReadonlyArray<{ id: string }>,
  selection: Selection,
): Selection {
  return allInViewSelected(rows, selection) ? EMPTY_SELECTION : selectAllInView(rows);
}

/** Ids of the selection that are still in the list (a row that left the view, resolved out of it for example, is no longer selected). */
export function pruneSelection(
  selection: Selection,
  rows: ReadonlyArray<{ id: string }>,
): Selection {
  if (selection.size === 0) return selection;
  const present = new Set(rows.map((r) => r.id));
  const next = new Set([...selection].filter((id) => present.has(id)));
  return next.size === selection.size ? selection : next;
}

/** After a bulk call the ones that failed stay selected so the agent can see them and try again. */
export function failedIds(results: ReadonlyArray<BulkItemResult>): Selection {
  return new Set(results.filter((r) => r.outcome === 'failed').map((r) => r.id));
}

export type BulkSummary = 'allDone' | 'partial' | 'allFailed' | 'nothingChanged';

export function summarize(
  res: Pick<BulkConversationsResponse, 'done' | 'unchanged' | 'failed' | 'requested'>,
): BulkSummary {
  if (res.failed === 0) return res.done === 0 ? 'nothingChanged' : 'allDone';
  return res.done + res.unchanged === 0 ? 'allFailed' : 'partial';
}

/** The wake-up times the snooze menu offers, from `now`. Tomorrow and next week are at 09:00 in `timeZone` (the person's zone; the browser's when left out). */
export type SnoozePreset = 'oneHour' | 'threeHours' | 'tomorrow' | 'nextWeek';
export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  'oneHour',
  'threeHours',
  'tomorrow',
  'nextWeek',
];

export function snoozeUntil(preset: SnoozePreset, now: Date, timeZone?: string): string {
  if (preset === 'oneHour') return new Date(now.getTime() + 3_600_000).toISOString();
  if (preset === 'threeHours') return new Date(now.getTime() + 3 * 3_600_000).toISOString();
  if (timeZone) {
    // 09:00 on the person's own calendar, not the browser's.
    const { y, m, d } = dayParts(now.getTime(), timeZone);
    // The coming Monday (a Monday today means the next one).
    const ahead = preset === 'tomorrow' ? 1 : (8 - weekdayIn(now.getTime(), timeZone)) % 7 || 7;
    return new Date(zonedInstant(y, m, d + ahead, 9, 0, timeZone)).toISOString();
  }
  const at = new Date(now);
  if (preset === 'tomorrow') {
    at.setDate(at.getDate() + 1);
  } else {
    // The coming Monday (a Monday today means the next one).
    at.setDate(at.getDate() + ((8 - at.getDay()) % 7 || 7));
  }
  at.setHours(9, 0, 0, 0);
  return at.toISOString();
}
