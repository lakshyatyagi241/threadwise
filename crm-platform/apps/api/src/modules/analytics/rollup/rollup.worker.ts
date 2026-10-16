import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, Interval } from '@nestjs/schedule';
import type { Env } from '../../../config/env.schema';
import { RollupService } from './rollup.service';

/** How long the hour rollups are kept; the day rollups are kept forever. */
export const HOUR_ROLLUP_RETENTION_DAYS = 120;
/** A watermark older than this means the worker is stalled or the database is behind. */
const STALE_AFTER_SECONDS = 300;

/** Drives the rollup: a pass every 30 seconds, a reconcile of yesterday and a trim of old hour rows every night. Worker process only. */
@Injectable()
export class RollupWorker {
  private readonly logger = new Logger(RollupWorker.name);
  private running = false;

  constructor(
    private readonly rollup: RollupService,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  @Interval(30_000)
  async pass(): Promise<void> {
    // The interval keeps firing whether or not the last pass finished; without this guard a slow pass would overlap itself.
    if (this.running || this.config?.get('ANALYTICS_ROLLUP_ENABLED', { infer: true }) === false) {
      return;
    }
    this.running = true;
    try {
      const pass = await this.rollup.runOnce();
      const age = await this.rollup.watermarkAgeSeconds();
      if (age > STALE_AFTER_SECONDS) {
        this.logger.warn({ ageSeconds: Math.round(age) }, 'analytics rollup watermark is stale');
      }
      if (pass && pass.slices > 1)
        this.logger.log({ slices: pass.slices }, 'analytics rollup caught up');
    } catch (err) {
      this.logger.error({ err }, 'analytics rollup pass failed');
    } finally {
      this.running = false;
    }
  }

  @Cron('15 2 * * *')
  async nightly(): Promise<void> {
    try {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const { fixedRows } = await this.rollup.reconcile(yesterday);
      if (fixedRows > 0) {
        this.logger.warn({ day: yesterday, fixedRows }, 'analytics rollup drift repaired');
      }
      const trimmed = await this.rollup.trimHourRows(HOUR_ROLLUP_RETENTION_DAYS);
      if (trimmed > 0) this.logger.log({ trimmed }, 'analytics hour rollups trimmed');
    } catch (err) {
      this.logger.error({ err }, 'analytics nightly job failed');
    }
  }
}
