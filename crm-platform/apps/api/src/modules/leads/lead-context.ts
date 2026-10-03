import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../common/context/request-context';

/**
 * Runs `fn` scoped to `orgId`. An admin's own request (their test lead, their retry, their edit) keeps its context, so the audit rows name
 * them; a hook or a connector, which has no user, runs as the system actor on a context of its own (the request id and address of the
 * request that brought it are kept when there is one, so a log line still correlates).
 */
export function runInOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
  const current = RequestContextStore.peek();
  if (current && current.orgId === orgId && current.actorType === 'user') return fn();
  return RequestContextStore.run(
    {
      requestId: current?.requestId ?? `lead-${randomUUID()}`,
      orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
      ip: current?.ip,
    },
    fn,
  );
}

/** The signed-in staff user of this context, or null when it is the system. */
export function actingUserId(): number | null {
  const ctx = RequestContextStore.peek();
  return ctx?.actorType === 'user' ? ctx.userId : null;
}
