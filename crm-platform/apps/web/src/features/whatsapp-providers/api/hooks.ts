'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accessFrom, NO_ACCESS, type WapAccess } from '../lib/access';
import { mergePresets } from '../lib/presets';
import { KEYS, providersApi } from './client';

export const useProviders = () =>
  useQuery({
    queryKey: KEYS.list,
    queryFn: ({ signal }) => providersApi.list(signal),
    refetchOnWindowFocus: false,
  });

export const useProvider = (id: string) =>
  useQuery({
    queryKey: KEYS.one(id),
    queryFn: ({ signal }) => providersApi.get(id, signal),
    refetchOnWindowFocus: false,
  });

/**
 * The wizard's presets: the API's list, always completed with the three built-in starting points. A failed call (an older API
 * without presets) is not an error here: the built-ins stand in.
 */
export function usePresets() {
  const q = useQuery({
    queryKey: KEYS.presets,
    queryFn: ({ signal }) => providersApi.presets(signal),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const presets = useMemo(() => mergePresets(q.data?.data), [q.data]);
  return { presets, isPending: q.isPending, fromApi: q.isSuccess };
}

/** What the signed-in operator may do here. Nothing is offered until the permission map has loaded. */
export function useWapAccess(): { access: WapAccess; ready: boolean } {
  const q = useQuery({
    queryKey: KEYS.me,
    queryFn: ({ signal }) => providersApi.me(signal),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const access = useMemo(
    () => (q.data ? accessFrom(q.data.permissions, q.data.isSuperAdmin) : NO_ACCESS),
    [q.data],
  );
  return { access, ready: q.isSuccess };
}

/** After any write the list, the one provider and the assignments are stale. */
export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEYS.all });
}
