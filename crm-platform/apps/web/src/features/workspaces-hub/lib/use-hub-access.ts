'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMyPermissions, rbacKeys } from '@/features/roles-permissions/lib/api';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { hubAccess, type HubAccess } from './permissions';

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
