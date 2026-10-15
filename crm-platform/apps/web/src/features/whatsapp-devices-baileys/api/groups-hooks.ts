'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateWaDeviceGroupBody,
  HandleWaDeviceGroupJoinRequestsInput,
  UpdateWaDeviceGroupInput,
  WaGroupParticipantAction,
} from '@crm/contracts';
import { waGroupsApi, type GroupListParams } from './groups-service';

/** Under the `wadev` root of the personal numbers, so a device's removal can sweep them too. */
export const GROUP_KEYS = {
  all: (device: string) => ['wadev', 'groups', device] as const,
  state: (device: string) => ['wadev', 'groups', device, 'state'] as const,
  /** The list key prefix of a number (every filter). */
  lists: (device: string) => ['wadev', 'groups', device, 'list'] as const,
  list: (device: string, params: GroupListParams = {}) =>
    ['wadev', 'groups', device, 'list', params.status ?? 'all', params.q ?? ''] as const,
  members: (group: string, q = '') => ['wadev', 'groups-members', group, q] as const,
  membersAll: (group: string) => ['wadev', 'groups-members', group] as const,
  requests: (group: string) => ['wadev', 'groups-requests', group] as const,
  invite: (group: string) => ['wadev', 'groups-invite', group] as const,
};

/** Whether the tab can act for this number (connected, a worker holds it) and what is left of the limits. A minute is fresh enough. */
export function useWaGroupsState(device: string | null) {
  return useQuery({
    queryKey: GROUP_KEYS.state(device ?? ''),
    queryFn: ({ signal }) => waGroupsApi.state(device!, signal),
    enabled: device !== null,
    staleTime: 30_000,
    retry: false,
  });
}

/** Newest first, keyset paged; `pages[0].stats` are the counters of the whole number. */
export function useWaGroups(device: string | null, params: GroupListParams, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: GROUP_KEYS.list(device ?? '', params),
    queryFn: ({ pageParam, signal }) => waGroupsApi.list(device!, params, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    enabled: device !== null && enabled,
    retry: false,
  });
}

/** Members carry numbers (personal data): read when the window opens, never kept. */
export function useWaGroupMembers(device: string, group: string, q: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: GROUP_KEYS.members(group, q),
    queryFn: ({ pageParam, signal }) =>
      waGroupsApi.members(device, group, q || undefined, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

export function useWaGroupJoinRequests(device: string, group: string, enabled: boolean) {
  return useQuery({
    queryKey: GROUP_KEYS.requests(group),
    queryFn: ({ signal }) => waGroupsApi.joinRequests(device, group, signal),
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

/** The invite link is a bearer secret: read when the panel opens, never cached. */
export function useWaGroupInviteLink(device: string, group: string, enabled: boolean) {
  return useQuery({
    queryKey: GROUP_KEYS.invite(group),
    queryFn: ({ signal }) => waGroupsApi.inviteLink(device, group, signal),
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

/** After a write, the number's rows and counters (and the state, whose limits just moved) are read again. */
function useAfterWrite(device: string) {
  const qc = useQueryClient();
  return (group?: string) => {
    void qc.invalidateQueries({ queryKey: GROUP_KEYS.lists(device) });
    void qc.invalidateQueries({ queryKey: GROUP_KEYS.state(device) });
    if (group) {
      void qc.invalidateQueries({ queryKey: GROUP_KEYS.membersAll(group) });
      void qc.invalidateQueries({ queryKey: GROUP_KEYS.requests(group) });
    }
  };
}

export function useCreateWaGroup(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (input: CreateWaDeviceGroupBody) => waGroupsApi.create(device, input),
    onSettled: () => after(),
  });
}

export function useUpdateWaGroup(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (v: { group: string; input: UpdateWaDeviceGroupInput }) =>
      waGroupsApi.update(device, v.group, v.input),
    onSettled: (_d, _e, v) => after(v.group),
  });
}

export function useSetWaGroupPicture(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (v: { group: string; file: File }) =>
      waGroupsApi.setPicture(device, v.group, v.file),
    onSettled: (_d, _e, v) => after(v.group),
  });
}

export function useWaGroupParticipants(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (v: { group: string; action: WaGroupParticipantAction; numbers: string[] }) =>
      waGroupsApi.participants(device, v.group, v.action, v.numbers),
    onSettled: (_d, _e, v) => after(v.group),
  });
}

export function useHandleWaJoinRequests(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (v: { group: string; input: HandleWaDeviceGroupJoinRequestsInput }) =>
      waGroupsApi.handleJoinRequests(device, v.group, v.input),
    onSettled: (_d, _e, v) => after(v.group),
  });
}

export function useResetWaInviteLink(device: string) {
  const qc = useQueryClient();
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (group: string) => waGroupsApi.resetInviteLink(device, group),
    onSuccess: (link, group) => qc.setQueryData(GROUP_KEYS.invite(group), link),
    onSettled: (_d, _e, group) => after(group),
  });
}

export function useRemoveWaGroupPicture(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (group: string) => waGroupsApi.removePicture(device, group),
    onSettled: (_d, _e, group) => after(group),
  });
}

/** "Refresh from WhatsApp": reads the whole list now. A second call within a minute answers `throttled` without asking WhatsApp. */
export function useSyncWaGroups(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: () => waGroupsApi.sync(device),
    onSettled: () => after(),
  });
}

export function useWaJoinPreview(device: string) {
  return useMutation({
    mutationFn: (invite: string) => waGroupsApi.joinPreview(device, invite),
  });
}

export function useWaJoinByLink(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (invite: string) => waGroupsApi.join(device, invite),
    onSettled: () => after(),
  });
}

export function useLeaveWaGroup(device: string) {
  const after = useAfterWrite(device);
  return useMutation({
    mutationFn: (group: string) => waGroupsApi.leave(device, group),
    onSettled: (_d, _e, group) => after(group),
  });
}
