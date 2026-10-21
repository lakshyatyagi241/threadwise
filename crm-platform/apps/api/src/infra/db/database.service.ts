import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { createDbSaturationMetrics, getRuntimeMonitor } from '@crm/observability';
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
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private poolTimer?: NodeJS.Timeout;

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
    return withTenant(this.primary, this.tenantOf(ctx), fn);
  }

  /**
   * Same, but against the replica. For partner-portal and /public/v1 reads.
   * Do not read your own write through this — replication lag is real.
   */
  async txReplica<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = RequestContextStore.require();
    return withTenant(this.replica, this.tenantOf(ctx), fn);
  }

  /** The act-as operator (when there is one) rides along so audit rows written in the transaction name them. */
  private tenantOf(ctx: ReturnType<typeof RequestContextStore.require>): TenantContext {
    return {
      orgId: ctx.orgId,
      userId: ctx.userId,
      impersonation: ctx.impersonation
        ? { operatorUuid: ctx.impersonation.operatorUuid, sessionUuid: ctx.impersonation.sessionId }
        : null,
    };
  }

  /** Explicit tenant, for background jobs that carry org_id in the payload. */
  async txAs<T>(tenant: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    // Request-side code often names its own tenant (the auth flows do); inside an act-as request, in that same tenant, the operator
    // still rides along so the audit rows say so. A background job has no request context and is untouched.
    const ctx = RequestContextStore.peek();
    const impersonation =
      tenant.impersonation === undefined && ctx?.impersonation && ctx.orgId === tenant.orgId
        ? { operatorUuid: ctx.impersonation.operatorUuid, sessionUuid: ctx.impersonation.sessionId }
        : tenant.impersonation;
    return withTenant(this.primary, { ...tenant, impersonation }, fn);
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

  /**
   * Closed in `onApplicationShutdown`, the last shutdown step, not `onModuleDestroy`: a job still running while the worker drains
   * (WorkerDrainService) and a request still finishing need the pool until then.
   */
  onModuleInit(): void {
    const monitor = getRuntimeMonitor();
    if (!monitor) return;
    const m = createDbSaturationMetrics(monitor.metrics);
    const tick = () => {
      m.recordPool('primary', this.clients.primary.pool);
      if (this.clients.replica !== this.clients.primary) m.recordPool('replica', this.clients.replica.pool);
    };
    tick();
    this.poolTimer = setInterval(tick, 10_000);
    this.poolTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.poolTimer) clearInterval(this.poolTimer);
    this.logger.log('closing database pools');
    await this.clients.close();
  }
}
