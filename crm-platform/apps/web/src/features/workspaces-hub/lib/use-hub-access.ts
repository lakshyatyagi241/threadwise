'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMyPermissions, rbacKeys } from '@/features/roles-permissions/lib/api';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { hubAccess, retentionAccess, type HubAccess, type RetentionAccess } from './permissions';

/** What the signed-in operator may do on a workspace row: one permissions request for the whole screen. */
export function useHubAccess(): HubAccess {
  const { operator } = useOperator();
  const me = useQuery({
    queryKey: rbacKeys.me,
    queryFn: ({ signal }) => fetchMyPermissions(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return useMemo(() => hubAccess(me.data?.permissions, operator.role), [me.data, operator.role]);
}

/** What the signed-in operator may do on the Retention view (the same permissions request, shared through the query cache). */
export function useRetentionAccess(): RetentionAccess & { ready: boolean } {
  const me = useQuery({
    queryKey: rbacKeys.me,
    queryFn: ({ signal }) => fetchMyPermissions(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return useMemo(
    () => ({ ...retentionAccess(me.data?.permissions), ready: !me.isPending }),
    [me.data, me.isPending],
  );
}
