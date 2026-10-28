# Threadwise API performance report

Measured live on 2026-10-28 against this repo's `apps/api` (NestJS, Postgres 16 + RLS, Redis 7, BullMQ), booted from a scratch copy of the repo. Nothing in the repo was changed or committed.

Companion files: the [`csv/`](csv/README.md) folder lists everything: [`01-all-operations.csv`](csv/01-all-operations.csv) has every operation with its full details and measured timings, [`02-every-request.csv`](csv/02-every-request.csv) has every one of the 32,777 requests sent, plus queue, Redis, outbox and Postgres tables.

## 1. Read this first: what these numbers are and are not

- **Environment:** 4-vCPU / 15 GB sandbox VM. API, worker, Postgres, Redis **and the load generator all share the same machine**. Compiled build (`nest build -b swc`), `NODE_ENV=development`, `LOG_LEVEL=debug`. There was no network hop, so these are **server-processing times, not what a user on the internet sees**. Absolute values will differ in production; compare *relative* cost between endpoints.
- **Tiny dataset:** 2 orgs, about 520 contacts. Latency on large tenants (100k+ contacts) is **not** measured here.
- **Sequential latency** (one request at a time, no contention) for the sweep; concurrency is measured separately in section 6.
- **No external providers:** WhatsApp/Meta, Telegram, payment gateways, Google/Microsoft calendars, etc. are not reachable, so their latency is not included.
- **Coverage honesty.** Of 2,045 operations, only **399 returned a real 2xx** with the generic harness. The rest are measured on their *reject path* (auth + routing + validation), which is much cheaper than real work and should not be read as the endpoint's real latency:

| Outcome of the sweep | Operations | Meaning |
|---|---|---|
| success (2xx) | 399 | real work measured |
| rejected, 400/409/422 | 578 | generated body failed validation, so this measures routing and validation only |
| not found (404) | 512 | placeholder id; no list data to harvest an id from |
| unauthorized (401) | 429 | needs a different actor: **409 are `/v2/platform/*` (platform-operator token), 15 are `/api/v1/*` (API key)**, plus partner/HMAC routes |
| rate limited (429) | 57 | `/api/v1/*` public-API throttle (120/min) |
| forbidden (403) | 38 | `calling` (23) and `growth` (15): plan or permission gate on the seeded org |
| fetch error | 9 | OAuth/payment redirect callbacks that redirect to external hosts |
| skipped | 23 | logout/password/session-revoke routes, to keep the test session alive |

  **Not covered:** all 420 platform-operator routes, partner portal, the `/api/v1` API-key API, signed provider webhooks, file uploads, and the Socket.IO realtime gateway. Covering them needs an operator account, a partner account and an API key. I can add them if you want.

## 2. API inventory (from the live OpenAPI document)

**2,045 operations on 1,619 paths, in 307 controllers, in 154 OpenAPI tags.**

| Method | Operations |
|---|---|
| GET | 840 |
| POST | 775 |
| DELETE | 181 |
| PATCH | 128 |
| PUT | 121 |

| Surface | Operations |
|---|---|
| `/v2/*` staff CRM API | 1,512 |
| `/v2/platform/*` platform-operator console | 420 |
| `/api/v1/*` public API-key API | 61 |
| `/v2/public/*` unauthenticated/public | 49 |
| `/v2/partner/*` partner portal | 3 |

Plus `/health` and `/ready` (version-neutral probes). The full route list with auth and timing is in the CSV. Per-module breakdown (all 154 tags) is in Appendix A.

## 3. Latency of the successful read/write paths from the sweep (399 operations)

- Median of per-endpoint p50: **GET 5.6 ms, POST 4.9 ms, PUT 6.8 ms, PATCH 9.0 ms, DELETE 3.5 ms**
- **282 / 399** have p95 ≤ 10 ms; **380 / 399** have p95 ≤ 20 ms; **all 399** have p95 ≤ 44 ms
- Reject-path latency (1,557 operations): median 2.5 ms, p90 6.4 ms, max 18 ms
- Median successful response is 81 bytes; mean is 661 bytes

### Slowest 25 successful endpoints (by p95)

