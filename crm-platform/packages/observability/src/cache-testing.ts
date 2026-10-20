/** Test-only access to the cache counters (`@crm/observability/testing`). Not exported from the package index on purpose: production code must not swap the sink. */
export { setCacheSink, cacheSeriesCount, readCacheCounts, type CacheSink } from './cache-metrics';
