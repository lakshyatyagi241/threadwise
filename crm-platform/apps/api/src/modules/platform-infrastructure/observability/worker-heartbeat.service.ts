import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createDbSaturationMetrics, getRuntimeMonitor } from '@crm/observability';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { INFRA_ENV, type InfraEnv } from '../../../config/domains/platform-infrastructure.env';
import {
  ALIVE_FOR_BEATS,
  instanceId,
  OUTBOX_SAMPLE_KEY,
  READY_CAP,
  WORKERS_KEY,
  type OutboxSample,
} from './worker-heartbeat';

/**
 * Worker side (TW-INFRA-015): every `INFRA_WORKER_HEARTBEAT_SECONDS` records "this worker is alive" and samples how far behind
 * the outbox is. Imported only by the worker process.
 *
 * The sample is two index-backed reads on `idx_outbox_pending` (a capped count and the first due row), so it stays cheap when
 * the backlog is huge, which is exactly when it matters. A failed beat is logged and the next one tries again: observability
 * must never take the worker down.
 */
@Injectable()
export class WorkerHeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private readonly id = instanceId(hostname(), process.pid);
  private timer: NodeJS.Timeout | undefined;
  private readonly monitor = getRuntimeMonitor();
  private readonly outboxGauges = this.monitor ? createDbSaturationMetrics(this.monitor.metrics) : undefined;

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(INFRA_ENV) private readonly env: InfraEnv,
  ) {}

  onApplicationBootstrap(): void {
    const everyMs = this.env.INFRA_WORKER_HEARTBEAT_SECONDS * 1000;
    void this.beat();
    this.timer = setInterval(() => void this.beat(), everyMs);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    // Leaving cleanly shows as "gone" at once instead of "alive" for three more beats.
    await this.redis.zrem(WORKERS_KEY, this.id).catch(() => undefined);
  }

  async beat(now: number = Date.now()): Promise<void> {
    const window = this.env.INFRA_WORKER_HEARTBEAT_SECONDS * ALIVE_FOR_BEATS * 1000;
    try {
      await this.redis
        .multi()
        .zadd(WORKERS_KEY, now, this.id)
        .zremrangebyscore(WORKERS_KEY, '-inf', now - window * 2)
        .exec();
    } catch (err) {
      this.logger.warn({ err }, 'worker heartbeat could not reach Redis');
    }
    try {
      const sample = await this.sampleOutbox(now);
      this.outboxGauges?.recordOutbox(sample);
      await this.redis.set(OUTBOX_SAMPLE_KEY, JSON.stringify(sample), 'PX', window * 2);
    } catch (err) {
      this.logger.warn({ err }, 'outbox sample failed');
    }
  }

  private async sampleOutbox(now: number): Promise<OutboxSample> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          (SELECT count(*) FROM (
             SELECT 1 FROM event_outbox
             WHERE status = 'pending' AND available_at <= now()
             LIMIT ${READY_CAP}) due)::int AS ready,
          (SELECT floor(extract(epoch FROM now() - available_at))::int FROM event_outbox
             WHERE status = 'pending' AND available_at <= now()
             ORDER BY available_at, id LIMIT 1) AS lag_seconds,
          (SELECT count(*) FROM (
             SELECT 1 FROM event_outbox
             WHERE status = 'dead'
             LIMIT ${READY_CAP}) d)::int AS dead
      `);
      const row = res.rows[0] as
        { ready: number; lag_seconds: number | null; dead?: number } | undefined;
      return {
        ready: Number(row?.ready ?? 0),
        lagSeconds: Math.max(0, Number(row?.lag_seconds ?? 0)),
        dead: Number(row?.dead ?? 0),
        sampledAt: now,
      };
    });
  }
}
