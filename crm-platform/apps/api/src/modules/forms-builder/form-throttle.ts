import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES, type FormRateLimits } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

/**
 * The throttle of the public form routes (docs/specs/forms-builder-app.md 9.1 and 14). Four budgets, all fixed windows on Redis:
 *
 *  - per address, across every form, checked BEFORE the form is looked up (a scan with random keys costs a Redis hit, not a query);
 *  - per address per form, per minute (the form's `perIpPerMinute`);
 *  - per form per minute, from anywhere (`perFormPerMinute`): one form cannot be used to flood a workspace;
 *  - per contact point per hour (`perContactPerHour`): the same email or phone cannot be submitted over and over.
 *
 * Fail-open on a Redis error, as the lead hook and the booking pages do: refusing every visitor because a cache is down is the worse
 * outcome, and the CAPTCHA and the honeypot still run. The error is logged.
 */
export const FORM_PUBLIC_IP_LIMIT = 120;
export const FORM_DEFAULT_LIMITS: FormRateLimits = {
  perIpPerMinute: 20,
  perFormPerMinute: 120,
  perContactPerHour: 5,
};

const MINUTE = 60;
const HOUR = 3600;

@Injectable()
export class FormThrottle {
  private readonly logger = new Logger(FormThrottle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** The address budget; call it first on every public route. */
  async checkIp(ip: string | undefined): Promise<void> {
    const hit = await this.hit(`form:pub:ip:${ip ?? 'unknown'}`, MINUTE);
    if (hit.count > FORM_PUBLIC_IP_LIMIT) this.refuse(hit.retryAfter);
  }

  /** The address and form budgets of one submission, spent before the answers are looked at (a flood of invalid posts counts too). */
  async checkSubmit(formId: number, ip: string | undefined, limits: FormRateLimits): Promise<void> {
    const [byIp, byForm] = await Promise.all([
      this.hit(`form:sub:ip:${formId}:${ip ?? 'unknown'}`, MINUTE),
      this.hit(`form:sub:form:${formId}`, MINUTE),
    ]);
    if (byIp.count > limits.perIpPerMinute) this.refuse(byIp.retryAfter);
    if (byForm.count > limits.perFormPerMinute) this.refuse(byForm.retryAfter);
  }

  /** The contact budget: the same email address or phone number, per hour. `contactKey` is hashed before it is a cache key. */
  async checkContact(
    formId: number,
    contactKey: string | null,
    limits: FormRateLimits,
  ): Promise<void> {
    if (!contactKey) return;
    const id = createHash('sha256').update(contactKey).digest('hex').slice(0, 24);
    const hit = await this.hit(`form:sub:contact:${formId}:${id}`, HOUR);
    if (hit.count > limits.perContactPerHour) this.refuse(hit.retryAfter);
  }

  private refuse(retryAfter: number): never {
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many requests. Try again in a moment.',
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(retryAfter) }],
    );
  }

  private async hit(key: string, window: number): Promise<{ count: number; retryAfter: number }> {
    try {
      const res = await this.redis.multi().incr(key).expire(key, window, 'NX').ttl(key).exec();
      const ttl = Number(res?.[2]?.[1] ?? window);
      return { count: Number(res?.[0]?.[1] ?? 1), retryAfter: ttl > 0 ? ttl : window };
    } catch (err) {
      this.logger.warn({ err }, 'form throttle failed open');
      return { count: 1, retryAfter: window };
    }
  }
}
