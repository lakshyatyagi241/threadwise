import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  withPrivileged,
  withTenant,
  type Database,
  type DbClientPair,
  type TenantContext,
  type Tx,
} from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';

export const DB_CLIENT_PAIR = Symbol('DB_CLIENT_PAIR');

/**
 * The only way the application reaches Postgres.
 *
 * Every method that touches tenant data goes through `tx()`, which opens a
 * transaction and sets the RLS GUCs. There is no "just grab a connection"
 * accessor on purpose: an un-scoped query is the one bug class this whole
 * design exists to prevent.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(DB_CLIENT_PAIR) private readonly clients: DbClientPair) {}

  /** Raw primary handle. For migrations, health checks and worker bootstrap only. */
  get primary(): Database {
    return this.clients.primary.db;
  }

  /** Raw replica handle. Falls back to the primary when none is configured. */
  get replica(): Database {
    return this.clients.replica.db;
  }

  /**
   * Runs `fn` in a transaction scoped to the current request's tenant.
   * Throws if there is no request context — failing closed, by design.
   */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = RequestContextStore.require();
    return withTenant(this.primary, { orgId: ctx.orgId, userId: ctx.userId }, fn);
  }

  /**
   * Same, but against the replica. For partner-portal and /public/v1 reads.
   * Do not read your own write through this — replication lag is real.
   */
  async txReplica<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = RequestContextStore.require();
    return withTenant(this.replica, { orgId: ctx.orgId, userId: ctx.userId }, fn);
  }

  /** Explicit tenant, for background jobs that carry org_id in the payload. */
  async txAs<T>(tenant: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.primary, tenant, fn);
  }

  /**
   * Cross-tenant transaction with RLS lifted.
   *
   * Legitimate callers: the outbox drain, billing roll-ups, partition
   * maintenance, and the API-key prefix lookup (which must find the org before
   * a tenant context can exist). Nothing reachable from an HTTP handler.
   */
  async privileged<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withPrivileged(this.primary, fn);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('closing database pools');
    await this.clients.close();
  }
}
