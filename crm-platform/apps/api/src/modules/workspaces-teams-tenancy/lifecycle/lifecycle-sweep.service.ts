import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../../../config/env.schema';
import { LifecycleService } from './lifecycle.service';

/**
 * Daily inactivity sweep (ADR-0028). Hourly would be harmless — every step is
 * idempotent and spaced by the policy — but reminders are day-granular, so
 * once a day at 03:15 (after partition maintenance at 02:00).
 * Concurrent replicas are safe: each org is processed under FOR UPDATE SKIP LOCKED and re-evaluated inside
 * the lock.
 *
 * Off by default (ORG_LIFECYCLE_ENABLED) and dry-run by default
 * (ORG_LIFECYCLE_DRY_RUN): turning the feature on first logs what it WOULD do.
 */
@Injectable()
export class LifecycleSweepService {
  private readonly logger = new Logger(LifecycleSweepService.name);

  constructor(
    private readonly lifecycle: LifecycleService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron('15 3 * * *')
  async run(): Promise<void> {
    if (!this.config.get('ORG_LIFECYCLE_ENABLED', { infer: true })) return;

    try {
      const summary = await this.lifecycle.sweep();
      this.logger.log(summary, 'workspace lifecycle sweep finished');
    } catch (err) {
      this.logger.error({ err }, 'workspace lifecycle sweep failed');
    }
  }
}