| Operation | cold ms | p50 ms | p95 ms | p99 ms | max ms | resp bytes |
|---|---|---|---|---|---|---|
| `GET /v2/message-history` | 46.2 | 14.87 | 43.8 | 43.8 | 43.8 | 142 |
| `GET /v2/shell/overview-stats` | 53.64 | 31.35 | 39.31 | 39.31 | 39.31 | 1,150 |
| `GET /v2/appointments/calendar/overview` | 72.49 | 9.04 | 33.77 | 33.77 | 33.77 | 390 |
| `GET /v2/marketplace/apps` | 39.29 | 20.26 | 28.57 | 28.57 | 28.57 | 7,654 |
| `GET /v2/crm/dashboard` | 29.56 | 24.58 | 27.98 | 27.98 | 27.98 | 4,505 |
| `GET /v2/lead-scoring/suggestions` | 8.72 | 6.44 | 26.91 | 26.91 | 26.91 | 65 |
| `GET /v2/dashboard/widgets` | 24.96 | 16.72 | 25.86 | 25.86 | 25.86 | 1,611 |
| `GET /v2/marketplace/apps/{ref}` | 30.54 | 18.5 | 25.23 | 25.23 | 25.23 | 5,860 |
| `GET /v2/billing/usage` | 34.82 | 19.2 | 24.82 | 24.82 | 24.82 | 4,911 |
| `GET /v2/scheduled/options` | 10.32 | 6.48 | 24.75 | 24.75 | 24.75 | 82 |
| `GET /v2/store/orders/counts` | 6.83 | 6.16 | 24.74 | 24.74 | 24.74 | 107 |
| `GET /v2/marketplace/installations` | 19.34 | 16.11 | 23.56 | 23.56 | 23.56 | 45 |
| `GET /v2/conferencing/capabilities` | 6.34 | 4.93 | 23.47 | 23.47 | 23.47 | 102 |
| `GET /v2/inbox/handoff-settings` | 22.92 | 15.95 | 22.51 | 22.51 | 22.51 | 504 |
| `GET /v2/forms` | 15.78 | 7.3 | 22.26 | 22.26 | 22.26 | 65 |
| `GET /v2/message-history/summary` | 20.31 | 18.77 | 21.87 | 21.87 | 21.87 | 315 |
| `GET /v2/deals/board` | 25.34 | 20.4 | 21.8 | 21.8 | 21.8 | 1,877 |
| `GET /v2/widgets` | 10.62 | 7.27 | 21.14 | 21.14 | 21.14 | 128 |
| `POST /v2/contact-consent/exports` | 11.03 | 3.7 | 20.5 | 20.5 | 20.5 | 227 |
| `GET /v2/flow-runtime/analytics` | 10.24 | 7.21 | 19.73 | 19.73 | 19.73 | 353 |
| `POST /v2/onboarding/complete` | 20.67 | 11.36 | 19.47 | 19.47 | 19.47 | 370 |
| `GET /v2/contact-consent/settings` | 4.87 | 5.59 | 19.15 | 19.15 | 19.15 | 1,025 |
| `GET /v2/audit-log/{id}` | 7.6 | 5.55 | 18.1 | 18.1 | 18.1 | 460 |
| `GET /v2/appointment-reminder-report` | 13.56 | 10.79 | 17.17 | 17.17 | 17.17 | 100 |
| `GET /v2/lead-scoring/settings` | 19.12 | 11.18 | 16.92 | 16.92 | 16.92 | 454 |

### Largest 15 successful responses

| Operation | cold ms | p50 ms | p95 ms | p99 ms | max ms | resp bytes |
|---|---|---|---|---|---|---|
| `GET /v2/contacts` | 11.11 | 7.56 | 10.74 | 10.74 | 10.74 | 26,412 |
| `GET /v2/store/gateways/drivers` | 4.33 | 3.62 | 7 | 7 | 7 | 19,904 |
| `GET /v2/audit-log` | 8.78 | 5.2 | 8.07 | 8.07 | 8.07 | 18,180 |
| `GET /v2/auth/session` | 46.18 | 7.57 | 11.35 | 11.35 | 11.35 | 11,744 |
| `GET /v2/notifications/preferences` | 8.39 | 6.84 | 9.54 | 9.54 | 9.54 | 11,635 |
| `GET /v2/forms/templates` | 5.97 | 5.66 | 8.98 | 8.98 | 8.98 | 10,819 |
| `GET /v2/appointment-reminder-packs` | 5.42 | 5.06 | 7.03 | 7.03 | 7.03 | 10,341 |
| `GET /v2/templates/gallery` | 3.53 | 3.16 | 4.01 | 4.01 | 4.01 | 10,274 |
| `GET /v2/marketplace/apps` | 39.29 | 20.26 | 28.57 | 28.57 | 28.57 | 7,654 |
| `GET /v2/marketplace/apps/{ref}` | 30.54 | 18.5 | 25.23 | 25.23 | 25.23 | 5,860 |
| `GET /v2/billing/usage` | 34.82 | 19.2 | 24.82 | 24.82 | 24.82 | 4,911 |
| `POST /v2/broadcast-wizard/contacts/query` | 7.21 | 4.89 | 5.48 | 5.48 | 5.48 | 4,775 |
| `GET /v2/consent/purposes` | 2.95 | 2.69 | 5.39 | 5.39 | 5.39 | 4,508 |
| `GET /v2/crm/dashboard` | 29.56 | 24.58 | 27.98 | 27.98 | 27.98 | 4,505 |
| `GET /v2/marketplace/categories` | 14.77 | 11.28 | 16.54 | 16.54 | 16.54 | 4,500 |

### Successful non-GET operations (sweep, generated bodies)

