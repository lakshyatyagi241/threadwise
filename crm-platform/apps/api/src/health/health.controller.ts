import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { isDependencyOutage } from '../common/errors/dependency-outage';
import { DatabaseService } from '../infra/db/database.service';
import { HealthDb } from '../infra/db/side-pools';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import {
  SkipThrottle,
  WorkerStatusService,
  type OutboxCheck,
  type WorkersCheck,
} from '../modules/platform-infrastructure';

interface DependencyCheck {
  status: 'up' | 'down';
  latencyMs?: number;
  /** A fixed word, never the driver's message: this endpoint is public and those messages carry hosts, ports and role names. */
  error?: 'timeout' | 'unreachable' | 'error';
}

/**
 * Each dependency gets this long. A probe that waits for a silent database or Redis is worse than one that says "down": the orchestrator's
 * own probe timeout fires first, and it reads that as a dead process rather than a dead dependency.
 */
export const READY_CHECK_DEADLINE_MS = 2_000;
const DEADLINE = Symbol('deadline');

async function check(run: () => Promise<unknown>): Promise<DependencyCheck> {
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(DEADLINE), READY_CHECK_DEADLINE_MS);
      }),
    ]);
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      status: 'down',
      error: err === DEADLINE ? 'timeout' : isDependencyOutage(err) ? 'unreachable' : 'error',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Liveness and readiness.
 *
 * `/health` (liveness): is this process alive? It must NOT check dependencies.
 * If it did, a brief database blip would make the orchestrator kill every pod
 * — turning a recoverable dependency failure into a full outage.
 *
 * `/ready` (readiness): can this process serve traffic? It checks the
 * dependencies and returns 503 when they are down, so the load balancer pulls
 * this instance out without anything being restarted.
 */
@ApiTags('health')
@Public()
// Probes are called every few seconds by the orchestrator and load balancer; a limit would turn a busy minute into an outage.
@SkipThrottle()
// Version-neutral: probes live at /health and /ready forever. An orchestrator
// health check must not have to be updated because the API moved to v2.
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly db: DatabaseService,
    private readonly healthDb: HealthDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly workerStatus: WorkerStatusService,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness — process is running (no dependency checks)' })
  liveness() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness — dependencies reachable (503 when not)' })
  async readiness(@Res({ passthrough: true }) res: Response) {
    // Concurrent probes share one in-flight check: a burst of probes (or a scraper) costs the database one SELECT 1, not one per request.
    this.inflight ??= this.runReadiness().finally(() => (this.inflight = undefined));
    const { ready, body } = await this.inflight;
    res.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }

  private inflight?: Promise<{ ready: boolean; body: object }>;

  private async runReadiness() {
    const [primary, replica, redis, { workers, outbox }] = await Promise.all([
      this.checkPrimary(),
      this.checkReplica(),
      this.checkRedis(),
      this.checkWorkers(),
    ]);

    // Only the primary and Redis decide readiness. The worker and outbox checks are for monitoring: an API with no workers
    // (a deploy in progress, a crashed worker) still serves requests, and pulling it from rotation would turn a background
    // problem into an outage. The deploy health gate and the container healthcheck read the status code only.
    const ready = primary.status === 'up' && redis.status === 'up';
    return {
      ready,
      body: { status: ready ? 'ok' : 'degraded', checks: { primary, replica, redis, workers, outbox } },
    };
  }

  private checkPrimary(): Promise<DependencyCheck> {
    // The reserved pool: the probe must say "down" only when the database is, not when the shared pool is busy with other work.
    return check(() => this.healthDb.ping());
  }

  /**
   * The replica being down is NOT fatal: reads fall back to the primary, so the
   * instance stays in rotation. It is reported so monitoring can see it.
   */
  private checkReplica(): Promise<DependencyCheck> {
    return check(() => this.db.replica.execute(sql`SELECT 1`));
  }

  /** Written by the worker process, read from Redis. If Redis cannot be read the `redis` check already says so. */
  private async checkWorkers(): Promise<{
    workers: WorkersCheck | { status: 'unknown' };
    outbox: OutboxCheck;
  }> {
    const unknown = {
      workers: { status: 'unknown' as const },
      outbox: { status: 'unknown' as const },
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.workerStatus.read(),
        new Promise<typeof unknown>((ok) => {
          timer = setTimeout(() => ok(unknown), READY_CHECK_DEADLINE_MS);
        }),
      ]);
    } catch {
      return unknown;
    } finally {
      clearTimeout(timer);
    }
  }

  private checkRedis(): Promise<DependencyCheck> {
    return check(() => this.redis.ping());
  }
}
