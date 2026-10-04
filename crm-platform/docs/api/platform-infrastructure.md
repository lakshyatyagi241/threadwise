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
