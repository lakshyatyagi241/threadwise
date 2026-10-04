/**
 * Public surface of the platform-infrastructure domain. Other modules import from here, never from the files behind it
 * (architecture rule: no cross-module internals).
 */
export { PlatformInfrastructureModule } from './platform-infrastructure.module';
export { Throttle, SkipThrottle } from './rate-limit/throttle.decorators';
export { ThrottleGuard } from './rate-limit/throttle.guard';
export { RateLimiter, type ConsumeResult } from './rate-limit/rate-limiter';
export {
  RATE_POLICIES,
  type PolicyName,
  type ThrottleInput,
  type ThrottleSpec,
  type ThrottleSubject,
} from './rate-limit/rate-limit.policies';
export {
  RedisLockService,
  type AcquireOptions,
  type Lease,
  type LockedContext,
  type LockResult,
  type OnUnavailable,
  type WaitOptions,
  type WithLockOptions,
} from './coordination/redis-lock.service';
export {
  bodyLimitClasses,
  bodyLimitFor,
  defaultBodyLimitBytes,
  installBodyLimits,
  type BodyLimitClass,
} from './body-limits/body-limits';
export { corsIsClosedInProduction, corsOriginFor, type CorsOrigin } from './cors/cors-policy';
export {
  isDone,
  listColumns,
  rotateKeys,
  type ColumnReport,
  type RotationOptions,
} from './crypto-rotation/rotate-keys';
export { looksSealed, mapSealed, collectSealed } from './crypto-rotation/envelope';
export { WorkerHeartbeatModule } from './observability/worker-heartbeat.module';
export {
  WorkerStatusService,
  type OutboxCheck,
  type WorkersCheck,
} from './observability/worker-status.service';
export {
  initSentry,
  reportServerError,
  flushSentry,
  scrubSentryEvent,
  scrubSentryTransaction,
} from './observability/sentry';
export { createFatalHandler, installProcessHandlers } from './observability/process-handlers';
export { LOG_REDACT_PATHS, SECRET_HEADERS, redactHeaders } from './observability/log-redaction';
