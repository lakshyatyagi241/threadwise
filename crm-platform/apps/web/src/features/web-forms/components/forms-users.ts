'use client';

import { useQuery } from '@tanstack/react-query';
import { pageResponseSchema, wspMemberSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * The workspace's active members for the owner and notification pickers. `/workspace/members` is readable by any signed-in member.
 * Social leads has the same list behind its own feature boundary, so this reads the endpoint itself instead of importing it.
 */
export interface FormUser {
  id: string;
  name: string;
  email: string;
}

export const formUserKeys = { members: ['web-forms', 'picker', 'members'] as const };

export async function fetchFormUsers(signal?: AbortSignal): Promise<FormUser[]> {
  const schema = pageResponseSchema(wspMemberSchema);
  const out: FormUser[] = [];
  let cursor: string | undefined;
  // A workspace has a few hundred members at most; the cap only stops a server that never ends its pages.
  for (let i = 0; i < 20; i++) {
    const page = await apiFetch('/workspace/members', {
      query: { limit: 100, cursor },
      schema,
      signal,
    });
    for (const m of page.data) {
      if (m.status === 'active') out.push({ id: m.id, name: m.fullName, email: m.email });
    }
    if (!page.page.hasMore || !page.page.nextCursor) break;
    cursor = page.page.nextCursor;
  }
  return out;
}

export const useFormUsers = () =>
  useQuery({
    queryKey: formUserKeys.members,
    queryFn: ({ signal }) => fetchFormUsers(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
