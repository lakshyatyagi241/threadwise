import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { createDbSaturationMetrics, getRuntimeMonitor } from '@crm/observability';
import {
  withPrivileged,
  withTenant,
  type Database,
  type DbClient,
  type TenantContext,
  type Tx,
} from '@crm/db';
import { sql } from 'drizzle-orm';

export const WEBHOOK_DB_CLIENT = Symbol('WEBHOOK_DB_CLIENT');
export const HEALTH_DB_CLIENT = Symbol('HEALTH_DB_CLIENT');

/** Reports a side pool's size and waiters beside `primary`/`replica`, so a saturated one is seen and alerted on. */
function reportPool(name: string, client: DbClient): NodeJS.Timeout | undefined {
  const monitor = getRuntimeMonitor();
  if (!monitor) return undefined;
  const m = createDbSaturationMetrics(monitor.metrics);
  const tick = () => m.recordPool(name, client.pool);
  tick();
  const timer = setInterval(tick, 10_000);
  timer.unref();
  return timer;
}

/**
 * A small pool of its own for the public webhook receivers. They are unauthenticated traffic the platform does not control the rate of,
 * so what they hold is capped apart from the pool every request and the readiness probe share.
 */
@Injectable()
export class WebhookDb implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(@Inject(WEBHOOK_DB_CLIENT) private readonly client: DbClient) {}

  onModuleInit(): void {
    this.timer = reportPool('webhook', this.client);
  }

  get primary(): Database {
    return this.client.db;
  }

  txAs<T>(tenant: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.client.db, tenant, fn);
  }

  /** The platform door (no tenant yet), for the lookups a webhook needs before it knows whose it is. */
  privileged<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withPrivileged(this.client.db, fn);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.client.close();
  }
}

/** A reserved connection for `/ready`: a busy main pool must not make the probe read "database down". */
@Injectable()
export class HealthDb implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(@Inject(HEALTH_DB_CLIENT) private readonly client: DbClient) {}

  onModuleInit(): void {
    this.timer = reportPool('health', this.client);
  }

  ping(): Promise<unknown> {
    return this.client.db.execute(sql`SELECT 1`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.client.close();
  }
}
