import { planAdminListResponseSchema } from '@crm/contracts';
import { operatorFetch } from '../operator-fetch';

/** The catalogue as the operator console reads it; the plans page and the registration form share one cache entry. */
export const PLANS_QUERY_KEY = ['operator', 'plans'] as const;

export const fetchPlans = (signal?: AbortSignal) =>
  operatorFetch('/plans', { schema: planAdminListResponseSchema, signal });
