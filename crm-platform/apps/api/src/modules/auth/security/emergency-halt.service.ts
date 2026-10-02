import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { AuthKeys } from '../support/redis-keys';

const SETTING = 'platform.emergency_send_halt';

/**
 * How long the Redis copy of the flag is trusted. Short on purpose: if a write
 * of the mirror ever fails (or someone flushes Redis), a stale "not halted"
 * can live at most this long before the next read goes back to the database.
 */
export const HALT_MIRROR_TTL_SECONDS = 30;
const MIRROR_WRITE_ATTEMPTS = 3;

/**
 * Platform-wide kill switch for outbound messages (WD-AUTH-040).
 *
 * Durable in platform_settings, mirrored in Redis so the send path can check it
 * with one GET. `assertNotHalted` is the single call every outbound pipeline
 * (inbox reply, broadcast, scheduled, flow, auto-reply, and the BullMQ send
 * workers) must make before handing a message to a provider. WaDesk's halt only
 * covered two PHP dispatchers; bulk sends already queued in Node ignored it, so
 * the contract here is that workers re-check at send time, not at enqueue time.
 *
 * The mirror expires (`HALT_MIRROR_TTL_SECONDS`) and is rewritten from the
 * database on the next read, and the instance that flipped the flag reads the
 * database itself until its mirror write has succeeded, so the switch never
 * trusts a copy that could be wrong for long.
 */
@Injectable()
export class EmergencyHaltService {
  private readonly logger = new Logger(EmergencyHaltService.name);
  /** True after a mirror write failed: this process bypasses Redis until one succeeds. */
  private mirrorSuspect = false;

  constructor(
    private readonly settings: PlatformSettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isHalted(): Promise<boolean> {
    if (!this.mirrorSuspect) {
      try {
        const cached = await this.redis.get(AuthKeys.halt);
        if (cached !== null) return cached === '1';
      } catch (err) {
        this.logger.warn({ err }, 'halt flag read from redis failed; using database value');
      }
    }
    const stored = (await this.settings.get<boolean>(SETTING)) === true;
    await this.writeMirror(stored);
    return stored;
  }

  async set(halted: boolean, operatorId: number): Promise<void> {
    await this.settings.set(SETTING, halted, operatorId);
    if (!(await this.writeMirror(halted))) {
      this.logger.error(
        'could not mirror the halt flag to redis; reading the database until it can',
      );
    }
  }

  /** Writes the Redis copy with an expiry; false (and "suspect") when every attempt failed. */
  private async writeMirror(halted: boolean): Promise<boolean> {
    for (let attempt = 1; attempt <= MIRROR_WRITE_ATTEMPTS; attempt++) {
      try {
        await this.redis.set(AuthKeys.halt, halted ? '1' : '0', 'EX', HALT_MIRROR_TTL_SECONDS);
        this.mirrorSuspect = false;
        return true;
      } catch (err) {
        if (attempt === MIRROR_WRITE_ATTEMPTS)
          this.logger.warn({ err }, 'halt mirror write failed');
      }
    }
    this.mirrorSuspect = true;
    return false;
  }

  /** Throws when sends are halted. Unlike the guardrails, the halt never fails open on a "no". */
  async assertNotHalted(): Promise<void> {
    if (await this.isHalted()) {
      throw new AppError(
        ERROR_CODES.AUTH_SEND_HALTED,
        'Outbound sends are paused by the platform. Try again once an operator resumes them.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
