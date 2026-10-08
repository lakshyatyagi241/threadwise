import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../common/context/request-context';

/**
 * Runs `fn` as the system actor scoped to `orgId`: the public submission has no user and no tenant until the form's key has been looked
 * up, and the audit rows and outbox events it writes must carry the workspace the key proved. The request id and address of the request
 * that brought it are kept, so a log line still correlates.
 */
export function runAsSystemIn<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
  const current = RequestContextStore.peek();
  return RequestContextStore.run(
    {
      requestId: current?.requestId ?? `form-${randomUUID()}`,
      orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
      ip: current?.ip,
      userAgent: current?.userAgent,
    },
    fn,
  );
}
