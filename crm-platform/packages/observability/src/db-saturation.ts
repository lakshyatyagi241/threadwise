import type { Registry } from './prometheus-text';

/** The slice of a `pg.Pool` we read; counts only, no query. */
export interface PoolLike {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  options?: { max?: number };
}

/**
 * Postgres pool saturation and outbox backlog as Prometheus series (item #75, saturation signal). Labels are the fixed pool name
 * (primary or replica), never a tenant. `waiting` > 0 is the queue of callers behind an exhausted pool.
 */
export function createDbSaturationMetrics(registry: Registry) {
  const conns = registry.gauge(
    'crm_db_pool_connections',
    'Pool connections by pool and state (total, idle)',
  );
  const waiting = registry.gauge(
    'crm_db_pool_waiting',
    'Callers waiting for a pool connection, by pool',
  );
  const max = registry.gauge('crm_db_pool_max', 'Configured pool size, by pool');
  const ready = registry.gauge(
    'crm_outbox_ready',
    'Outbox events due and not yet picked up (capped at 10000)',
  );
  const lag = registry.gauge(
    'crm_outbox_oldest_due_seconds',
    'Seconds the oldest due outbox event has been due (0 when none)',
  );
  const dead = registry.gauge(
    'crm_outbox_dead',
    'Outbox events that exhausted their retries (capped at 10000)',
  );
  const up = registry.gauge('crm_postgres_up', '1 when SELECT 1 on the primary answered within 2 s, else 0');
  return {
    recordUp(ok: boolean): void {
      up.set(ok ? 1 : 0);
    },
    recordPool(pool: string, p: PoolLike): void {
      conns.set(p.totalCount, { pool, state: 'total' });
      conns.set(p.idleCount, { pool, state: 'idle' });
      waiting.set(p.waitingCount, { pool });
      max.set(p.options?.max ?? 0, { pool });
    },
    recordOutbox(s: { ready: number; lagSeconds: number; dead?: number }): void {
      ready.set(s.ready);
      lag.set(s.lagSeconds);
      dead.set(s.dead ?? 0);
    },
  };
}