| Operation | cold ms | p50 ms | p95 ms | p99 ms | max ms | resp bytes |
|---|---|---|---|---|---|---|
| `DELETE /v2/account/avatar` | 5.11 | 3.45 | 4.53 | 4.53 | 4.53 | 11 |
| `DELETE /v2/appointments/calendar/bookings-feed` | 6.09 | 5.11 | 5.42 | 5.42 | 5.42 | 0 |
| `DELETE /v2/catalog/collections/{id}` | 9.52 | 6.28 | 6.55 | 6.55 | 6.55 | 0 |
| `DELETE /v2/catalog/reviews/{id}` | 4.5 | 3.3 | 3.5 | 3.5 | 3.5 | 0 |
| `DELETE /v2/contacts/{id}` | 67.44 | 5.36 | 6.42 | 6.42 | 6.42 | 0 |
| `DELETE /v2/contacts/{id}/follow-up` | 5.09 | 3.23 | 3.37 | 3.37 | 3.37 | 21 |
| `DELETE /v2/flows/geta-publish/settings` | 3.99 | 3.2 | 5.83 | 5.83 | 5.83 | 143 |
| `DELETE /v2/shell/notifications` | 4.48 | 4.55 | 7.42 | 7.42 | 7.42 | 13 |
| `DELETE /v2/sms/senders/{id}` | 6.22 | 5.37 | 6.39 | 6.39 | 6.39 | 0 |
| `DELETE /v2/task-outcomes/{id}` | 5.67 | 3.16 | 3.4 | 3.4 | 3.4 | 0 |
| `DELETE /v2/waba/numbers/{id}/qr-codes/{code}` | 2.52 | 2.46 | 3.29 | 3.29 | 3.29 | 0 |
| `PATCH /v2/account/profile` | 13.17 | 8.97 | 12.49 | 12.49 | 12.49 | 306 |
| `PATCH /v2/invoice-settings` | 12.67 | 10.94 | 12.32 | 12.32 | 12.32 | 649 |
| `PATCH /v2/sales-docs/settings` | 9.64 | 6.2 | 8.95 | 8.95 | 8.95 | 193 |
| `PATCH /v2/shell/workspace` | 10.63 | 6.74 | 9.94 | 9.94 | 9.94 | 1,692 |
| `POST /v2/account/mfa/setup` | 10.37 | 8.97 | 10.07 | 10.07 | 10.07 | 236 |
| `POST /v2/ai-crm/reset` | 15.99 | 4.94 | 5.57 | 5.57 | 5.57 | 11 |
| `POST /v2/appointments/calendar/backfill` | 4.68 | 4.56 | 4.74 | 4.74 | 4.74 | 28 |
| `POST /v2/appointments/calendar/bookings-feed` | 8.6 | 6.9 | 7.05 | 7.05 | 7.05 | 164 |
| `POST /v2/appointments/calendar/google/disconnect` | 10.01 | 6.32 | 6.66 | 6.66 | 6.66 | 134 |
| `POST /v2/appointments/calendar/microsoft/disconnect` | 20.89 | 7.3 | 11.41 | 11.41 | 11.41 | 155 |
| `POST /v2/audit-log/exports` | 8.31 | 4.29 | 6.79 | 6.79 | 6.79 | 305 |
| `POST /v2/auth/verify-email/resend` | 3.94 | 3.27 | 3.36 | 3.36 | 3.36 | 37 |
| `POST /v2/broadcast-wizard/contacts/query` | 7.21 | 4.89 | 5.48 | 5.48 | 5.48 | 4,775 |
| `POST /v2/broadcast-wizard/drafts` | 22.81 | 12.22 | 13.14 | 13.14 | 13.14 | 614 |
| `POST /v2/catalog/disconnect` | 9.76 | 6.43 | 13.67 | 13.67 | 13.67 | 0 |
| `POST /v2/channels/simulator` | 7.14 | 4.61 | 4.78 | 4.78 | 4.78 | 710 |
| `POST /v2/contact-consent/exports` | 11.03 | 3.7 | 20.5 | 20.5 | 20.5 | 227 |
| `POST /v2/contacts/dedupe` | 4.61 | 3.26 | 3.54 | 3.54 | 3.54 | 46 |
| `POST /v2/contacts/{id}/follow-up/done` | 3.87 | 3.34 | 6.93 | 6.93 | 6.93 | 21 |
| `POST /v2/email/templates/preview` | 7.15 | 5.45 | 8.4 | 8.4 | 8.4 | 64 |
| `POST /v2/google-account/disconnect` | 5.47 | 5.08 | 7.39 | 7.39 | 7.39 | 412 |
| `POST /v2/marketplace/apps/{ref}/subscribe` | 8.48 | 6.96 | 11.3 | 11.3 | 11.3 | 54 |
| `POST /v2/message-history/exports` | 11.12 | 4.68 | 5.07 | 5.07 | 5.07 | 304 |
| `POST /v2/notifications/read-all` | 7.39 | 3.19 | 3.3 | 3.3 | 3.3 | 13 |
| `POST /v2/onboarding/complete` | 20.67 | 11.36 | 19.47 | 19.47 | 19.47 | 370 |
| `POST /v2/realtime/ticket` | 5.6 | 2.09 | 2.37 | 2.37 | 2.37 | 75 |
| `POST /v2/shell/tour/seen` | 3.68 | 3.12 | 4.39 | 4.39 | 4.39 | 11 |
| `POST /v2/shell/workspace/branding` | 10.12 | 6.44 | 7.41 | 7.41 | 7.41 | 144 |
| `POST /v2/team-chat/channels/{id}/read` | 10.45 | 8.39 | 9.03 | 9.03 | 9.03 | 11 |
| `POST /v2/team-chat/channels/{id}/typing` | 7.13 | 6.55 | 9.15 | 9.15 | 9.15 | 11 |
| `POST /v2/team-chat/presence` | 4.97 | 4.43 | 4.75 | 4.75 | 4.75 | 11 |
| `PUT /v2/assignment/settings` | 8.71 | 7.57 | 8.76 | 8.76 | 8.76 | 40 |
| `PUT /v2/flows/geta-publish/settings` | 6.92 | 4.31 | 5.01 | 5.01 | 5.01 | 165 |
| `PUT /v2/invoice-settings/gateway` | 12.88 | 10.59 | 11.41 | 11.41 | 11.41 | 222 |
| `PUT /v2/quick-access` | 5.25 | 4.44 | 6.75 | 6.75 | 6.75 | 1,303 |
| `PUT /v2/shell/workspace/notifications` | 8.29 | 6.84 | 7.4 | 7.4 | 7.4 | 1,897 |

