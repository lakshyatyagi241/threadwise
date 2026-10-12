import type { TaskDueFilter, TaskPriority } from '@crm/contracts';
import type { TaskListFilters, TaskListSource } from './api';

export type StatusChoice = 'open' | 'done' | 'all';
export type OwnerChoice = 'mine' | 'unassigned' | 'all';

export const STATUS_CHOICES: readonly StatusChoice[] = ['open', 'done', 'all'];
export const PRIORITY_CHOICES: readonly TaskPriority[] = ['low', 'medium', 'high'];
export const DUE_CHOICES: readonly TaskDueFilter[] = ['overdue', 'today', 'upcoming', 'none'];
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

/** The route and the query for what the screen shows: the list's source, the choices and the words typed in the search box. */
export function listRequest(
  contactId: string,
  choices: TaskChoices,
  q: string,
): { source: TaskListSource; filters: TaskListFilters } {
  const owner = choices.owner ?? defaultOwner(contactId);
  const words = q.trim().slice(0, SEARCH_MAX);
  const base: TaskListFilters = {
    status: choices.status ?? DEFAULT_STATUS,
    ...(choices.priority ? { priority: choices.priority } : {}),
    ...(choices.due ? { due: choices.due } : {}),
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
