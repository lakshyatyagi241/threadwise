import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is making the call. Four distinct pools, never conflated. */
export type ActorType = 'user' | 'partner_agent' | 'candidate' | 'bot' | 'api_key' | 'system';

export interface RequestContext {
  requestId: string;
  orgId: number;
  actorType: ActorType;
  /** Internal id of the actor within its own pool. */
  actorId: number | null;
  /** Staff user id — only set when actorType is 'user'. Written to audit rows. */
  userId: number | null;
  /** Resolved capability keys, populated by the permissions guard. */
  grants?: Map<string, { effect: 'allow' | 'deny'; scope: 'all' | 'team' | 'own' }>;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Ambient request context.
 *
 * Passing org/user/request ids through every function signature is the
 * alternative, and it rots: one helper forgets to forward orgId and the bug is
 * a cross-tenant read. AsyncLocalStorage keeps it out of signatures without
 * making it a global.
 */
export const RequestContextStore = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /** Context or undefined. Use in code that may legitimately run outside a request. */
  peek(): RequestContext | undefined {
    return storage.getStore();
  },

  /**
   * Context, or throw. Use everywhere that must be tenant-scoped — failing
   * loudly here is the whole point, since the fallback would be a query with
   * no tenant predicate.
   */
  require(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        'No request context. This code path must run inside RequestContextStore.run() — ' +
          'if it is a background job, set the context explicitly from the job payload.',
      );
    }
    return ctx;
  },

  orgId(): number {
    return RequestContextStore.require().orgId;
  },
};
