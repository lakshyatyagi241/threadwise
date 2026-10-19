import { RequestContextStore, type AuthPrefetch } from './request-context';

/**
 * Redis reads the later guards of a request need, started together by JwtAuthGuard.
 *
 * Why: JwtAuthGuard, AccountGateGuard and PermissionsGuard each await their own Redis read, one after the other, so a request paid
 * three sequential round trips for state that depends only on the (already verified) token. JwtAuthGuard now sends all of them in
 * the same instant as its own session read (ioredis writes them back to back on one connection: one round trip), and each guard's
 * service takes its result from here instead of asking again.
 *
 * What this is NOT: a cache and not a decision. Every value is the raw answer of a read that the consumer would have made itself
 * (a few milliseconds later), consumed once, and only if it was fetched for the same organization (and user). A miss is still a
 * miss: the consumer falls through to its own database path, and the database is never touched by the prefetch itself. A failed
 * read is replaced by the consumer's own fresh read, so its fail-open or fail-closed rule applies exactly as before.
 */
export const PREFETCH_FAILED = Symbol('auth-prefetch-failed');

export type PrefetchKind = 'orgSuspended' | 'gate' | 'grants';

/**
 * The prefetched promise for `kind`, or undefined when there is none for this organization (and user, when given). Removes it, so
 * a second call in the same request reads Redis again.
 */
export function takeAuthPrefetch<K extends PrefetchKind>(
  kind: K,
  orgId: number,
  userId?: number,
): AuthPrefetch[K] | undefined {
  const p = RequestContextStore.peek()?.prefetch;
  if (!p || p.orgId !== orgId) return undefined;
  if (userId !== undefined && p.userId !== userId) return undefined;
  const taken = p[kind];
  p[kind] = undefined;
  return taken;
}
