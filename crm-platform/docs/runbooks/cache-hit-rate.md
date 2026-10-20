# Runbook: cache hit rate and cache failures

**Where the numbers come from:** every cache in `docs/performance/cache/register.json` that has a lookup (52 of 69) counts
`crm_cache_hits_total`, `crm_cache_misses_total` and `crm_cache_errors_total` with one label, `cache` (the metric name in the register).
`crm_cache_entries{cache}` shows the size of a bounded in-process cache where one is wired. The series are on the same `/metrics`
listener as the event-loop and queue series (API and worker). A backend failure is counted as an error and also as a miss, because
the request went to the source. So: hit ratio = hits / (hits + misses); error ratio = errors / (hits + misses).

Rules: `deploy/observability/cache-hit-rate.rules.yml` (tested by `cache-hit-rate.rules.test.yml` with promtool). Recorded series:
`crm:cache_hit_ratio:5m`, `crm:cache_hit_ratio:1h`, `crm:cache_error_ratio:5m`, `crm:cache_lookups:rate5m`. Thresholds are initial
engineering targets, not measured production values.

## CacheHitRatioLow (warning)

**Meaning:** a P0 cache (access, session, plan or money data) answered under half of its lookups over the last hour while it was seeing
more than 0.2 lookups a second. Most requests are paying for the source (Postgres, Redis, a provider) that the cache exists to avoid.
**First look:** was there a deploy or restart in the last hour? A fresh process has an empty cache; if the ratio recovers by itself, do
nothing. **Then:** compare `crm_cache_errors_total{cache}`: errors in the same window mean the backend is failing (see the next alert).
No errors and a stuck low ratio means the key changes on every call (a version or id in the key that moves), the TTL is shorter than the
gap between requests, or invalidation runs too often (look for a loop calling the cache's invalidate). The register entry for the cache
(`invalidation`, `ttl`) names the code to read. **Do not** raise a TTL on access data (`rbac_*`, `account_gate`, `org_suspension`) to
fix the ratio: those windows are security decisions.

## CacheErrorRatioHigh (warning)

**Meaning:** more than 5 % of a cache's lookups failed inside the backend (for the Redis caches, Redis returned an error or timed out)
for 10 minutes. Most caches fall back to the source, so requests still succeed but each is slower and Postgres carries the load. A cache whose register `backingStoreFailure.mode` is `closed` refuses instead.
**First look:** Redis health (`crm_redis_up`, `crm_redis_memory_used_bytes`, `crm_redis_connected_clients`; see
`docs/performance/redis/`). One cache only means a bad value or a script error in that cache (read its warn log line); every Redis cache at
once means Redis itself. **Then:** watch Postgres connection use while this lasts; the register's `backingStoreFailure` field says what
each cache does when its backend is down (`to-source`, `ignored`, `open`, `closed`). The idempotency cache does not fall back: a Redis error
there reaches the caller as a failed request, so its error counter is the first sign.

## CacheMetricsMissing (warning)

**Meaning:** no `crm_cache_hits_total` series from `job="crm-api"` for 15 minutes. The two hit-ratio alerts above cannot fire without the
series, so this one watches them. **First look:** is the API up and scraped (`RuntimeMetricsTargetDown`)? If so, someone removed the
instrumentation or the metrics listener changed; `pnpm --filter @crm/api exec vitest run test/unit/cache-audit/instrumentation.spec.ts`
fails when a registered cache loses its counter call.

## Adding a cache

1. Add it to `register.json` (the #64 ratchets force this).
2. Add `const cache = cacheMetrics('your_name')` (a string literal; a computed name is rejected by the ratchet) and call `.hit()`,
   `.miss()` and `.error()` at the lookup. Never put a workspace, user or key in the name.
3. Fill `instrumentation` in the register: the metric name, and `hitRatioAlert: true` for a P0 cache whose hits should be common, or an
   exemption with a written reason. Add the name to the `CacheHitRatioLow` selector when `hitRatioAlert` is true. The spec checks both.