## 4. Write-path and core-flow benchmark (valid bodies, sequential)

First 20 requests of each are discarded as warm-up. These are the realistic numbers for the hot CRUD paths. Times are total client-side milliseconds including reading the full body.

| Operation | n | p50 | p95 | p99 | max | mean | req B | resp B |
|---|---|---|---|---|---|---|---|---|
| `POST /v2/tags` | 200 | 8.86 | 12.85 | 20.25 | 28.6 | 9.56 | 44 | 181 |
| `POST /v2/contacts` | 500 | 15.31 | 21.72 | 30.91 | 39.06 | 16.13 | 90 | 1052 |
| `POST /v2/companies` | 200 | 9.26 | 13.86 | 21.39 | 24.21 | 10.08 | 35 | 558 |
| `POST /v2/tasks` | 200 | 10.36 | 14.55 | 15.89 | 16.38 | 10.97 | 33 | 559 |
| `GET /v2/contacts/:id` | 200 | 6.69 | 8.96 | 11.6 | 13 | 6.96 | 0 | 1052 |
| `PATCH /v2/contacts/:id` | 200 | 9.71 | 13.85 | 16.05 | 17.44 | 10.37 | 47 | 1083 |
| `GET /v2/contacts?q= (search)` | 200 | 8.37 | 10.9 | 13.46 | 14.38 | 8.78 | 0 | 21195 |
| `GET /v2/auth/session` | 200 | 5.14 | 7.8 | 11.81 | 36.71 | 5.78 | 0 | 11744 |
| `GET /v2/crm/dashboard` | 100 | 27.17 | 32.98 | 39.36 | 41.24 | 27.54 | 0 | 4625 |
| `GET /v2/inbox/counts` | 200 | 4.74 | 7.49 | 9.05 | 9.69 | 5.09 | 0 | 80 |
| `GET /v2/tags` | 200 | 4.51 | 7.14 | 10 | 10.38 | 4.82 | 0 | 9199 |
| `GET /v2/tasks` | 200 | 11.84 | 15.28 | 18.51 | 42 | 12.45 | 0 | 11281 |
| `GET /v2/companies` | 200 | 8.46 | 11.39 | 12.4 | 14.18 | 8.71 | 0 | 11308 |
| `GET /health (liveness)` | 200 | 1.12 | 1.67 | 5.06 | 18.63 | 1.34 | 0 | 0 |
| `GET /ready (readiness)` | 100 | 1.52 | 1.82 | 4.61 | 4.78 | 1.62 | 0 | 0 |
| `DELETE /v2/tags/:id` | 50 | 5.11 | 7.73 | 8.9 | 8.9 | 5.42 | 0 | 0 |
| `POST /v2/auth/staff/login` | 60 | 22.83 | 29.91 | 90.86 | 90.86 | 25.27 | 0 | 0 |

Repo budgets in `perf/budgets.json` for comparison: class A p95 < 50 ms, B < 150 ms, C < 300 ms. Every path above is inside its budget on this machine, single-client.

## 5. Payload size effects

**Response size** (`GET /v2/contacts?limit=N`, about 520 contacts in the org):

| page size | resp bytes | p50 | p95 | p99 |
|---|---|---|---|---|
| 1 | 1,187 | 5.29 | 7.78 | 8.04 |
| 10 | 10,665 | 6.04 | 10.92 | 17.34 |
| 20 | 21,195 | 5.73 | 9.22 | 9.57 |
| 50 | 52,785 | 6.33 | 8.85 | 11.32 |
| 100 | 105,435 | 7.6 | 17.93 | 18.22 |

