# Runbook: Redis queue / cache split (Sheet 3 D-15)

**What changed:** the app can use two Redis instances. `REDIS_URL` stays the queue Redis (BullMQ, socket.io, the queue guard). `REDIS_CACHE_URL`,
when set, is where `REDIS_CLIENT` (every cache, rate-limit, idempotency, lock and state key) connects. Unset or empty, everything uses `REDIS_URL`
exactly as before, so nothing changes until the second instance is switched on.

**Why:** the queue Redis must be `noeviction` (evicting a BullMQ key loses a job). With one instance, a cache that grew filled it and every
write was refused, so workers stopped taking jobs. On the cache instance Redis evicts instead of refusing, so a full cache cannot stop the queues.

## Settings (deploy/hostinger/redis-cache.compose.yml)

| Setting            | Queue Redis (`redis`) | Cache Redis (`redis-cache`) | Why                                                                                                                 |
| ------------------ | --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `maxmemory-policy` | `noeviction`          | `volatile-lru`              | queue keys must never be evicted; cache keys all expire anyway, so evicting them is safe                            |
| `appendonly`       | `yes`                 | `no`, no snapshots          | queue jobs must survive a restart; cache keys are rebuilt. AOF `everysec` costs about 25 % of peak write throughput |
| `maxmemory`        | 448mb (unchanged)     | 128mb (`mem_limit` 192m)    | see Sizing                                                                                                          |

Every cache and state key has a TTL (`tools/redis-audit`, `docs/performance/redis/inventory.json`: 0 families to review), which is what makes
`volatile-lru` safe: a key with no TTL would never be evicted and would count against the limit. Rate-limit counters use INCR plus EXPIRE NX
or a Lua PEXPIRE; they are covered.

## Enabling (server)

```bash
cd /opt/desk   # the deploy directory
docker compose -f docker-compose.yml -f redis-cache.compose.yml --env-file .env up -d redis-cache
docker compose exec redis-cache redis-cli ping            # PONG
# then in .env:  REDIS_CACHE_URL=redis://redis-cache:6379   and release (api slots, api-hooks, worker)
```

Check after the release: `crm_redis_up{redis="cache"} 1` and `crm_redis_memory_used_bytes{redis="cache"}` in Prometheus; `redis="queue"` is the
old instance.

## Rollback

Empty `REDIS_CACHE_URL` in `.env` and release. The app is back on the single Redis; the cache instance can be stopped. Nothing is migrated in
either direction, because cache keys are rebuilt on the first request.

## What a restart of the cache instance loses

Rate-limit counters restart from zero, idempotency and replay keys are forgotten (a request or webhook replayed in the minutes after a restart is
processed again; handlers that matter are idempotent by their own insert), cached lookups are refilled from Postgres. No job is affected.

## Sizing

Read the real use first: `redis-cli -h redis-cache info memory` (`used_memory_human`, `evicted_keys`). If `evicted_keys` grows or
`RedisMemoryHigh` fires, raise `maxmemory` and `mem_limit` together (keep `mem_limit` about 1.5x `maxmemory`). Memory on the shared host is
`mem_limit` more than before.

## RedisMemoryHigh

**Meaning:** one Redis instance (label `redis`) has been above 70 % of `maxmemory` for 15 minutes. `RedisMemoryNearMax` (above 90 %, queue
instance only) is the page; this is the early warning.

**Queue instance:** nothing evicts, so at 100 % writes are refused. Find what grew: `redis-cli --bigkeys`, and `crm_queue_depth` for a backlog.
Finished-job history is trimmed by the queue guard when the queue Redis fills. A stuck consumer is the usual cause (see the queue runbooks).

**Cache instance:** it evicts, so this is a sizing signal, not an outage. Rising `evicted_keys` means hot keys are being dropped and the
source (Postgres) is taking the reads: check `CacheHitRatioLow`. Raise `maxmemory` (Sizing) or find a key family that is much larger than its use.
