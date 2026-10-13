'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { assigneeResponseSchema, type AssigneeResponse } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { KEYS } from './contacts';

/** A person who can own a contact. `canAssign` is the API's answer for the signed-in person's record scope. */
export type Owner = AssigneeResponse;

/**
 * The workspace's active people, for the Owner column, filter, form and detail (`GET /contacts/assignees`, which needs
 * only the contacts read permission). Each row says whether the caller's record scope lets them hand a contact to that
 * person; the server enforces it again on every write. When the call is refused the signed-in person alone is offered,
 * so a form can still keep a contact for yourself.
 */
export function useOwners() {
  const session = useSession();
  return useQuery({
    queryKey: KEYS.owners,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<Owner[]> => {
      try {
        const rows = await apiFetch('/contacts/assignees', {
          schema: z.array(assigneeResponseSchema),
          signal,
        });
        if (rows.length > 0) return rows;
      } catch {
        /* falls through to the signed-in person */
      }
      return [
        {
          id: session.user.id,
          fullName: session.user.displayName ?? session.user.fullName,
          email: session.user.email,
          canAssign: true,
        },
      ];
    },
  });
}

/** Owners by id, so a table of N rows resolves N names without N searches. */
export function useOwnerNames(): {
  owners: readonly Owner[];
  nameOf: (id: string | null | undefined) => string | undefined;
  /** The people have not answered yet. */
  loading: boolean;
} {
  const q = useOwners();
  const owners = useMemo(() => q.data ?? [], [q.data]);
  const byId = useMemo(() => new Map(owners.map((o) => [o.id, o.fullName])), [owners]);
  return { owners, nameOf: (id) => (id ? byId.get(id) : undefined), loading: q.isPending };
}
