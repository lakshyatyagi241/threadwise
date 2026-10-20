import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RecordScope } from '@crm/contracts';
import { RequestContextStore, type RequestContext } from '../context/request-context';

export const IS_PUBLIC_KEY = 'auth:public';
export const REQUIRED_PERMISSION_KEY = 'rbac:permission';
export const READ_REPLICA_KEY = 'db:read-replica';
export const IDEMPOTENT_KEY = 'http:idempotent';
export const ACTOR_KINDS_KEY = 'auth:actor-kinds';

/** No authentication. Webhooks, health checks, login endpoints. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Capability required to reach this handler. Pass more than one key when a
 * route serves several moduleKeys under one path (e.g. field-metadata's
 * contact-properties vs company-properties) and any one of them should let
 * the caller in — this is a coarse OR gate only, decorator metadata can't see
 * the request body. The service layer still must check the *specific*
 * moduleKey's key once it knows which row is actually being touched.
 *
 * The guard resolves the caller's merged grants (deny beats allow) and also
 * stashes the full grant set, so the service layer can do that finer check
 * (or narrow a query to team/own) without re-reading the grant.
 */
export const RequirePermission = (...keys: string[]) => SetMetadata(REQUIRED_PERMISSION_KEY, keys);

/**
 * Route this handler's reads to the replica.
 *
 * Only for handlers that do not read their own writes — replication lag makes
 * "POST then GET" return stale data, and that bug is invisible in development
 * where the replica is the primary.
 */
export const ReadReplica = () => SetMetadata(READ_REPLICA_KEY, true);

/**
 * Requires an Idempotency-Key header and replays the stored response on a
 * repeat. Mandatory on anything that moves money or sends a message.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

/** Restricts a route to specific actor pools, e.g. @ActorKinds('partner_agent'). */
export const ActorKinds = (...kinds: RequestContext['actorType'][]) =>
  SetMetadata(ACTOR_KINDS_KEY, kinds);

/** The current request context (org, actor, grants, request id). */
export const CurrentActor = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): RequestContext => RequestContextStore.require(),
);

/** The record scope granted for this route: 'all' | 'team' | 'team_and_below' | 'own'. */
export const GrantedScope = createParamDecorator(
  (data: string, _ctx: ExecutionContext): RecordScope => {
    const ctx = RequestContextStore.require();
    return (ctx.grants?.get(data)?.scope ?? 'own') as RecordScope;
  },
);
