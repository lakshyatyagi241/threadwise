import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Interval } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { TRIM_BATCH, parseMemoryInfo, pressureTier, trimPlan } from './queue-guard';

const TICK_MS = 60_000;

/**
 * Keeps Redis from filling up. Redis runs `noeviction` (evicting a BullMQ key loses a job), so once `maxmemory` is reached every
 * write fails: every queue stops, the API cannot enqueue and the health card goes Down. The usual cause is not live work but
 * finished-job history (failed jobs keep their payload for days, for every queue), and a retention rule only runs when a job of that
 * queue next finishes, so an idle queue keeps its history for ever. This trims that history, oldest first, as memory gets tight, and
 * never touches waiting, delayed or active jobs. Worker process only; a failed read or trim is retried on the next tick and never
 * throws.
 */
@Injectable()
export class QueueGuardService {
  private readonly logger = new Logger(QueueGuardService.name);
  private running = false;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { used, max } = parseMemoryInfo(await this.redis.info('memory'));
      const tier = pressureTier(used, max);
      if (tier === 0) return;
      let removed = 0;
      for (const step of trimPlan(tier)) {
        try {
          const queue = this.moduleRef.get<Queue>(getQueueToken(step.queue), { strict: false });
          removed += (await queue.clean(step.graceMs, TRIM_BATCH, step.type)).length;
        } catch (err) {
          this.logger.warn({ err, queue: step.queue }, 'queue trim failed; retried next tick');
        }
      }
      this.logger.warn(
        { tier, usedMb: Math.round(used / 1024 / 1024), maxMb: Math.round(max / 1024 / 1024), removed },
        'redis memory is high: trimmed finished-job history',
      );
    } catch (err) {
      this.logger.warn({ err }, 'redis memory check failed; retried next tick');
    } finally {
      this.running = false;
    }
  }
}
