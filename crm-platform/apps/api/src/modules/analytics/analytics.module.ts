import { Module } from '@nestjs/common';
import { AnalyticsQueryService } from './query/analytics-query.service';

/**
 * Reads of the analytics rollups (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 4.5). Imported by the modules
 * whose screens read metrics; the Redis client comes from the global RedisModule.
 */
@Module({
  providers: [AnalyticsQueryService],
  exports: [AnalyticsQueryService],
})
export class AnalyticsModule {}
