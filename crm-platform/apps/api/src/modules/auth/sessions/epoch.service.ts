import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { AuthKeys } from '../support/redis-keys';
import { cacheMetrics } from '@crm/observability';

const local = cacheMetrics('epoch_local');
const shared = cacheMetrics('epoch_redis');

const SETTING_KEY = 'auth.epoch';
const LOCAL_CACHE_MS = 5_000;

/**
 * The platform-wide token epoch (TW-AUTH-039 "revoke all sessions").
 *
 * Every access token carries `ep`. Bumping the epoch makes every token issued
 * before the bump invalid in one write, with no per-session work. The value is
 * durable in platform_settings and mirrored in Redis for the hot path; a
 * flushed Redis is repopulated from the database rather than resetting to 0
 * (which would silently re-validate revoked tokens).
 */
@Injectable()
export class EpochService {
  private readonly logger = new Logger(EpochService.name);
  private cached: { value: number; at: number } | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly settings: PlatformSettingsService,
  ) {}

  async current(): Promise<number> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < LOCAL_CACHE_MS) {
      local.hit();
      return this.cached.value;
    }
    local.miss();

    let value: number | null = null;
    try {
      const raw = await this.redis.get(AuthKeys.epoch);
      if (raw !== null) {
        value = Number(raw);
        shared.hit();
      } else shared.miss();
    } catch (err) {
      shared.error();
      shared.miss();
      this.logger.warn({ err }, 'epoch read from redis failed; using database value');
    }

    if (value === null || Number.isNaN(value)) {
      value = (await this.settings.get<number>(SETTING_KEY)) ?? 0;
      await this.redis.set(AuthKeys.epoch, String(value), 'NX').catch(() => undefined);
    }

    this.cached = { value, at: now };
    return value;
  }

  /** Invalidates every token issued before this call. Returns the new epoch. */
  async bump(updatedBy: number): Promise<number> {
    const next = (await this.settings.get<number>(SETTING_KEY).then((v) => v ?? 0)) + 1;
    await this.settings.set(SETTING_KEY, next, updatedBy);
    await this.redis.set(AuthKeys.epoch, String(next)).catch((err: unknown) => {
      this.logger.error({ err }, 'could not mirror new epoch to redis');
    });
    this.cached = { value: next, at: Date.now() };
    return next;
  }
}
