import type { TaskDueFilter, TaskPriority } from '@crm/contracts';
import type { TaskListFilters, TaskListSource } from './api';

export type StatusChoice = 'open' | 'done' | 'all';
export type OwnerChoice = 'mine' | 'unassigned' | 'all';

export const STATUS_CHOICES: readonly StatusChoice[] = ['open', 'done', 'all'];
export const PRIORITY_CHOICES: readonly TaskPriority[] = ['low', 'medium', 'high'];
export const DUE_CHOICES: readonly TaskDueFilter[] = ['overdue', 'today', 'upcoming', 'none'];
/** The quick due-date tabs above the list (the Geta app's Overdue, Today, Tomorrow, This week), with "All" for no narrowing. */
export type DueTab = 'all' | 'overdue' | 'today' | 'tomorrow' | 'week';
export const DUE_TABS: readonly DueTab[] = ['all', 'overdue', 'today', 'tomorrow', 'week'];

const dayStart = (from: Date, plusDays: number): Date =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() + plusDays);

/**
 * The instants a range tab covers, from the phone's own midnights (inclusive start, exclusive end, as the API reads `dueFrom` and
 * `dueTo`): tomorrow is that one day, "this week" runs from today to the end of Sunday. Overdue and Today use the API's own
 * `due` values, which it reads in the workspace's time zone.
 */
export function dueRangeOf(
  tab: 'tomorrow' | 'week',
  now: Date,
): { dueFrom: string; dueTo: string } {
  if (tab === 'tomorrow') {
    return { dueFrom: dayStart(now, 1).toISOString(), dueTo: dayStart(now, 2).toISOString() };
  }
  // Days until the next Monday: 7 on a Monday, 1 on a Sunday.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return { dueFrom: dayStart(now, 0).toISOString(), dueTo: dayStart(now, toMonday).toISOString() };
}

export const OWNER_CHOICES: readonly OwnerChoice[] = ['mine', 'unassigned', 'all'];

/**
 * What the person picked in the filter sheet. A group left out is on its default: open tasks, and either "mine" (the My tasks
 * list) or "all" (one contact's list, where every owner's tasks belong).
 */
export interface TaskChoices {
  status?: StatusChoice;
  priority?: TaskPriority;
  due?: TaskDueFilter;
  owner?: OwnerChoice;
}

export const NO_CHOICES: TaskChoices = {};

export const DEFAULT_STATUS: StatusChoice = 'open';

/** The API's longest search text; more is cut off here instead of refused there. */
const SEARCH_MAX = 100;

/** The owner a list starts on: the caller's own tasks, unless the list is one contact's. */
export const defaultOwner = (contactId: string): OwnerChoice => (contactId ? 'all' : 'mine');

/** Drops what equals the default, so "Open" picked on purpose and "Open" left alone are the same thing. */
export function cleanChoices(choices: TaskChoices, contactId: string): TaskChoices {
  return {
    ...(choices.status && choices.status !== DEFAULT_STATUS ? { status: choices.status } : {}),
    ...(choices.priority ? { priority: choices.priority } : {}),
    ...(choices.due ? { due: choices.due } : {}),
    ...(choices.owner && choices.owner !== defaultOwner(contactId) ? { owner: choices.owner } : {}),
  };
}

/** How many groups differ from their default (the dot on the filter button). The search text is not one: it has its own field. */
export const activeChoiceCount = (choices: TaskChoices, contactId: string): number =>
  Object.keys(cleanChoices(choices, contactId)).length;

/** The route and the query for what the screen shows: the list's source, the choices, the due tab and the words typed in the search box. */
export function listRequest(
  contactId: string,
  choices: TaskChoices,
  q: string,
  tab: DueTab = 'all',
  now: Date = new Date(),
): { source: TaskListSource; filters: TaskListFilters } {
  const owner = choices.owner ?? defaultOwner(contactId);
  const words = q.trim().slice(0, SEARCH_MAX);
  const base: TaskListFilters = {
    status: choices.status ?? DEFAULT_STATUS,
    ...(choices.priority ? { priority: choices.priority } : {}),
    // A tab is the due narrowing; picking one clears the filter sheet's due choice, so only one of them is ever set.
    ...(tab === 'overdue' || tab === 'today' ? { due: tab } : {}),
    ...(tab === 'tomorrow' || tab === 'week' ? dueRangeOf(tab, now) : {}),
    ...(tab === 'all' && choices.due ? { due: choices.due } : {}),
    ...(words ? { q: words } : {}),
  };
  if (contactId) {
    return {
      source: { kind: 'contact', contactId },
      filters: {
        ...base,
        ...(owner === 'mine' ? { mine: true } : {}),
        ...(owner === 'unassigned' ? { unassigned: true } : {}),
      },
    };
  }
  // Without a contact, "mine" is the My tasks route itself; the other two owners ask the whole list.
  return {
    source: owner === 'mine' ? { kind: 'mine' } : { kind: 'all' },
    filters: { ...base, ...(owner === 'unassigned' ? { unassigned: true } : {}) },
  };
}
