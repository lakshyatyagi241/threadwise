import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { AuthKeys } from '../support/redis-keys';

const SETTING_KEY = 'auth.epoch';
const LOCAL_CACHE_MS = 5_000;
/**
 * The Redis copy expires and is rewritten from Postgres on the next read, so a bump whose mirror write was lost (Redis unreachable
 * at that moment) is corrected on every process within this long (plus the 5 s in-process copy). Without an expiry the old number
 * stayed for ever and "revoke all sessions" never reached the other processes.
 */
export const EPOCH_MIRROR_TTL_SECONDS = 30;

/**
 * The platform-wide token epoch (TW-AUTH-039 "revoke all sessions").
 *
 * Every access token carries `ep`. Bumping the epoch makes every token issued
 * before the bump invalid in one write, with no per-session work. The value is
 * durable in platform_settings and mirrored in Redis for the hot path; a
 * flushed or expired mirror is repopulated from the database rather than
 * resetting to 0 (which would silently re-validate revoked tokens).
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
    if (this.cached && now - this.cached.at < LOCAL_CACHE_MS) return this.cached.value;

    let value: number | null = null;
    try {
      const raw = await this.redis.get(AuthKeys.epoch);
      if (raw !== null) value = Number(raw);
    } catch (err) {
      this.logger.warn({ err }, 'epoch read from redis failed; using database value');
    }

    if (value === null || Number.isNaN(value)) {
      // A fresh read, not the 5 s snapshot: the number written back to Redis below must not be older than the bump that emptied it.
      this.settings.invalidate();
      value = (await this.settings.get<number>(SETTING_KEY)) ?? 0;
      await this.redis
        .set(AuthKeys.epoch, String(value), 'EX', EPOCH_MIRROR_TTL_SECONDS, 'NX')
        .catch(() => undefined);
    }

    this.cached = { value, at: now };
    return value;
  }

  /** Invalidates every token issued before this call. Returns the new epoch. */
  async bump(updatedBy: number): Promise<number> {
    // Incremented inside Postgres, not read-then-written through the 5 s settings snapshot: a process holding an old snapshot would
    // otherwise write the same number as the bump before it, and its "revoke all" would revoke nothing.
    const next = await this.settings.inTx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${SETTING_KEY}, '1'::jsonb, false, ${updatedBy}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = to_jsonb((platform_settings.value #>> '{}')::bigint + 1),
              is_secret = false, updated_by = EXCLUDED.updated_by, updated_at = now()
        RETURNING (value #>> '{}')::bigint AS epoch
      `);
      return Number((res.rows[0] as { epoch: string | number }).epoch);
    });
    await this.redis
      .set(AuthKeys.epoch, String(next), 'EX', EPOCH_MIRROR_TTL_SECONDS)
      .catch((err: unknown) => {
        this.logger.error(
          { err },
          `could not mirror new epoch to redis; other processes catch up within ${EPOCH_MIRROR_TTL_SECONDS} s`,
        );
      });
    this.cached = { value: next, at: Date.now() };
    return next;
  }
}
