import {
  wabaNumberThroughputDetailSchema,
  wabaNumberThroughputSchema,
  wabaThroughputOverviewSchema,
  wabaThroughputSettingsResponseSchema,
  type UpdateWabaNumberControlInput,
  type UpdateWabaThroughputSettingsInput,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** Operator console, through the same-origin operator proxy (`/api/platform/*` becomes `/v2/platform/*`). */
const ROOT = '/waba/throughput';

/** The live view polls; a hidden tab stops (react-query's default), and a failed poll keeps the last good data on screen. */
export const WAT_POLL_MS = 3_000;

export const watKeys = {
  all: ['operator', 'waba-throughput'] as const,
  overview: (search: string) => ['operator', 'waba-throughput', 'overview', search] as const,
  overviewAll: ['operator', 'waba-throughput', 'overview'] as const,
  one: (id: string) => ['operator', 'waba-throughput', 'one', id] as const,
};

export const fetchOverview = (search: string, signal?: AbortSignal) =>
  operatorFetch(ROOT, {
    query: { search: search.trim() || undefined },
    schema: wabaThroughputOverviewSchema,
    signal,
  });

export const fetchNumber = (id: string, signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/numbers/${id}`, { schema: wabaNumberThroughputDetailSchema, signal });

export const saveSettings = (body: UpdateWabaThroughputSettingsInput) =>
  operatorFetch(`${ROOT}/settings`, {
    method: 'PATCH',
    body,
    schema: wabaThroughputSettingsResponseSchema,
  });

export const saveControl = (id: string, body: UpdateWabaNumberControlInput) =>
  operatorFetch(`${ROOT}/numbers/${id}`, {
    method: 'PATCH',
    body,
    schema: wabaNumberThroughputSchema,
  });

export const refreshNumber = (id: string) =>
  operatorFetch(`${ROOT}/numbers/${id}/refresh`, {
    method: 'POST',
    schema: wabaNumberThroughputSchema,
  });
