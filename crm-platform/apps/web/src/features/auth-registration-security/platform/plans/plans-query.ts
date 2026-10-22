import {
  addonPackListResponseSchema,
  planAddonImpactResponseSchema,
  planAddonOptionsResponseSchema,
  planAdminListResponseSchema,
} from '@crm/contracts';
import { operatorFetch } from '../operator-fetch';

/** The catalogue as the operator console reads it; the plans page and the registration form share one cache entry. */
export const PLANS_QUERY_KEY = ['operator', 'plans'] as const;

export const fetchPlans = (signal?: AbortSignal) =>
  operatorFetch('/plans', { schema: planAdminListResponseSchema, signal });

/** The paid add-on packs a plan may make visible (the editor's Add-ons tab). */
export const PLAN_ADDON_OPTIONS_QUERY_KEY = ['operator', 'plans', 'addon-options'] as const;

export const fetchPlanAddonOptions = (signal?: AbortSignal) =>
  operatorFetch('/plans/addon-options', { schema: planAddonOptionsResponseSchema, signal });

/** The plain add-on packs (no Marketplace app), drafts and inactive ones included: the editor's "Included add-ons" list. */
export const PLAN_INCLUDABLE_PACKS_QUERY_KEY = ['operator', 'plans', 'includable-packs'] as const;

export const fetchIncludablePacks = (signal?: AbortSignal) =>
  operatorFetch('/addons', { schema: addonPackListResponseSchema, signal });

/** How many of one plan's workspaces still pay for each plain add-on (what including it would stop renewing). */
export const planAddonImpactKey = (planId: string) =>
  ['operator', 'plans', planId, 'addon-impact'] as const;

export const fetchPlanAddonImpact = (planId: string, signal?: AbortSignal) =>
  operatorFetch(`/plans/${planId}/addon-impact`, { schema: planAddonImpactResponseSchema, signal });