About 1.05 KB per contact; cost grows slowly, with 100 rows (105 KB) about 1.4x the 1-row time.

**Request size** (`POST /v2/tags` with a padded `name`; this measures body parsing and rejection, not a successful write):

| request body | HTTP status | p50 | p95 |
|---|---|---|---|
| 1 KB | 422 | 2.29 | 4.84 |
| 10 KB | 422 | 2.15 | 2.32 |
| 100 KB | 413 | 1.63 | 2.01 |
| 500 KB | 413 | 2.1 | 3.41 |
| 1024 KB | 413 | 2.49 | 5.38 |
| 5120 KB | 413 | 10.72 | 41.15 |

- Bodies up to about 10 KB reach validation (422); **100 KB and above is rejected with 413** before validation.
- Rejecting a 5 MB body costs about 11 ms p50 / 41 ms p95. The server drops oversized bodies cheaply.

## 6. Concurrency / throughput (closed loop, 8 s each)

| Endpoint | concurrent clients | req/s | p50 | p95 | p99 | max | errors |
|---|---|---|---|---|---|---|---|
| `GET /v2/auth/session` | 1 | 180.8 | 5.05 | 7.36 | 9.16 | 21.05 | 0 |
| `GET /v2/auth/session` | 10 | 255.9 | 37.78 | 48.72 | 53.87 | 178.54 | 0 |
| `GET /v2/auth/session` | 50 | 246.7 | 198.66 | 242.93 | 318.21 | 517.09 | 0 |
| `GET /v2/auth/session` | 100 | 229.9 | 434.24 | 502.11 | 597.7 | 797.84 | 0 |
| `GET /v2/contacts?limit=20` | 1 | 153 | 5.82 | 10.67 | 14.09 | 36.62 | 0 |
| `GET /v2/contacts?limit=20` | 10 | 295.5 | 33.14 | 43.99 | 52.46 | 84.15 | 0 |
| `GET /v2/contacts?limit=20` | 50 | 298.9 | 159.4 | 239.04 | 336.1 | 614.68 | 0 |
| `GET /v2/crm/dashboard` | 1 | 43.3 | 22.01 | 27.84 | 33.64 | 40.72 | 0 |
| `GET /v2/crm/dashboard` | 10 | 118.1 | 83.12 | 103.78 | 121.44 | 136.27 | 0 |
| `GET /v2/crm/dashboard` | 50 | 91.2 | 543.83 | 686.14 | 734.03 | 803.86 | 0 |

- A single Node process on this shared 4-core box saturates at **about 250-300 req/s**. Past about 10 clients, added concurrency only adds queueing: latency scales roughly linearly with client count (50 clients is about 200 ms p50, 100 clients is about 434 ms p50) while throughput stays flat. No errors occurred at any level.
- `GET /v2/crm/dashboard` is the heaviest measured endpoint: 22 ms alone, 83 ms at 10 clients, 544 ms at 50 clients (about 91 req/s). The API logged "slow request" warnings for it during the 50-client run.
- The load generator shares the CPU with the server, so real capacity is somewhat higher; treat this as a floor.

## 7. Redis

Version 7.0.15, noeviction policy, 6.8 MB used after the run. Round-trip from a Node client over loopback:

| Redis op (round trip, ms) | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| PING | 2000 | 0.051 | 0.077 | 0.127 | 1.08 |
| SET 100B | 2000 | 0.047 | 0.066 | 0.106 | 3.141 |
| GET 100B | 2000 | 0.042 | 0.051 | 0.083 | 1.206 |
| GET 100KB | 1000 | 0.145 | 0.22 | 0.664 | 1.816 |
| EVAL (lua incr) | 1000 | 0.045 | 0.065 | 0.092 | 2.042 |
| pipeline 50 SET | 500 | 0.124 | 0.182 | 2.259 | 3.041 |

Server-side command cost during the 2,045-operation sweep plus flows (`INFO commandstats`, avg µs per call): GET 1.5, SET 1.9, MGET 1.7, DEL 1.3, HMGET 0.7, **EVAL 47.6** (BullMQ Lua scripts, 55k calls). Redis slow log (threshold 1 ms) held only 2 entries, both my own test's `obliterate` script. **Redis was never a bottleneck.**

## 8. Queues (BullMQ) and the outbox

**The system defines 52 BullMQ queues** (`apps/api/src/infra/queue/queues.ts`); default job options are 5 attempts with exponential backoff from 2 s (inbound-ingest queues: 10 attempts from 5 s, about 40 min); processors run with concurrency from 1 to 16 (e.g. `webhook-forward` 16, `waba-ingest` 8, `flow-run` 8, `web-push` 8).

**Synthetic probe** (own queues on the same Redis, so it isolates BullMQ + Redis cost from application work). Times are ms:

