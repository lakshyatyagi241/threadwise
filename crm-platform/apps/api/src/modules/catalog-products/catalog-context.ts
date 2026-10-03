import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../common/context/request-context';

/**
 * Runs `fn` with a request context for `orgId`. Inside an HTTP request that is the caller's own; in a sweep or a post-commit
 * push it is a `system` context, so the audit and outbox writes that need one work and are attributed to nobody.
 */
export function withOrgContext<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
  const current = RequestContextStore.peek();
  if (current && current.orgId === orgId) return fn();
  return RequestContextStore.run(
    {
      requestId: `cat-${randomUUID()}`,
      orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    fn,
  );
}

/** The acting staff user, or null outside a request. */
export const currentUserId = (): number | null => RequestContextStore.peek()?.userId ?? null;
