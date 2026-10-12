import { lifecycleStageSchema } from '@crm/contracts';
import type { ContactFilters } from './api';

/** Nothing switched on: the list shows every contact. */
export const NO_FILTERS: ContactFilters = {};

/** The stages the API knows by name. A workspace may add its own; those still show on a contact, they are just not offered here. */
export const LIFECYCLE_STAGES = lifecycleStageSchema.options;

/**
 * How many filter groups of the filter sheet are switched on (the search text has its own field, and the owner, date and rule
 * conditions come from the chosen view, which the title shows).
 */
export function activeFilterCount(filters: ContactFilters): number {
  return [filters.lifecycleStage, filters.source, filters.unsubscribed].filter(
    (v) => v !== undefined && v !== '',
  ).length;
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
    ...(filters.createdFrom ? { createdFrom: filters.createdFrom } : {}),
    ...(filters.rules ? { rules: filters.rules } : {}),
  };
}
