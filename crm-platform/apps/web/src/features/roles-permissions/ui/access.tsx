'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PlatformMyPermissions } from '@crm/contracts';
import { fetchMyPermissions, rbacKeys } from '../lib/api';
import { LoadingBlock, NoAccess, QueryError } from './states';

/** The caller's own permission map, shared by every screen of the domain (one request). */
export function useMyPermissions() {
  const query = useQuery({
    queryKey: rbacKeys.me,
    queryFn: ({ signal }) => fetchMyPermissions(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  /** false only when the server said the caller lacks the key; unknown (still loading) counts as allowed so nothing flickers away. */
  const can = (key: string) => (query.data ? query.data.permissions[key] === true : true);
  return { ...query, can };
}

/**
 * Keeps a screen away from a server refusal: asks for the caller's map first and shows the no-access state when the
 * permission is missing, so the operator never triggers a denied request (each one is a logged security event).
 * The server stays the authority, a 403 later still lands in the same state.
 */
export function AccessGate({
  permission,
  children,
}: {
  permission: string;
  children: (me: PlatformMyPermissions) => ReactNode;
}) {
  const me = useMyPermissions();
  if (me.isPending) return <LoadingBlock />;
  if (me.isError) return <QueryError error={me.error} onRetry={() => void me.refetch()} />;
  if (me.data.permissions[permission] !== true) return <NoAccess permission={permission} />;
  return <>{children(me.data)}</>;
}
