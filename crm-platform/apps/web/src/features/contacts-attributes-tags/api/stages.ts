'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { statusOptionUsageResponseSchema, type StatusOptionResponse } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { KEYS } from './contacts';
import { statusOptionResponseSchema } from './schemas';

/**
 * Lifecycle stages and contact statuses are rows of `/v2/status-options` (module `contacts`, option group
 * `lifecycle_stage` / `status`). The list is read by `useStatusOptions` (api/attributes.ts); this file adds the writes
 * and the per-option contact counts the Contact stages screen needs.
 */

const USAGE_KEY = ['cat', 'status-usage'] as const;

/** Contacts holding each option of a group, by option id. Always fresh: it backs the delete warning. */
export function useStatusUsage(group: string, enabled = true) {
  return useQuery({
    queryKey: [...USAGE_KEY, group],
    enabled,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/status-options/usage', {
        query: { moduleKey: 'contacts', optionGroup: group },
        schema: statusOptionUsageResponseSchema,
        signal,
      });
      return new Map(res.data.map((r) => [r.id, r.count]));
    },
  });
}

export interface NewOption {
  value: string;
  label: string;
  color: string;
  isDefault: boolean;
  /** Lifecycle stages only. */
  isWon?: boolean;
  isLost?: boolean;
  /** Statuses only: the lifecycle stage option this status belongs to; absent = every stage. */
  stageOptionId?: string | null;
}

export const createStatusOption = (group: string, o: NewOption): Promise<StatusOptionResponse> =>
  apiFetch('/status-options', {
    method: 'POST',
    body: {
      moduleKey: 'contacts',
      optionGroup: group,
      value: o.value,
      label: o.label.trim(),
      color: o.color,
      isDefault: o.isDefault,
      ...(o.isWon ? { isWon: true } : {}),
      ...(o.isLost ? { isLost: true } : {}),
      ...(o.stageOptionId ? { stageOptionId: o.stageOptionId } : {}),
    },
    schema: statusOptionResponseSchema,
  });

/** Sends the rowVersion that was read; a stale one is a 409 the screen turns into "reload". */
export const updateStatusOption = (
  current: Pick<StatusOptionResponse, 'id' | 'rowVersion'>,
  patch: {
    label?: string;
    color?: string;
    isDefault?: boolean;
    isActive?: boolean;
    isWon?: boolean;
    isLost?: boolean;
    /** null = every stage. */
    stageOptionId?: string | null;
  },
): Promise<StatusOptionResponse> =>
  apiFetch(`/status-options/${current.id}`, {
    method: 'PATCH',
    body: {
      ...patch,
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      rowVersion: current.rowVersion,
    },
    schema: statusOptionResponseSchema,
  });

export const reorderStatusOptions = (group: string, orderedIds: string[]): Promise<void> =>
  apiFetch('/status-options/reorder', {
    method: 'POST',
    body: { moduleKey: 'contacts', optionGroup: group, orderedIds },
  });

/** Contacts that still hold the option are moved to `moveTo` first; without it the API answers 409 STATUS_OPTION_IN_USE. */
export const deleteStatusOption = (id: string, moveTo?: string): Promise<void> =>
  apiFetch(`/status-options/${id}`, { method: 'DELETE', query: moveTo ? { moveTo } : {} });

/** Pickers, the table and the usage counts all read these lists. */
export function invalidateStatusOptions(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.statusOptions }),
    qc.invalidateQueries({ queryKey: USAGE_KEY }),
  ]);
}
