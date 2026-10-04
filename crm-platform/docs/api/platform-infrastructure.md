# API: platform infrastructure

This domain has no routes of its own. It owns cross-cutting behaviour every route shares. Spec:
`docs/wadesk-port/inventory/platform-infrastructure.md`; plan: `docs/wadesk-port/port-map/platform-infrastructure.md`.

## Request throttle (WD-INFRA-010)

A global guard (`ThrottleGuard`) counts requests per caller in Redis and answers `429` with `application/problem+json`,
`code: RATE_LIMITED`, when a caller is over the limit. It runs right after authentication, so a refused request costs one
Redis call and no query.

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 42
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 42

{"type":"https://errors.crm.platform/rate_limited","title":"Too Many Requests","status":429,
 "detail":"Too many requests. Try again in 42 seconds.","code":"RATE_LIMITED","requestId":"..."}
```

Allowed requests carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds until the window rolls).
All four headers are exposed to browsers by CORS. No headers are sent when Redis is unreachable (see Failure).

### Using it in a controller

```ts
import { Throttle, SkipThrottle } from '../platform-infrastructure';

@Post('login')
@Throttle('auth')                                          // a named policy
login() {}

@Post('export')
@Throttle({ limit: 5, windowSeconds: 3600, by: 'actor' })  // or an explicit one
exportAll() {}
```

A decorator on the handler wins over one on the controller. `@SkipThrottle()` opts out of everything, including the
environment default; the health probes use it.

| Policy        | Limit / window | Counted against      | For                                                        |
| ------------- | -------------- | -------------------- | ---------------------------------------------------------- |
| `auth`        | 10 / 60 s      | address              | sign-in, reset, one-time codes                             |
| `public-form` | 20 / 60 s      | address              | unauthenticated forms that write                           |
| `webhook`     | 300 / 60 s     | address              | provider callbacks (many tenants share a provider address) |
| `ui-poll`     | 120 / 60 s     | caller, else address | screens that poll                                          |

`by: 'ip'` ignores who is signed in (holding a token must not dodge a login limit). `by: 'actor'` / `'actor-or-ip'` counts
the signed-in caller (pool, org, id) and falls back to the address on a public route. The address is `req.ip`, which follows
`TRUST_PROXY`: behind a proxy that variable must be set or every client shares the proxy's counter.

**Every counter is per route handler.** Two routes with the same policy do not share a count (WaDesk's unnamed throttles did).
The limit and window are part of the Redis key, so changing a number starts a fresh counter.

### Algorithm

Sliding-window counter: two adjacent fixed windows weighted by position, evaluated and incremented in one Lua script, so
concurrent requests cannot overshoot. A refused request is not counted. Across a window boundary a caller can exceed the limit
by at most about one request, not by 2x as with a plain fixed window.

### Configuration

| Variable                              | Default | Meaning                                                                                        |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `INFRA_RATE_LIMIT_ENABLED`            | `true`  | Master switch. `false`: no counting, no headers.                                               |
| `INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE` | `0`     | Limit for routes with no `@Throttle()`, per caller and route. `0` = such routes are unlimited. |

Merging the guard changes nothing by itself: the default is `0` and no route carries a decorator yet. Roll out by adding
decorators to webhook and polling routes first, then raise the default per environment. Setting a default before webhook
routes name `webhook` risks refusing provider callbacks that arrive from a shared address.

### Failure

If Redis is unreachable the request is let through (fail open) and no quota headers are sent; one warning is logged per
process every 30 seconds. A throttle that turned a cache outage into an API outage would be the worse failure.

### Existing limiters

Auth's `RateLimitService`, the storefront's `PublicRateLimiter` and the API-key guard keep their own counters and are
unchanged. Their owners can move to `@Throttle` in their own PRs; nothing here forces it.

## Redis locks and once-only gates (WD-INFRA-025)

`RedisLockService` (exported from `modules/platform-infrastructure`) is the one place for mutual exclusion and "do this once"
gates on Redis. WaDesk did this with `Cache::lock` / `Cache::add` on its database cache at about 200 call sites; this repo
already has several hand-written versions (device lease, sender lease, dispatcher lock, webhook dedupe) that disagree on
release safety and on what to do when Redis is down.

```ts
// run exclusive work; the lease is extended while it runs and always released
const out = await this.locks.withLock(
  `sched:sweep:${orgId}`,
  { ttlMs: 30_000, onUnavailable: 'skip' },
  async ({ signal }) => sweep(orgId, signal),
);
if (!out.acquired) return; // somebody else is sweeping

// a dedupe window / "at most every N" gate
if (!(await this.locks.once(`waba:in:${waMessageId}`, 3_600_000, 'proceed'))) return;
```

| Call                                   | Returns                                              | Use                                                                                                        |
| -------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `acquire(key, {ttlMs, onUnavailable})` | `Lease` or `null`                                    | you manage the lifetime (`lease.renew()` / `lease.release()`)                                              |
| `withLock(key, opts, fn)`              | `{acquired:false}` or `{acquired:true, value, lost}` | the normal case; `opts.wait` blocks until free, `fn` gets an `AbortSignal` that fires if the lease is lost |
| `once(key, ttlMs, onUnavailable)`      | `boolean`                                            | first caller in the window gets `true`; nothing to release                                                 |

- **Token-checked.** Release and renew are one Lua script that compares the stored token, so a holder whose lock expired can
  never free or extend the next holder's. (A plain `GET` then `DEL`, as one existing lease does, can.)
- **`onUnavailable` is required, with no default.** `skip` means "if Redis is down, act as if someone else holds it": use it for
  anything where two runs do harm. `proceed` means run unprotected: use it where refusing would lose something, such as
  dropping an inbound webhook because the dedupe store is down.
- **Heartbeat.** `withLock` renews every third of the TTL (set `renewEveryMs: 0` to turn it off), so the TTL only needs to cover a
  dead holder. If the lease is lost the signal aborts and the result has `lost: true`; if Redis is unreachable it counts as lost
  only after a full TTL of silence.
- **Not a fencing token.** A holder paused longer than the TTL can wake up believing it still holds the lock. Money and stock
  also need a database constraint or row lock. This keeps duplicate work rare; it does not make it impossible.
- **Keys** are yours: `<code>:<purpose>:<ids>`. Do not reuse a key that holds a counter or cached value.

Existing hand-rolled versions are unchanged. Their owners can move over in their own PRs; for fixed-window counters (the
segment, lead, public-link, appointment and marketplace throttles) use `RateLimiter` or `@Throttle` instead.
