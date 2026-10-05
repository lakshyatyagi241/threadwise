import { Module } from '@nestjs/common';
import { INFRA_ENV, readInfraEnv } from '../../config/domains/platform-infrastructure.env';
import { RedisLockService } from './coordination/redis-lock.service';
import { WorkerStatusService } from './observability/worker-status.service';
import { RateLimiter } from './rate-limit/rate-limiter';
import { ThrottleGuard } from './rate-limit/throttle.guard';

/**
 * Cross-cutting infrastructure that has no screen of its own (INFRA).
 *
 * The request throttle lives here but is registered as a global guard by AppModule, right after JwtAuthGuard: global guard
 * order is the order of registration, and the throttle needs the caller identified first. Registering it here instead would
 * leave its place relative to the other guards to module scan order.
 *
 * Redis comes from the global RedisModule. The environment is parsed once at construction, so a malformed
 * INFRA_RATE_LIMIT_* value stops the process at boot.
 */
@Module({
  providers: [
    { provide: INFRA_ENV, useFactory: () => readInfraEnv(process.env) },
    RateLimiter,
    ThrottleGuard,
    RedisLockService,
    WorkerStatusService,
  ],
  exports: [RateLimiter, ThrottleGuard, RedisLockService, WorkerStatusService],
})
export class PlatformInfrastructureModule {}
