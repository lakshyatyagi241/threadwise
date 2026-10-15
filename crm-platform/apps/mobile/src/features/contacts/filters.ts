import { lifecycleStageSchema } from '@crm/contracts';
import type { ContactFilters } from './api';

/** Nothing switched on: the list shows every contact. */
export const NO_FILTERS: ContactFilters = {};

/** The stages the API knows by name. A workspace may add its own; those still show on a contact, they are just not offered here. */
export const LIFECYCLE_STAGES = lifecycleStageSchema.options;

/**
 * How many filter categories of the filter screen are switched on (the search text has its own field, and the view's own rules
 * come from the chosen view, which the title shows). The owner counts once, whether it names people, "no owner" or both, and
 * the created date counts once for either end.
 */
export function activeFilterCount(filters: ContactFilters): number {
  // `unsubscribed: false` ("Subscribed") is a real choice, so only an absent or empty value is "off".
  const set = (v: unknown) => v !== undefined && v !== '' && v !== null;
  return [
    filters.ownerIds || filters.unassigned || undefined,
    filters.lifecycleStage,
    filters.createdFrom || filters.createdTo || undefined,
    filters.source,
    filters.unsubscribed,
  ].filter(set).length;
}

/** Drops empty values so a cleared field is not sent as `source=`. */
export function cleanFilters(filters: ContactFilters): ContactFilters {
  const source = filters.source?.trim();
  return {
    ...(filters.q?.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.lifecycleStage ? { lifecycleStage: filters.lifecycleStage } : {}),
    ...(source ? { source } : {}),
    ...(filters.unsubscribed !== undefined ? { unsubscribed: filters.unsubscribed } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.ownerIds ? { ownerIds: filters.ownerIds } : {}),
    ...(filters.unassigned ? { unassigned: true } : {}),
    ...(filters.createdFrom ? { createdFrom: filters.createdFrom } : {}),
    ...(filters.createdTo ? { createdTo: filters.createdTo } : {}),
    ...(filters.rules ? { rules: filters.rules } : {}),
  };
}
