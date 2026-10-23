import {
  canMoveConversationStatus,
  isFinishedWebchat,
  type BulkConversationsResponse,
  type BulkItemResult,
  type ConversationStatus,
  type ConversationSummary,
} from '@crm/contracts';
import { isMine } from './list';
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

/**
 * What the picked conversations have in common, which is what the bulk bar's labels follow. When every picked conversation is already
 * in the state an action undoes, the action's reverse replaces it ("Mark as spam" becomes "Mark as not spam"); otherwise the forward
 * action stays. An action that would change nothing for any picked conversation is not offered. With nothing picked every action is
 * offered (the bar is then disabled anyway).
 */
export interface PickedState {
  /** Every picked conversation is spam: the spam button becomes "Mark as not spam" (status open). */
  allSpam: boolean;
  /** Every picked conversation is snoozed: the snooze menu becomes "Unsnooze" (status open). */
  allSnoozed: boolean;
  /** No picked conversation has an unread message: "Mark as read" becomes "Mark as unread". */
  allRead: boolean;
  /** Some picked conversation is spam. Reopen (status open) would take it out of spam, so Reopen is not offered. */
  someSpam: boolean;
  /** Some picked conversation is snoozed. Reopen (status open) would wake it, so Reopen is not offered. */
  someSnoozed: boolean;
  /**
   * Some picked conversation is a resolved or closed web chat: it takes no reopen, snooze or spam mark (the API refuses each), so the bar
   * offers none of them while one is picked.
   */
  someFinishedWebchat: boolean;
  canUnassign: boolean;
  canRemoveTeam: boolean;
  /** False once every picked conversation is assigned to the caller already. */
  canAssignMe: boolean;
  /** Some picked conversation can move to this status (and is not in it already). */
  canMoveTo: (to: ConversationStatus) => boolean;
  /** Some picked conversation lacks this tag. */
  canAddTag: (tagId: string) => boolean;
  /** Some picked conversation carries this tag. */
  canRemoveTag: (tagId: string) => boolean;
}

export function pickedState(picked: ReadonlyArray<ConversationSummary>, meId: string): PickedState {
  const none = picked.length === 0;
  const every = (test: (r: ConversationSummary) => boolean) =>
    picked.length > 0 && picked.every(test);
  const some = (test: (r: ConversationSummary) => boolean) => picked.some(test);
  const hasTag = (r: ConversationSummary, tagId: string) => r.labels.some((l) => l.id === tagId);
  return {
    allSpam: every((r) => r.status === 'spam'),
    allSnoozed: every((r) => r.status === 'snoozed'),
    allRead: every((r) => r.unreadCount === 0),
    someSpam: some((r) => r.status === 'spam'),
    someSnoozed: some((r) => r.status === 'snoozed'),
    someFinishedWebchat: some((r) => isFinishedWebchat(r.channel.kind, r.status)),
    canUnassign: none || some((r) => r.assignment.user !== null),
    canRemoveTeam: none || some((r) => r.assignment.team !== null),
    canAssignMe: !every((r) => isMine(r, meId)),
    canMoveTo: (to) =>
      none ||
      some(
        (r) =>
          r.status !== to &&
          canMoveConversationStatus(r.status, to) &&
          !(to === 'open' && isFinishedWebchat(r.channel.kind, r.status)),
      ),
    canAddTag: (tagId) => none || !every((r) => hasTag(r, tagId)),
    canRemoveTag: (tagId) => none || some((r) => hasTag(r, tagId)),
  };
}
