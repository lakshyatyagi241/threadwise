'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { call } from '../api/http';

const memberPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), fullName: z.string() })),
});
export type Member = z.infer<typeof memberPageSchema>['data'][number];

/**
 * Workspace members for an owner select. Listing staff needs a permission not every role has, so when the call is refused the
 * select still offers the signed-in person.
 */
export function useMembers(enabled = true) {
  const session = useSession();
  return useQuery({
    queryKey: ['invoicing', 'members'],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<Member[]> => {
      try {
        const rows = (
          await call('/users', { query: { limit: 200 }, schema: memberPageSchema, signal })
        ).data;
        if (rows.length > 0) return rows;
      } catch {
        /* falls through to the signed-in person */
      }
      return [{ id: session.user.id, fullName: session.user.displayName ?? session.user.fullName }];
    },
  });
}
