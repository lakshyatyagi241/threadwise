import { planAddonOptionsResponseSchema, planAdminListResponseSchema } from '@crm/contracts';
import { operatorFetch } from '../operator-fetch';

/** The catalogue as the operator console reads it; the plans page and the registration form share one cache entry. */
export const PLANS_QUERY_KEY = ['operator', 'plans'] as const;

export const fetchPlans = (signal?: AbortSignal) =>
  operatorFetch('/plans', { schema: planAdminListResponseSchema, signal });

/** The paid add-on packs a plan may make visible (the editor's Add-ons tab). */
export const PLAN_ADDON_OPTIONS_QUERY_KEY = ['operator', 'plans', 'addon-options'] as const;

export const fetchPlanAddonOptions = (signal?: AbortSignal) =>
  operatorFetch('/plans/addon-options', { schema: planAddonOptionsResponseSchema, signal });
