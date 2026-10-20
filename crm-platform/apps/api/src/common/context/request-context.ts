import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is making the call. Four distinct pools, never conflated. */
export type ActorType =
  'user' | 'partner_agent' | 'candidate' | 'bot' | 'api_key' | 'system' | 'platform_operator';

/** Set while a platform operator is acting as a workspace user through an act-as token (TW-WSP-032/033). */
export interface ImpersonationContext {
  /** impersonation_sessions.uuid */
  sessionId: string;
  /** platform_operators.id and uuid: the real actor behind every write of this request. */
  operatorId: number;
  operatorUuid: string;
  /** Every non-GET/HEAD request is refused. */
  readOnly: boolean;
  expiresAt: Date;
}

/**
 * Raw answers of Redis reads started early for the guards that follow (see auth-prefetch.ts). `PREFETCH_FAILED` (a symbol) stands
 * for a read that errored; `grants` carries RbacService's own result and is opaque here.
 */
export interface AuthPrefetch {
  readonly orgId: number;
  readonly userId: number;
  orgSuspended?: Promise<string | null | symbol>;
  gate?: Promise<string | null | symbol>;
  grants?: Promise<unknown>;
}

export interface RequestContext {
  requestId: string;
  orgId: number;
  actorType: ActorType;
  /** Internal id of the actor within its own pool. */
  actorId: number | null;
  /** Staff user id — only set when actorType is 'user'. Written to audit rows. */
  userId: number | null;
  /** Redis reads started early for the guards that follow; set by JwtAuthGuard, consumed once each. */
  prefetch?: AuthPrefetch;
  /** Resolved capability keys, populated by the permissions guard. */
  grants?: Map<string, { effect: 'allow' | 'deny'; scope: 'all' | 'team' | 'team_and_below' | 'own' }>;
  ip?: string;
  userAgent?: string;
  /** The auth_sessions / platform_sessions uuid behind this request, when there is one. */
  sessionId?: string;
  /** Operator role, only for actorType 'platform_operator'. */
  operatorRole?: 'super_admin' | 'support' | 'auditor';
  /** Present only on an act-as request: `actorType` is then 'user' (the workspace owner) and this names the operator behind it. */
  impersonation?: ImpersonationContext;
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
