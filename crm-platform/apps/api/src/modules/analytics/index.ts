/** Public surface of the analytics module. Other modules import from here, never from the files behind it. */
export { AnalyticsModule } from './analytics.module';
export { AnalyticsWorkerModule } from './analytics-worker.module';
export {
  AnalyticsQueryService,
  type SeriesDim,
  type SeriesQuery,
  type SeriesRow,
} from './query/analytics-query.service';
export { RollupService, type RollupPass } from './rollup/rollup.service';
