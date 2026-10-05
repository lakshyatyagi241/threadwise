# API: platform infrastructure

This domain has no routes of its own. It owns cross-cutting behaviour every route shares. Spec:
`docs/threadwise-port/inventory/platform-infrastructure.md`; plan: `docs/threadwise-port/port-map/platform-infrastructure.md`.

## Request throttle (TW-INFRA-010)

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

**Every counter is per route handler.** Two routes with the same policy do not share a count (Reference's unnamed throttles did).
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

## Redis locks and once-only gates (TW-INFRA-025)

`RedisLockService` (exported from `modules/platform-infrastructure`) is the one place for mutual exclusion and "do this once"
gates on Redis. Reference did this with `Cache::lock` / `Cache::add` on its database cache at about 200 call sites; this repo
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

## Request body limits (TW-INFRA-020)

JSON and form bodies are buffered in memory before authentication or routing, so the cap is set where the body is read, in
`installBodyLimits(app)` from `main.ts`. Over the cap the answer is `413`, problem+json, `code: PAYLOAD_TOO_LARGE`, and the rest
of the body is not read. A route cannot raise its own cap: pick a class.

| Class              | Paths (a `/v<n>` prefix is ignored)                                                                                                                                                                                      | Limit                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `whatsapp-webhook` | `public/webhooks/whatsapp`                                                                                                                                                                                               | 4 MiB (`INFRA_BODY_LIMIT_WHATSAPP_WEBHOOK_KB`) |
| `lead-hook`        | `public/lead-hooks`                                                                                                                                                                                                      | `LEAD_HOOK_MAX_BODY_BYTES` (1 MiB)             |
| `marketplace-hook` | `public/marketplace`                                                                                                                                                                                                     | `MARKET_HOOK_MAX_BYTES` (256 KiB)              |
| `webhook`          | `public/webhooks/*`, `webhooks/channels`, `store-public/webhooks`, `facebook`, `instaflow`, `telegram/inbound`, `shopify/webhook`, `shopify/compliance`, `woocommerce/webhook`, `campaigns/node`, `google/form-response` | 1 MiB (`INFRA_BODY_LIMIT_WEBHOOK_KB`)          |
| everything else    |                                                                                                                                                                                                                          | 100 KiB (`INFRA_BODY_LIMIT_KB`)                |

- **Nothing changes for existing routes except the callbacks above.** 100 KiB is what Express enforced before; it is now stated and
  configurable. Before this, the 1 MiB and 256 KiB caps that the lead-hook and marketplace domains declare could never be
  reached for JSON, and a large WhatsApp delivery (Meta documents deliveries of several MiB; sized here with headroom, check
  against current Meta docs) would have been refused with 413 before its signature was even checked.
- The raw bytes are kept on every class (`req.rawBody`) for HMAC checks.
- Multipart uploads are not governed here; each upload route sets its own multer `fileSize`.
- New callback or a different cap: add a class to `bodyLimitClasses` in `modules/platform-infrastructure/body-limits/`. Keep the
  limit as small as the largest honest sender needs: these routes accept bytes from anyone until the signature is checked.

| Variable                               | Default | Meaning                             |
| -------------------------------------- | ------- | ----------------------------------- |
| `INFRA_BODY_LIMIT_KB`                  | `100`   | default JSON/form limit, 1 to 10240 |
| `INFRA_BODY_LIMIT_WEBHOOK_KB`          | `1024`  | `webhook` class                     |
| `INFRA_BODY_LIMIT_WHATSAPP_WEBHOOK_KB` | `4096`  | `whatsapp-webhook` class            |

## CORS (TW-INFRA-014)

The API sends credentials-enabled CORS headers for the origins in `CORS_ORIGINS` (comma list). With **no list**:

- development and test: any origin is allowed, so a local web app on any port works unconfigured;
- **production: no origin is allowed.** No CORS headers are sent, so browsers on other origins are refused; same-origin and
  server-to-server calls are unaffected, and a warning is logged at boot. Before, an unset variable in production reflected every
  origin together with credentials.

The production deploy already sets `CORS_ORIGINS` (`deploy/hostinger/docker-compose.yml`), so it is unaffected. The socket.io
gateway has its own `cors: { origin: true, credentials: true }` in `realtime/realtime.gateway.ts` and is not covered here (see the PR).

## Encryption key rotation (TW-INFRA-023)

`CryptoService` already supports a key ring (`CREDENTIALS_ENCRYPTION_KEY` seals, `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS` only
reads, every blob names its key). What was missing was a way to move **all** stored secrets to a new key. The AUTH domain's
re-encrypt command knew only its own two or three tables, while about thirty other places store sealed values (channel and
gateway credentials, OAuth tokens, sales-document and appointment data, lead and Telegram secrets, ...). Rotating by that
command and then dropping the old key would have made all of those unreadable.

`rotate-keys.cli.js` finds sealed blobs by scanning every text and jsonb column of every ordinary table (a partitioned table is
read through its parent), so nothing has to be registered and a new domain is covered the day it ships. It reports blobs by the
key that sealed them, moves them one row at a time with a compare-and-swap, skips and reports a row that changed while it ran,
and reports (never changes) a blob that no key in the ring can open. Procedure, the backup caveat (old dumps still need the old
key) and limits: [docs/runbooks/key-rotation.md](../runbooks/key-rotation.md).

```bash
node dist/src/modules/platform-infrastructure/crypto-rotation/rotate-keys.cli.js [--dry-run] [--only=t1,t2] [--exclude=t3]
```

Exit 0: a real run moved everything it found, or a dry run found nothing to move. Exit 2: something is unreadable or changed
under it (a dry run also exits 2 when it would move something). The deploy compose now passes
`CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS` to the API and the worker; before, a rotation was impossible there.

## Observability (TW-INFRA-015, 018, 028)

### Readiness: `GET /ready`

Unchanged contract: **200 only when the primary database and Redis answer, 503 otherwise.** The deploy gate and the container
healthcheck read only the status code. Two informational checks are added to the body; they never change the status, because
an API with no workers (a deploy in progress, a crashed worker) still serves requests and pulling it from rotation would turn
a background problem into an outage.

```json
{
  "status": "ok",
  "checks": {
    "primary": { "status": "up", "latencyMs": 3 },
    "replica": { "status": "up", "latencyMs": 2 },
    "redis": { "status": "up", "latencyMs": 1 },
    "workers": { "status": "up", "count": 1 },
    "outbox": { "status": "ok", "ready": 0, "lagSeconds": 0, "sampleAgeSeconds": 4 }
  }
}
```

| Check            | Values                       | Meaning                                                                                                                                  |
| ---------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `workers.status` | `up` / `down` / `unknown`    | `down`: no worker beat in the last three intervals. `unknown`: Redis could not be read.                                                  |
| `outbox.status`  | `ok` / `lagging` / `unknown` | `lagging`: the oldest due event has waited at least `INFRA_OUTBOX_LAG_WARN_SECONDS`. `unknown`: no fresh sample (no worker is sampling). |
| `outbox.ready`   | number, capped at 10 000     | events due now and not yet picked up                                                                                                     |

How it works: each worker process beats every `INFRA_WORKER_HEARTBEAT_SECONDS` (10) into a Redis sorted set and, in the same
beat, samples the outbox (two reads on the partial index `idx_outbox_pending`, cheap even under a large backlog). The API only
reads Redis. It does not query `event_outbox` itself, because that table spans tenants and privileged mode must not be reachable
from a request handler. Alert on `workers.status != up` and `outbox.status == lagging` for more than a few minutes.

### Worker container healthcheck

The worker serves no HTTP, so the image's `HEALTHCHECK` (it probes the API port) does not apply and the live compose file turns
it off. This script answers "has the worker in this container beaten recently?" and loads only a Redis connection:

```yaml
worker:
  healthcheck:
    test: ['CMD', 'node', 'dist/src/modules/platform-infrastructure/observability/worker-probe.js']
    interval: 30s
    timeout: 5s
    start_period: 40s
```

Not switched on in `deploy/hostinger/docker-compose.yml` by this change (a bad healthcheck there restarts a production worker
in a loop): enable it deliberately, with the K-5 compose work. A clean shutdown removes the worker from the set at once.

### Error reporting (Sentry)

**On in production** for the API, the worker and the web app, all reporting to one Sentry project (tagged `service: api | worker | web`).
The DSN is public by design (it only lets events in), so it is the default in `deploy/hostinger/docker-compose.yml`; set
`SENTRY_DSN=` (empty) in `/opt/desk/.env` to turn it off. The web app's browser bundle has the DSN baked in at image build time by
the deploy workflow. Each image carries the commit it was built from as the Sentry release. Details of the web setup are
under "Web app" below.

Set `SENTRY_DSN` in the **process environment** (compose or orchestrator; a `.env` file is read too late) to turn it on; unset
means nothing is initialised. Every 5xx from the exception filter is reported, with the release (`GIT_SHA`), `service`
(`api`/`worker`), the request id and the masked path as tags; 4xx are not. Tracing is off unless `SENTRY_TRACES_SAMPLE_RATE` is
set (it is read from the environment directly; the default of 0.1 in `env.schema.ts` is not used).

What never leaves the process, verified by an end-to-end test against a real Sentry client: request headers that carry a
credential or signature, cookies, the request body, query strings, and secrets in the address path (Telegram bot token, Shopify
and WooCommerce webhook secrets, lead-hook token, marketplace hook secret). Two leaks were found and fixed while writing that
test: Sentry sends a performance transaction per request even with tracing unset unless the rate is set to 0, and it names the
failing request after the route, secret included.

### Process crashes

`uncaughtException` and `unhandledRejection` in the API and the worker write one structured line to stderr (level 60, with the
stack), report to Sentry, wait up to 2 s for it to send, and exit 1 so the orchestrator restarts a clean process.

### Logging

- **Redaction.** The HTTP logger's redact list is generated from `SECRET_HEADERS` (`observability/log-redaction.ts`): every
  credential, shared-secret and signature header the API reads. A unit test scans the source for headers whose names say
  secret, token, signature, hmac, api-key, authorization or cookie and fails if one is missing, so a new webhook header cannot
  slip through.
- **Secrets in paths** are masked by `maskSecretUrl` for log lines and error reports; it now also covers the Telegram bot token,
  Shopify and WooCommerce webhook secrets, and the lead-hook token, not only the marketplace hook.
- **Worker logs.** The worker started Nest with `bufferLogs: true` and never flushed, and `createApplicationContext` does not
  flush on its own, so every `Logger` call in the worker (outbox failures, dead-lettered events, processor warnings) was neither
  printed nor released. `worker.ts` now calls `app.flushLogs()`. Measured on a real boot: 0 lines before, 98 after.

| Variable                         | Default | Meaning                                                         |
| -------------------------------- | ------- | --------------------------------------------------------------- |
| `INFRA_WORKER_HEARTBEAT_SECONDS` | `10`    | beat and outbox sample interval, 2 to 60; alive for three beats |
| `INFRA_OUTBOX_LAG_WARN_SECONDS`  | `60`    | `outbox.status` becomes `lagging` from this wait, 1 to 86 400   |
| `SENTRY_DSN`                     | unset   | enables error reporting                                         |
| `SENTRY_TRACES_SAMPLE_RATE`      | unset   | tracing rate 0 to 1; unset or 0 means none                      |

### Web app (`apps/web`, `@sentry/nextjs`)

Browser, Node and edge runtimes are initialised (`src/instrumentation-client.ts`, `src/sentry.server.config.ts`,
`src/sentry.edge.config.ts`, registered by `src/instrumentation.ts`); server-component, route-handler and proxy errors go through
`onRequestError`; `src/app/global-error.tsx` reports React rendering errors that no nearer boundary caught. Shared settings are in
`src/lib/sentry/options.ts`.

- **Errors only.** Tracing is off unless `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` is set at build time, and **Session Replay is not
  used**: this app shows customers' conversations and contact details, which a recording would capture. `sendDefaultPii` is off.
- **Scrubbing** (`src/lib/sentry/scrub.ts`, tested): several pages are reached by an address that is the credential
  (`/q/<token>`, `/i/<token>`, `/b/manage/<token>`, `/reset-password/<token>`). Before anything is sent the secret segment becomes
  `[secret]`, query strings, request bodies and cookies are dropped, credential headers are redacted, and the address in
  `x-crm-path`, `referer` and Next's `request_path` is scrubbed too. Checked end to end against a local listener with secrets in the
  query string, the `Authorization` and `Cookie` headers and the `Referer`: none arrived.
- **Source maps** (readable production stack traces) upload only when the build has `SENTRY_AUTH_TOKEN`. Until a token exists,
  production stack traces are minified. To switch it on: in Sentry create an organisation auth token, then in the GitHub repository
  add the **secret** `SENTRY_AUTH_TOKEN` and the **variables** `SENTRY_ORG` and `SENTRY_PROJECT` (the slugs); the next deploy
  uploads. The token reaches the Docker build as a BuildKit secret, never as an argument or a layer.
- **Not set up:** a tunnel route (it would send browser events through our server to get past ad blockers, at the cost of server
  load and a proxy exception), release/commit association and uptime monitors.
