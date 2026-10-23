import { sql } from 'drizzle-orm';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { createDbSaturationMetrics, getRuntimeMonitor } from '@crm/observability';
import {
  retryTransaction,
  withPrivileged,
  withTenant,
  type Database,
  type DbClientPair,
  type RetryOptions,
  type TenantContext,
  type Tx,
} from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';

export const DB_CLIENT_PAIR = Symbol('DB_CLIENT_PAIR');

/** Internal: `DatabaseService.retrying()` is how callers ask for a retry. */
export interface TxOptions {
  retry?: RetryOptions | true;
}

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
  async tx<T>(fn: (tx: Tx) => Promise<T>, o?: TxOptions): Promise<T> {
    return this.attempt(() => {
      const ctx = RequestContextStore.require();
      return withTenant(this.primary, this.tenantOf(ctx), fn);
    }, o);
  }

  /**
   * The same three methods, but the transaction runs again when Postgres rolls it back for a deadlock or serialization failure.
   * Written as `this.db.retry.txAs(tenant, async (tx) => ...)` so the callback stays the last argument (see `retry`, `retryIdem`).
   *
   * Opt-in, because `fn` runs from the start each time: it must have no effect outside the transaction (no provider call, no queued
   * job, no write to a variable declared outside `fn`). Audit and outbox writes on `tx` are fine, they roll back with it.
   * `idempotent: true` also retries after a dropped connection; only when a run that already committed is harmless to repeat
   * (a ledger insert ON CONFLICT, an idempotency key), since the loss can arrive after COMMIT.
   */
  retrying(retry: RetryOptions | true = true) {
    return {
      tx: <T>(fn: (tx: Tx) => Promise<T>) => this.tx(fn, { retry }),
      txAs: <T>(tenant: TenantContext, fn: (tx: Tx) => Promise<T>) =>
        this.txAs(tenant, fn, { retry }),
      privileged: <T>(fn: (tx: Tx) => Promise<T>) => this.privileged(fn, { retry }),
    };
  }

  /** Retries a deadlock or serialization failure only. Safe for any work that has no effect outside its transaction. */
  readonly retry = this.retrying();

  /** Also retries a dropped connection. Only for work that is harmless to repeat after a commit (idempotency key, ON CONFLICT). */
  readonly retryIdem = this.retrying({ idempotent: true });

  /** Runs one attempt, or retries it per `o.retry`; each retry is logged so a hot lock shows up in the logs. */
  private attempt<T>(run: () => Promise<T>, o?: TxOptions): Promise<T> {
    if (!o?.retry) return run();
    const retry = o.retry === true ? {} : o.retry;
    return retryTransaction(run, {
      onRetry: ({ attempt, delayMs, err }) =>
        this.logger.warn(
          `transaction retried (attempt ${attempt}, wait ${delayMs} ms): ${(err as { code?: string; message?: string })?.code ?? (err as Error)?.message}`,
        ),
      ...retry,
    });
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
  async txAs<T>(tenant: TenantContext, fn: (tx: Tx) => Promise<T>, o?: TxOptions): Promise<T> {
    // Request-side code often names its own tenant (the auth flows do); inside an act-as request, in that same tenant, the operator
    // still rides along so the audit rows say so. A background job has no request context and is untouched.
    const ctx = RequestContextStore.peek();
    const impersonation =
      tenant.impersonation === undefined && ctx?.impersonation && ctx.orgId === tenant.orgId
        ? { operatorUuid: ctx.impersonation.operatorUuid, sessionUuid: ctx.impersonation.sessionId }
        : tenant.impersonation;
    return this.attempt(() => withTenant(this.primary, { ...tenant, impersonation }, fn), o);
  }

  /**
   * Cross-tenant transaction with RLS lifted.
   *
   * Legitimate callers: the outbox drain, billing roll-ups, partition
   * maintenance, and the API-key prefix lookup (which must find the org before
   * a tenant context can exist). Nothing reachable from an HTTP handler.
   */
  async privileged<T>(fn: (tx: Tx) => Promise<T>, o?: TxOptions): Promise<T> {
    return this.attempt(() => withPrivileged(this.primary, fn), o);
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
      if (this.clients.replica !== this.clients.primary)
        m.recordPool('replica', this.clients.replica.pool);
    };
    // crm_postgres_up: a real SELECT 1 with a deadline, so a hung or unreachable primary reads 0 instead of a stale pool snapshot.
    const ping = async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.primary.execute(sql`SELECT 1`),
          new Promise<never>(
            (_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), 2_000)),
          ),
        ]);
        m.recordUp(true);
      } catch {
        m.recordUp(false);
      } finally {
        clearTimeout(timer);
      }
    };
    const tickAll = () => {
      tick();
      void ping();
    };
    tickAll();
    this.poolTimer = setInterval(tickAll, 10_000);
    this.poolTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.poolTimer) clearInterval(this.poolTimer);
    this.logger.log('closing database pools');
    await this.clients.close();
  }
}
