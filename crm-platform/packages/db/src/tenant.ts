import { sql } from 'drizzle-orm';
import type { Database, Tx } from './client';

export interface TenantContext {
  orgId: number;
  /** Staff user id, when the actor is staff. Recorded in audit rows. */
  userId?: number | null;
}

/**
 * Runs `fn` inside a transaction with the tenant GUCs set.
 *
 * Why set_config() and not `SET LOCAL app.org_id = $1`: SET LOCAL does not
 * accept bind parameters. String-interpolating an org id into SQL is how you
 * get a tenant-isolation bypass through SQL injection — the one place where
 * that bug would be catastrophic. set_config() is a normal function call and
 * takes a real parameter.
 *
 * The third argument `true` means transaction-local: the setting is reverted
 * on COMMIT or ROLLBACK, so a pooled connection can never leak one tenant's
 * context into the next request that borrows it.
 */
export async function withTenant<T>(
  db: Database,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(ctx.orgId) || ctx.orgId <= 0) {
    throw new Error(
      'withTenant: a valid orgId is required — refusing to run without tenant context',
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${String(ctx.orgId)}, true)`);
    await tx.execute(
      sql`select set_config('app.user_id', ${ctx.userId ? String(ctx.userId) : ''}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Runs `fn` with RLS lifted.
 *
 * Legitimate uses, and no others:
 *   - the outbox drain and other cross-tenant workers
 *   - billing roll-ups across orgs
 *   - partition maintenance
 *   - the API-key prefix lookup, which must resolve the org before a tenant
 *     context can exist
 *
 * Never call this from an HTTP request handler. The integration suite asserts
 * that no path reachable from a controller does.
 */
export async function withPrivileged<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.privileged', 'on', true)`);
    return fn(tx);
  });
}