| Probe | jobs | worker concurrency | simulated work ms | enqueue p50/p99 | queue wait p50/p99 | processing p50/p99 | end-to-end p50/p99 | jobs/s |
|---|---|---|---|---|---|---|---|---|
| noop | 1000 | 8 | 0 | 0.166 / 1.647 | 0 / 1 | 0 / 4 | 1 / 5 | 4485.5 |
| 20ms-work | 1000 | 8 | 20 | 0.086 / 0.324 | 1244 / 2486 | 21 / 25 | 1266 / 2507 | 380.1 |
| 20ms-work-c1 | 200 | 1 | 20 | 0.081 / 0.367 | 2044 / 4079 | 21 / 24 | 2064 / 4102 | 48 |


- Enqueue costs **0.08-0.17 ms p50** (p99 under 2 ms); `addBulk` of 500 jobs takes 15-22 ms.
- With a no-op handler, BullMQ adds about **0-1 ms** of pickup latency and sustains **about 4,500 jobs/s** at concurrency 8.
- The large "queue wait" in the 20 ms-work probes is the backlog from enqueueing 1,000 jobs instantly into 8 (or 1) slots, not overhead. Throughput matches theory: 8 slots / 20 ms = 400/s measured 380/s; 1 slot = 50/s measured 48/s. **Capacity planning rule: jobs/s per queue = concurrency / handler time.**

**The application's own queues** were almost idle in this run (only 8 completed jobs exist across 52 queues, since the sweep touches few enqueue paths and external providers are unreachable):

| Queue | jobs sampled | wait p50 ms | processing p50 ms | processing max ms |
|---|---|---|---|---|
| msg-log-export | 1 | 2 | 86 | 86 |
| consent-export | 2 | 1 | 15 | 27 |
| owning-team-backfill | 4 | 22 | 5 | 24 |
| audit-log-export | 1 | 1 | 153 | 153 |

These are tiny samples, so only their order of magnitude means anything. All queues showed 0 waiting, 0 active, 0 failed at the end.

**Transactional outbox** (`event_outbox`, drained by the worker): 6,157 events processed (API writes emit one; 3,054 outbox inserts were recorded during the sweep alone).

| | avg ms | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| created to processed | 1,002 | 1,009 | 1,894 | 1,981 | 2,007 |

This is **by design a polling floor, not a slowdown**: `OutboxDrainService` runs on `@Interval(2_000)` (`workers/outbox-drain.service.ts:67`), so any event waits 0-2 s for the next tick (average 1 s). Any user-visible side effect that goes through the outbox (notifications, automations, realtime fan-out from events, webhooks) has a **~1 s average, 2 s worst-case** delay before it even reaches a queue. Failures: 0 dead, 0 pending at the end.

## 9. Database

`pg_stat_statements` for the whole sweep: every hot statement averages **0.00-0.08 ms**, with a worst single statement of 1.5 ms (audit insert) among the top 12 by total time. The only slow statement was a one-off `pg_timezone_names` lookup (59 ms, first call). **The database is not the bottleneck**; time goes into Nest request handling, guards, per-request transaction setup (`set_config` ran 30,794 times) and JSON serialization.

Per request on the write path the API performs: session lookup, plan/subscription lookup (5,248 calls), tenant `set_config`, the business write, an `audit_log` insert, a `security_events` insert, and an `event_outbox` insert, all in one transaction, at about 0.04-0.06 ms each.

## 10. Findings worth acting on

1. **Outbox latency floor of ~1 s avg / 2 s max** (2 s poll). If you want near-real-time side effects, lower the interval or wake the drain via Redis pub/sub or `LISTEN/NOTIFY` after commit.
2. **`GET /v2/crm/dashboard` (24 ms alone, 544 ms p50 at 50 clients) and `/v2/shell/overview-stats` (31 ms)** are the heaviest endpoints and degrade fastest under concurrency; the marketplace app listings (20 ms, 7.6 KB) and `billing/usage` (19 ms) follow. These are candidates for caching.
3. **Every staff login revokes the user's previous session.** `auth_sessions` shows one `revoked_at` update per login (my own benchmark killed its own token this way). That is a product decision, but it means one user cannot be logged in on two devices at once, and any automation that logs in repeatedly signs the human out.
4. **Staff login costs about 23 ms p50** (password hashing + session/audit writes), by far the most expensive common call; fine, but it is the one to rate-limit.
5. **`GET /v2/contacts` returns about 1 KB per row** (105 KB for 100 rows); consider a slimmer list projection for the list view.
6. **Nothing failed:** zero 5xx responses across the 2,045-operation sweep and all follow-up benchmarks, and zero errors at every concurrency level up to 100 clients.
7. The repo already has a k6 harness (`perf/latency.js`, `load.js`, `spike.js`, `perf/budgets.json`) and prior results in `perf/results/`. k6 was not installable here, so I wrote an equivalent Node harness; for CI-grade numbers run the repo's own k6 suite on production-like hardware.

