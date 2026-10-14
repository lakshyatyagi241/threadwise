'use client';

import { useQuery } from '@tanstack/react-query';
import {
  memberLeaveListSchema,
  memberLeaveOverviewSchema,
  memberLeaveSchema,
  memberDelegateSchema,
  ownerReassignBatchSchema,
  ownerReassignPreviewResponseSchema,
  type CreateMemberLeaveInput,
  type CreateOwnerReassignInput,
  type UpdateMemberLeaveInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';

const base = '/workspace';

export const LEAVE_KEYS = {
  list: ['workspaces-teams-tenancy', 'leaves'] as const,
  overview: (member: string) => ['workspaces-teams-tenancy', 'leave-overview', member] as const,
  batches: (member: string) => ['workspaces-teams-tenancy', 'reassignments', member] as const,
};

const delegateResponseSchema = z.object({ delegate: memberDelegateSchema.nullable() });
const batchListSchema = z.object({ data: z.array(ownerReassignBatchSchema) });

/** Every call of the leave, delegate and reassign parts of the members screen. Members, leaves and batches are named by uuid. */
export const leaveApi = {
  list: (signal?: AbortSignal) =>
    apiFetch(`${base}/leaves`, { schema: memberLeaveListSchema, signal }),
  overview: (member: string, signal?: AbortSignal) =>
    apiFetch(`${base}/members/${member}/leave`, { schema: memberLeaveOverviewSchema, signal }),
  create: (member: string, input: CreateMemberLeaveInput) =>
    apiFetch(`${base}/members/${member}/leaves`, {
      method: 'POST',
      body: input,
      schema: memberLeaveSchema,
    }),
  update: (id: string, input: UpdateMemberLeaveInput) =>
    apiFetch(`${base}/leaves/${id}`, { method: 'PATCH', body: input, schema: memberLeaveSchema }),
  end: (id: string) =>
    apiFetch(`${base}/leaves/${id}`, { method: 'DELETE', schema: memberLeaveSchema }),
  setDelegate: (member: string, delegateId: string | null) =>
    apiFetch(`${base}/members/${member}/delegate`, {
      method: 'PUT',
      body: { delegateId },
      schema: delegateResponseSchema,
    }),

  previewReassign: (fromUserId: string) =>
    apiFetch('/owner-reassignments/preview', {
      method: 'POST',
      body: { fromUserId },
      schema: ownerReassignPreviewResponseSchema,
    }),
  reassign: (input: CreateOwnerReassignInput) =>
    apiFetch('/owner-reassignments', {
      method: 'POST',
      body: input,
      schema: ownerReassignBatchSchema,
    }),
  restore: (id: string) =>
    apiFetch(`/owner-reassignments/${id}/restore`, {
      method: 'POST',
      schema: ownerReassignBatchSchema,
    }),
  batches: (fromUserId: string, signal?: AbortSignal) =>
    apiFetch('/owner-reassignments', { query: { fromUserId }, schema: batchListSchema, signal }),
};

/** Every open leave of the workspace (one call for the whole table's badges). */
export function useLeaves() {
  return useQuery({
    queryKey: LEAVE_KEYS.list,
    queryFn: ({ signal }) => leaveApi.list(signal),
    retry: false,
  });
}

export function useLeaveOverview(member: string | null) {
  return useQuery({
    queryKey: LEAVE_KEYS.overview(member ?? ''),
    queryFn: ({ signal }) => leaveApi.overview(member!, signal),
    enabled: member !== null,
    retry: false,
  });
}

export function useBatches(member: string | null, enabled: boolean) {
  return useQuery({
    queryKey: LEAVE_KEYS.batches(member ?? ''),
    queryFn: ({ signal }) => leaveApi.batches(member!, signal),
    enabled: member !== null && enabled,
    retry: false,
  });
}
