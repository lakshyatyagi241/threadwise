import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { OtpTemplateService } from '../platform/otp-template.service';
import { AuthKeys } from '../support/redis-keys';

/**
 * Every five minutes, asks Meta whether the sign-up OTP template is approved yet
 * (TW-AUTH-007: "approval later arrives by status sync"). Only a template still
 * pending is polled, so an idle platform makes no calls at all. Runs in the
 * worker process only (registered by WorkersModule).
 *
 * Several workers may be running; a short Redis lock keeps them from all asking
 * Meta in the same window.
 */
@Injectable()
export class OtpTemplateRefreshService {
  private readonly logger = new Logger(OtpTemplateRefreshService.name);

  constructor(
    private readonly templates: OtpTemplateService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    try {
      const got = await this.redis.set(AuthKeys.otpTemplateRefresh, '1', 'EX', 240, 'NX');
      if (got !== 'OK') return;
      const result = await this.templates.refreshPending();
      if (result !== 'skipped') this.logger.log({ result }, 'OTP template status poll finished');
    } catch (err) {
      this.logger.error({ err }, 'OTP template status poll crashed');
    }
  }
}