## Appendix A: every module (OpenAPI tag)

| Module (OpenAPI tag) | Operations | Measured on success path | Median of p50 (ms) | Slowest p50 (ms) |
|---|---|---|---|---|
| platform | 420 | 0 | – | – |
| team-inbox | 71 | 14 | 5.86 | 15.95 |
| campaigns | 48 | 12 | 4.74 | 12.22 |
| appointments | 44 | 11 | 6.33 | 9.04 |
| calling | 44 | 6 | 5.78 | 9.23 |
| contacts | 41 | 15 | 3.7 | 8.48 |
| auth | 33 | 6 | 7.18 | 11.36 |
| whatsapp-numbers | 33 | 5 | 3.34 | 5.03 |
| flows | 31 | 8 | 3.57 | 9.06 |
| sales-docs | 30 | 5 | 6.2 | 8.64 |
| facebook | 30 | 8 | 6.12 | 7.46 |
| email | 27 | 6 | 6.07 | 8.33 |
| marketplace | 25 | 7 | 11.28 | 20.26 |
| fields | 24 | 0 | – | – |
| shell | 24 | 18 | 3.73 | 31.35 |
| team-chat | 24 | 10 | 6.55 | 8.39 |
| forms | 24 | 4 | 6.93 | 7.3 |
| account | 22 | 7 | 5.61 | 8.97 |
| tasks | 22 | 5 | 6.41 | 8.54 |
| catalog | 22 | 7 | 6.28 | 11.67 |
| privacy | 21 | 4 | 4.56 | 5.14 |
| billing | 20 | 7 | 5.37 | 19.2 |
| shopify | 20 | 2 | 6.19 | 6.19 |
| growth | 20 | 1 | 5.37 | 5.37 |
| whatsapp-device-groups | 19 | 0 | – | – |
| deals | 18 | 4 | 9.68 | 20.4 |
| invoices | 18 | 2 | 8.69 | 8.69 |
| contact-consent | 18 | 7 | 3.7 | 5.59 |
| companies | 17 | 5 | 6.62 | 7.53 |
| pipelines | 17 | 4 | 6.98 | 7.16 |
| scheduled | 16 | 2 | 6.48 | 6.48 |
| flow-runtime | 16 | 6 | 4.31 | 7.21 |
| api-library | 16 | 7 | 3.73 | 3.85 |
| workspace-members | 16 | 6 | 8.2 | 8.46 |
| broadcasts | 15 | 3 | 3.96 | 4.75 |
| widgets | 15 | 3 | 6.14 | 7.27 |
| ai-training | 14 | 3 | 6.27 | 6.88 |
| payments | 14 | 4 | 6.78 | 7.01 |
| notifications | 14 | 7 | 3.19 | 6.84 |
| whatsapp-devices | 14 | 0 | – | – |
| telegram | 14 | 3 | 5.66 | 7.02 |
| line | 14 | 3 | 6.1 | 6.3 |
| viber | 14 | 4 | 5.92 | 6.32 |
| segments | 13 | 1 | 4.5 | 4.5 |
| message-templates | 13 | 3 | 3.73 | 4.45 |
| wechat | 13 | 3 | 6.03 | 6.11 |
| compliance | 13 | 5 | 3.48 | 4.37 |
| contact-assignment | 12 | 4 | 6.22 | 7.57 |
| lead-sources | 12 | 1 | 5.91 | 5.91 |
| whatsapp-forms | 12 | 2 | 6.03 | 6.03 |
| public-api | 11 | 0 | – | – |
| products | 11 | 4 | 3.32 | 3.48 |
| booking-types | 11 | 2 | 6.21 | 6.21 |
| lead-scoring | 11 | 5 | 6.44 | 11.18 |
| activity-types | 10 | 1 | 4.37 | 4.37 |
| sales-orders | 10 | 2 | 7.79 | 7.79 |
| public-cms | 10 | 7 | 1.7 | 2.1 |
| instagram | 10 | 4 | 6.04 | 6.24 |
| Contact | 10 | 0 | – | – |
| whatsapp-groups | 10 | 0 | – | – |
| booking-public | 10 | 0 | – | – |
| wallet | 9 | 9 | 5.39 | 9.9 |
| recurring-invoices | 9 | 1 | 6.25 | 6.25 |
| appointment-message-templates | 9 | 2 | 6.49 | 6.49 |
| booking-page | 9 | 1 | 11.48 | 11.48 |
| storefront-builder | 9 | 1 | 4.42 | 4.42 |
| storefront-public | 9 | 0 | – | – |
| workspace-teams | 9 | 1 | 4.07 | 4.07 |
| lead-inbox | 9 | 4 | 6.4 | 6.77 |
| setup | 8 | 1 | 3.93 | 3.93 |
| attributes | 8 | 3 | 3.82 | 5.11 |
| credit-notes | 8 | 1 | 6.75 | 6.75 |
| tax-rates | 8 | 1 | 5.85 | 5.85 |
| store-gateways | 8 | 3 | 3.81 | 3.83 |
| store-orders | 8 | 2 | 7.44 | 7.44 |
| meta-lead-ads | 8 | 2 | 9.04 | 9.04 |
| contact-groups | 7 | 1 | 3.69 | 3.69 |
| contact-views | 7 | 1 | 3.85 | 3.85 |
| google-account | 7 | 2 | 5.08 | 5.08 |
| meeting-conferencing | 7 | 2 | 4.93 | 4.93 |
| store-coupons | 7 | 1 | 6.19 | 6.19 |
| Template | 7 | 0 | – | – |
| audit-log | 7 | 6 | 5.2 | 6.15 |
| ai | 6 | 3 | 7.39 | 8.63 |
| channels | 6 | 2 | 5.61 | 5.61 |
| status-options | 6 | 0 | – | – |
| woocommerce | 6 | 1 | 5.51 | 5.51 |
| help-agent | 6 | 2 | 6.29 | 6.29 |
| Deal | 6 | 0 | – | – |
| Company | 6 | 0 | – | – |
| Campaign | 6 | 0 | – | – |
| webhooks | 6 | 1 | 3.8 | 3.8 |
| workspace-leave | 6 | 2 | 5.19 | 5.19 |
| whatsapp-links | 6 | 1 | 6.51 | 6.51 |
| public | 5 | 2 | 2.01 | 2.01 |
| i18n | 5 | 3 | 2.58 | 7.17 |
| message-history | 5 | 4 | 14.87 | 18.77 |
| owner-reassignments | 5 | 1 | 3.51 | 3.51 |
| field-sections | 5 | 0 | – | – |
| tags | 5 | 1 | 3.51 | 3.51 |
| sms | 5 | 2 | 5.48 | 5.48 |
| store-customers | 5 | 1 | 5.42 | 5.42 |
| store-payments | 5 | 3 | 3.9 | 4.46 |
| Broadcast | 5 | 0 | – | – |
| products-services | 5 | 1 | 6.32 | 6.32 |
| public-invoices | 5 | 0 | – | – |
| addons | 4 | 1 | 7.29 | 7.29 |
| lead-handling | 4 | 1 | 3.19 | 3.19 |
| crm-revenue | 4 | 2 | 13.5 | 13.5 |
| invoice-settings | 4 | 4 | 10.59 | 10.94 |
| store-groups | 4 | 2 | 4.23 | 4.23 |
| Flow | 4 | 0 | – | – |
| Scheduled | 4 | 0 | – | – |
| support | 4 | 1 | 3.8 | 3.8 |
| ai-crm | 4 | 2 | 7.55 | 7.55 |
| contact-notes | 4 | 0 | – | – |
| contact-files | 4 | 0 | – | – |
| contact-meetings | 4 | 0 | – | – |
| sales-docs-public | 4 | 0 | – | – |
| forms-public | 4 | 0 | – | – |
| whatsapp-customers | 3 | 1 | 3.19 | 3.19 |
| appointment-reminder-packs | 3 | 1 | 5.06 | 5.06 |
| referrals | 3 | 3 | 4.08 | 5.11 |
| dashboard | 3 | 3 | 6.54 | 16.72 |
| analytics | 3 | 3 | 11.57 | 12.41 |
| partner-portal | 3 | 0 | – | – |
| developer-rest-api-v1 | 3 | 1 | 3.99 | 3.99 |
| ContactGroup | 3 | 0 | – | – |
| Message | 3 | 0 | – | – |
| persona | 2 | 1 | 4.62 | 4.62 |
| bsp | 2 | 1 | 3.69 | 3.69 |
| warmer | 2 | 1 | 5.97 | 5.97 |
| appointment-channels | 2 | 1 | 7.29 | 7.29 |
| health | 2 | 2 | 1.57 | 1.57 |
| quick-access | 2 | 2 | 4.44 | 4.44 |
| Account | 2 | 0 | – | – |
| Conversation | 2 | 0 | – | – |
| Device | 2 | 0 | – | – |
| workspace-invitations | 2 | 0 | – | – |
| dev-simulator | 2 | 0 | – | – |
| channel-webhooks | 2 | 0 | – | – |
| contact-activities | 2 | 0 | – | – |
| plans | 1 | 1 | 5.93 | 5.93 |
| public-pricing | 1 | 1 | 1.63 | 1.63 |
| crm-dashboard | 1 | 1 | 24.58 | 24.58 |
| appointment-reminder-report | 1 | 1 | 10.79 | 10.79 |
| cms | 1 | 1 | 2.22 | 2.22 |
| team-inbox-conversations | 1 | 0 | – | – |
| contact-message-stats | 1 | 0 | – | – |
| store-public | 1 | 0 | – | – |
| realtime | 1 | 1 | 2.09 | 2.09 |
| Media | 1 | 0 | – | – |
| lead-hooks-public | 1 | 0 | – | – |
| contact-attribution | 1 | 0 | – | – |
