import { FOLLOW_UP_FILTERS, type ContactViewResponse, type FollowUpFilter } from '@crm/contracts';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE_OR_STATUS = /^[a-z][a-z0-9_]*$/;

/** A `rules` text the server can take: JSON of a sane size (the server checks the tree itself). */
function validRules(text: unknown): string | undefined {
  if (typeof text !== 'string' || text.length === 0 || text.length > 20_000) return undefined;
  try {
    JSON.parse(text);
    return text;
  } catch {
    return undefined;
  }
}

/**
 * What a saved view stands for. The web saves the list's URL parameters under `params` (`{ v: 1, params: { stage, owner, rules ...},
 * columns }`); a view the Waboo migration loaded keeps only `rules` (JSON text). A bare condition tree (`op` / `conditions`) is
 * handed to the server as rules. Values the app cannot read are dropped, as the web's `parseFilters` does.
 */
function savedViewFilters(filter: ContactViewResponse['filter']): ContactFilters {
  const raw = filter.params;
  const params: Record<string, unknown> =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : typeof filter.rules === 'string'
        ? { rules: filter.rules }
        : {};
  const text = (key: string): string | undefined => {
    const v = params[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const id = (key: string): string | undefined => {
    const v = text(key);
    return v && UUID.test(v) ? v : undefined;
  };

  const out: ContactFilters = {};
  const stage = text('stage');
  if (stage && STAGE_OR_STATUS.test(stage)) out.lifecycleStage = stage;
  const status = text('status');
  if (status && STAGE_OR_STATUS.test(status)) out.status = status;
  const source = text('source')?.slice(0, 128);
  if (source) out.source = source;

  const consent = text('consent');
  if (consent === 'unsubscribed') out.unsubscribed = true;
  if (consent === 'subscribed') out.subscribed = true;
  if (text('imported') === '1') out.imported = true;
  const minor = text('minor');
  if (minor === 'yes' || minor === 'no') out.minor = minor === 'yes';
  const followUp = text('followUp');
  if (followUp && (FOLLOW_UP_FILTERS as readonly string[]).includes(followUp))
    out.followUp = followUp as FollowUpFilter;

  const group = text('group');
  if (group === 'no_group') out.noGroup = true;
  else if (group && UUID.test(group)) out.groupId = group;
  const tag = id('tag');
  if (tag) out.tagIds = tag;
  const segment = id('segment');
  if (segment) out.segmentId = segment;
  const team = id('team');
  if (team) out.teamId = team;

  // Owner: people's ids and/or `none` (no owner), comma-joined.
  const tokens = (text('owner') ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t, i, all) => (t === 'none' || UUID.test(t)) && all.indexOf(t) === i);
  const owners = tokens.filter((t) => t !== 'none');
  if (owners.length > 0) out.ownerIds = owners.join(',');
  if (tokens.includes('none')) out.unassigned = true;

  const rules =
    validRules(params.rules) ??
    (filter.op || filter.conditions ? validRules(JSON.stringify(filter)) : undefined);
  if (rules) out.rules = rules;
  return out;
}

/**
 * What a view asks the API for. A built-in view is a plain filter of the contact list. A saved view carries the filters it was
 * saved with, which the server does the matching for (its condition tree goes as the `rules` text). `userId` is the signed-in
 * person: "My contacts" are the ones they own.
 */
export function viewFilters(
  view: ChosenView,
  userId: string | undefined,
  now = new Date(),
): ContactFilters {
  if (view.kind === 'custom') return savedViewFilters(view.filter);
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
