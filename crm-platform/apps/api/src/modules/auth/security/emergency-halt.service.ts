import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { AuthKeys } from '../support/redis-keys';

const SETTING = 'platform.emergency_send_halt';

/**
 * Platform-wide kill switch for outbound messages (TW-AUTH-040).
 *
 * Durable in platform_settings, mirrored in Redis so the send path can check it
 * with one GET. `assertNotHalted` is the single call every outbound pipeline
 * (inbox reply, broadcast, scheduled, flow, auto-reply, and the BullMQ send
 * workers) must make before handing a message to a provider. Reference's halt only
 * covered two PHP dispatchers; bulk sends already queued in Node ignored it, so
 * the contract here is that workers re-check at send time, not at enqueue time.
 */
@Injectable()
export class EmergencyHaltService {
  private readonly logger = new Logger(EmergencyHaltService.name);

  constructor(
    private readonly settings: PlatformSettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isHalted(): Promise<boolean> {
    try {
      const cached = await this.redis.get(AuthKeys.halt);
      if (cached !== null) return cached === '1';
    } catch (err) {
      this.logger.warn({ err }, 'halt flag read from redis failed; using database value');
    }
    const stored = (await this.settings.get<boolean>(SETTING)) === true;
    await this.redis.set(AuthKeys.halt, stored ? '1' : '0').catch(() => undefined);
    return stored;
  }

  async set(halted: boolean, operatorId: number): Promise<void> {
    await this.settings.set(SETTING, halted, operatorId);
    await this.redis.set(AuthKeys.halt, halted ? '1' : '0').catch((err: unknown) => {
      this.logger.error({ err }, 'could not mirror halt flag to redis');
    });
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
