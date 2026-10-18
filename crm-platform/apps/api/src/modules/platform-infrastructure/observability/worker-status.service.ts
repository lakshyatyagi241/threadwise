import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { INFRA_ENV, type InfraEnv } from '../../../config/domains/platform-infrastructure.env';
import {
  ALIVE_FOR_BEATS,
  OUTBOX_SAMPLE_KEY,
  WORKERS_KEY,
  type OutboxSample,
} from './worker-heartbeat';

export interface WorkersCheck {
  /** `down` when no worker has beaten recently. Informational: the API serves requests without workers. */
  status: 'up' | 'down';
  count: number;
}

export interface OutboxCheck {
  /** `unknown` when no recent sample exists (no worker is sampling); `lagging` past INFRA_OUTBOX_LAG_WARN_SECONDS; `dead_letters` when events ran out of retries (lag wins). */
  status: 'ok' | 'lagging' | 'dead_letters' | 'unknown';
  /** Events due now and not yet picked up (capped at 10 000). */
  ready?: number;
  /** Seconds the oldest due event has been waiting. */
  lagSeconds?: number;
  /** Events that ran out of retries and wait for a replay. Any value above 0 needs a person. */
  dead?: number;
  /** How old the sample is, in seconds. */
  sampleAgeSeconds?: number;
}

/**
 * API side of the worker heartbeat (TW-INFRA-015): reads what the workers published. Two Redis reads, no database, and nothing
 * here can fail a readiness probe: a Redis error is the caller's `redis` check to report, not this one's.
 */
@Injectable()
export class WorkerStatusService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(INFRA_ENV) private readonly env: InfraEnv,
  ) {}

  async read(now: number = Date.now()): Promise<{ workers: WorkersCheck; outbox: OutboxCheck }> {
    const aliveMs = this.env.INFRA_WORKER_HEARTBEAT_SECONDS * ALIVE_FOR_BEATS * 1000;
    const [count, raw] = await Promise.all([
      this.redis.zcount(WORKERS_KEY, now - aliveMs, '+inf'),
      this.redis.get(OUTBOX_SAMPLE_KEY),
    ]);
    return {
      workers: { status: count > 0 ? 'up' : 'down', count },
      outbox: this.outboxCheck(raw, now, aliveMs),
    };
  }

  private outboxCheck(raw: string | null, now: number, aliveMs: number): OutboxCheck {
    const sample = parse(raw);
    if (!sample || now - sample.sampledAt > aliveMs) return { status: 'unknown' };
    return {
      status:
        sample.lagSeconds >= this.env.INFRA_OUTBOX_LAG_WARN_SECONDS
          ? 'lagging'
          : (sample.dead ?? 0) > 0
            ? 'dead_letters'
            : 'ok',
      ready: sample.ready,
      lagSeconds: sample.lagSeconds,
      ...(typeof sample.dead === 'number' ? { dead: sample.dead } : {}),
      sampleAgeSeconds: Math.max(0, Math.round((now - sample.sampledAt) / 1000)),
    };
  }
}

function parse(raw: string | null): OutboxSample | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OutboxSample>;
    return typeof v.ready === 'number' &&
      typeof v.lagSeconds === 'number' &&
      typeof v.sampledAt === 'number'
      ? (v as OutboxSample)
      : null;
  } catch {
    return null;
  }
}
