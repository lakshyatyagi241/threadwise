import {
  inboxAssigneesResponseSchema,
  routingRuleListResponseSchema,
  routingRuleSchema,
  routingSettingsSchema,
  type UpdateRoutingRuleInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls behind Settings, Auto-assignment (TW-TIB2-001 and 004 to 009; the Geta app's "Chat assignment"): the rules that give each new
 * conversation to the right agent, and the one setting that keeps returning contacts with their agent. Every route needs the plan feature
 * `inbox_routing` (422 PLAN_FEATURE_LOCKED, reads included); reading needs `inbox.settings.read`, writing `inbox.routing.manage`.
 */

export const RULES_PAGE_SIZE = 50;

/** One page of rules in priority order (the first one that matches wins), with how many the plan allows. */
export const fetchRules = (q: string, cursor: string | undefined, signal?: AbortSignal) =>
  apiFetch('/v2/inbox/routing/rules', {
    query: { q: q.trim() || undefined, limit: RULES_PAGE_SIZE, cursor },
    schema: routingRuleListResponseSchema,
    signal,
  });

export const fetchRule = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/inbox/routing/rules/${encodeURIComponent(id)}`, {
    schema: routingRuleSchema,
    signal,
  });

/** Switches a rule on or off (or, later, edits it): the version that was read goes with it, a stale one is 409 ROW_VERSION_CONFLICT. */
export const updateRule = (id: string, body: UpdateRoutingRuleInput) =>
  apiFetch(`/v2/inbox/routing/rules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    schema: routingRuleSchema,
  });

/** Puts the listed rules in this priority order; they keep their slots among the others. */
export const reorderRules = (ids: string[]) =>
  apiFetch('/v2/inbox/routing/rules/reorder', { method: 'POST', body: { ids } });

/** Copies a rule: the copy goes last, switched off, and counts against the plan's limit. */
export const duplicateRule = (id: string) =>
  apiFetch(`/v2/inbox/routing/rules/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    schema: routingRuleSchema,
  });

export const deleteRule = (id: string) =>
  apiFetch(`/v2/inbox/routing/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const fetchRoutingSettings = (signal?: AbortSignal) =>
  apiFetch('/v2/inbox/routing/settings', { schema: routingSettingsSchema, signal });

export const saveRoutingSettings = (keepContactAgent: boolean) =>
  apiFetch('/v2/inbox/routing/settings', {
    method: 'PUT',
    body: { keepContactAgent },
    schema: routingSettingsSchema,
  });

/** The people and teams a conversation can be given to: here only to put names to the ids a rule holds. */
export const fetchAssigneeNames = (signal?: AbortSignal) =>
  apiFetch('/v2/inbox/assignees', { schema: inboxAssigneesResponseSchema, signal });
