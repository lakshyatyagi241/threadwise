import { WorkerHost } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { getRuntimeMonitor } from '@crm/observability';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT, REDIS_QUEUE_CLIENT } from '../../../../infra/redis/redis.module';
import { createRedisSampler } from './redis-pressure';
import { guardWorkerAgainstOom, type GuardableWorker } from './worker-oom-guard';

const INTERVAL_MS = 15_000;

/** Puts the OOM guard on every BullMQ worker the process created, in one place (same discovery as JobMetricsService). */
@Injectable()
export class WorkerOomGuardService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerOomGuardService.name);

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): number {
    let guarded = 0;
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!(instance instanceof WorkerHost)) continue;
      try {
        guardWorkerAgainstOom(instance.worker as unknown as GuardableWorker, { log: this.logger });
        guarded += 1;
      } catch (err) {
        this.logger.warn({ err, processor: wrapper.name }, 'OOM guard not attached to a worker');
      }
    }
    return guarded;
  }
}

/** Exports Redis memory, clients, keys and evictions every 15 s (crm_redis_*, one `redis` label per server). One `INFO` each, never a key scan. */
@Injectable()
export class RedisPressureService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(REDIS_QUEUE_CLIENT) private readonly queueRedis: Redis,
    @Inject(REDIS_CLIENT) private readonly cacheRedis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    const monitor = getRuntimeMonitor();
    if (!monitor) return;
    const sampler = createRedisSampler(monitor.metrics);
    const tick = async () => {
      if (this.running) return; // a slow Redis must not stack samples
      this.running = true;
      try {
        await sampler.sample(this.queueRedis, 'queue');
        // The same connection until REDIS_CACHE_URL points at another server: then it is a second Redis with its own memory.
        if (this.cacheRedis !== this.queueRedis) await sampler.sample(this.cacheRedis, 'cache');
      } finally {
        this.running = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Imported by the worker process only. */
@Module({ imports: [DiscoveryModule], providers: [WorkerOomGuardService, RedisPressureService] })
export class RedisPressureModule {}
