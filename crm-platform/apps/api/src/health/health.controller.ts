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
import { DatabaseService } from '../infra/db/database.service';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { SkipThrottle } from '../modules/platform-infrastructure';

interface DependencyCheck {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    const [primary, replica, redis] = await Promise.all([
      this.checkPrimary(),
      this.checkReplica(),
      this.checkRedis(),
    ]);

    const ready = primary.status === 'up' && redis.status === 'up';
    res.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: ready ? 'ok' : 'degraded',
      checks: { primary, replica, redis },
    };
  }

  private async checkPrimary(): Promise<DependencyCheck> {
    const startedAt = Date.now();
    try {
      await this.db.primary.execute(sql`SELECT 1`);
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : 'unknown' };
    }
  }

  /**
   * The replica being down is NOT fatal: reads fall back to the primary, so the
   * instance stays in rotation. It is reported so monitoring can see it.
   */
  private async checkReplica(): Promise<DependencyCheck> {
    const startedAt = Date.now();
    try {
      await this.db.replica.execute(sql`SELECT 1`);
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : 'unknown' };
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    const startedAt = Date.now();
    try {
      await this.redis.ping();
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
