import type { ContactViewResponse } from '@crm/contracts';
import type { ContactFilters } from './api';

/** The views every workspace has without anyone saving them. Their names are translated: `contacts.views.system.<id>`. */
export const SYSTEM_VIEW_IDS = ['all', 'mine', 'recent', 'optedOut'] as const;
export type SystemViewId = (typeof SYSTEM_VIEW_IDS)[number];

/** The view the list is showing: one of the built-in ones, or one a person of the workspace saved. */
export type ChosenView =
  | { kind: 'system'; id: SystemViewId }
  | { kind: 'custom'; id: string; name: string; filter: ContactViewResponse['filter'] };

export const ALL_CONTACTS: ChosenView = { kind: 'system', id: 'all' };

/** "Recently created" looks back this many days. */
export const RECENT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day `days` before `now`, as YYYY-MM-DD in UTC (the API accepts a date for `createdFrom`). */
function dayAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * What a view asks the API for. A built-in view is a plain filter of the contact list. A saved view carries a condition tree (the
 * same tree a segment is made of), which the list takes as the `rules` text, so the server does the matching, not the app.
 * `userId` is the signed-in person: "My contacts" are the ones they own.
 */
export function viewFilters(
  view: ChosenView,
  userId: string | undefined,
  now = new Date(),
): ContactFilters {
  if (view.kind === 'custom') {
    return Object.keys(view.filter).length > 0 ? { rules: JSON.stringify(view.filter) } : {};
  }
  switch (view.id) {
    case 'mine':
      return userId ? { ownerId: userId } : {};
    case 'recent':
      return { createdFrom: dayAgo(now, RECENT_DAYS) };
    case 'optedOut':
      return { unsubscribed: true };
    default:
      return {};
  }
}

/** Whether a view is the plain, unfiltered list. */
export const isAllContacts = (view: ChosenView): boolean =>
  view.kind === 'system' && view.id === 'all';
