import type { WspMember, WspRoleTier } from '@crm/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  changeMemberRole,
  fetchMembers,
  fetchMembersSummary,
  inviteMember,
  removeMember,
  resendInvite,
  resetMemberPassword,
} from './members-api';

export const membersKey = ['settings', 'members'] as const;

/** The members a page at a time, narrowed by what is typed and the role chosen. */
export const useMemberList = (q: string, tier: WspRoleTier | undefined) =>
  useInfiniteQuery({
    queryKey: [...membersKey, 'list', q.trim(), tier ?? 'all'],
    queryFn: ({ pageParam, signal }) => fetchMembers({ q, tier }, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined,
  });

/** Counts per role, the grantable roles, the seats, and what the caller may do. Short-lived: it moves with every change here. */
export const useMembersSummary = () =>
  useQuery({
    queryKey: [...membersKey, 'summary'],
    queryFn: ({ signal }) => fetchMembersSummary(signal),
  });

function useRefreshMembers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: membersKey });
}

export function useInviteMember() {
  const refresh = useRefreshMembers();
  return useMutation({
    mutationFn: (input: Parameters<typeof inviteMember>[0]) => inviteMember(input),
    onSuccess: refresh,
  });
}

export function useResendInvite() {
  const refresh = useRefreshMembers();
  return useMutation({ mutationFn: (m: WspMember) => resendInvite(m.id), onSettled: refresh });
}

export function useResetPassword() {
  const refresh = useRefreshMembers();
  return useMutation({
    mutationFn: (m: WspMember) => resetMemberPassword(m.id),
    onSettled: refresh,
  });
}

export function useChangeRole() {
  const refresh = useRefreshMembers();
  return useMutation({
    mutationFn: ({ member, roleId }: { member: WspMember; roleId: string }) =>
      changeMemberRole(member.id, { roleId, rowVersion: member.rowVersion }),
    // A conflict leaves the list holding an old version: read again either way.
    onSettled: refresh,
  });
}

export function useRemoveMember() {
  const refresh = useRefreshMembers();
  return useMutation({ mutationFn: (m: WspMember) => removeMember(m.id), onSettled: refresh });
}
