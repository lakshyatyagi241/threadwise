# Tenant context: where it comes from and where it travels

The rule: **no tenant-owned row is read, written, searched, cached, exported, processed or acted on without a verified tenant context.**
This page is the map of how that context is established and carried, so a reviewer can check a new code path against it. The
mechanism (RLS, `org_id` first in every key, the non-superuser connection) is in [multi-tenancy.md](multi-tenancy.md); this page is
about the _identity_ that feeds it. Every statement here was read from the code on 2026-10-11 and is checked by the
[tenancy audit](../../tools/tenancy-audit/README.md) where the audit can check it.

## 1. HTTP requests

1. A guard authenticates the caller (user session, API key, partner agent, or an operator's act-as session) and writes
   `orgId`, `actorType`, `actorId` and `userId` into the request's `RequestContextStore` (an `AsyncLocalStorage`).
2. The org comes from the **verified credential**: the session, the key's own row, the act-as token. A client-supplied `org_id`,
   `tenant_id` or header is never read as the tenant (the authz audit's field-level and IDOR specs attack this).
3. Repositories run inside `DatabaseService.tx()` / `txAs({ orgId })`, which calls `withTenant`: one transaction, with
   `set_config('app.org_id', <id>, true)`. The setting is transaction-local, so a pooled connection never carries a tenant to the next
   borrower (`tenancy-concurrency.e2e.spec.ts` checks the pool after a mixed burst).
4. Row-Level Security then filters every statement by `current_org_id()`. With no context the answer is **zero rows**, not all rows.
5. A tenant route must not call `privileged()`; the audit lists every file that does (`policy/privileged-allowlist.json`).

## 2. Before a tenant exists (pre-tenant resolution)

Some entry points have to find the workspace first: sign-in by e-mail, an API key prefix, a public booking or document link, an
inbound webhook. They resolve it from a **secret or an external identity**, never from a caller-chosen org id, and only then pin the
context:

| Entry point                                               | Resolved by                                                                        | Then                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| Sign-in                                                   | `TenantDirectory` (credentials are verified per candidate org)                     | session carries the org                    |
| API key (`/api/v1`, `/public/v1`)                         | unique key prefix, then constant-time hash / HMAC                                  | `ctx.orgId = key.org_id`                   |
| Public tokens (booking, sales doc, invoice, form, widget) | hash or high-entropy token lookup (`SECURITY DEFINER` functions or `privileged()`) | `ctx.orgId = hit.orgId`                    |
| Inbound WhatsApp (WABA)                                   | `waba_route_lookup(phone_number_id, waba_id)`                                      | every write `txAs({ orgId: route.orgId })` |
| Store webhooks (Shopify, Woo)                             | `ecom_store_lookup(kind, secret)`, then the store's signature                      | job carries the org                        |
| Telegram, Facebook, Instagram, widgets                    | `tg_bot_lookup`, `fb_page_lookup`, shared engine secret, `wgt_widget_lookup`       | per-org processing                         |

The 27 `SECURITY DEFINER` lookup functions are listed in `tenant-database-query-audit.json`. They return **routing ids**, not tenant
content. Two of them mutate (`marketplace_start_trial`, `marketplace_subscription_set_cancel`) and both scope to `current_org_id()`.

## 3. Background work

- **Jobs** (BullMQ) carry `orgId` in the payload. A processor opens `txAs({ orgId })` or `RequestContextStore.run({ orgId, actorType: 'system' })`
  before touching data. The audit fails a processor that does neither unless it is declared (`policy/processor-declarations.json`).
- **Sweeps and crons** use `privileged()` only to _find_ rows across workspaces (ids, or an age-based retention delete), then act per row
  in that row's own context or with explicit `org_id` predicates. All 69 files were reviewed on 2026-10-11 (three defects found and fixed).
- **The outbox** stores `org_id` on each event; subscribers receive `OutboxEvent.orgId` and open their own context. There is no ambient
  request context in a worker, so any code that reads `RequestContextStore.peek()` there gets nothing: pass the org explicitly.
- **Locks** include the org: `SenderLease.key(orgId, ...)`, `camp:run:<orgId>:<id>`, the device lease `(orgId, deviceId)`, and the Postgres
  advisory locks.

## 4. Realtime

The socket handshake (`ticket` or access token) yields a server-side identity; the room names are built from `identity.orgId`, never from
what the client sends (`roomName(identity.orgId, ref)`). A join is checked against the same visibility rule as the REST read, and the
sockets are re-checked when a workspace's `roles_version` moves. Suspension drops the sockets (ADR-0019).

## 5. Caches, queues, files

- **Redis keys** for tenant data carry the org id (`rbac:<orgId>:...`, `idem:<orgId>:<key>`, `wa:media-id:<orgId>:...`, `chat:dispatch:<orgId>:...`).
  Keys without one are rate-limit counters by address or token, shared embeddings of query text, or auth challenges; each is listed with its
  reason in `policy/redis-reviewed.json`.
- **Object storage** paths start with the org (`marketing/<orgId>/...`, `telegram/<orgId>/...`). Flow media is a deliberate public capability
  URL (`<org uuid>/<96 random bits>`).
- **Responses**: `no-store` on auth, account, platform and onboarding; tenant data routes send no explicit `Cache-Control` (finding TI-020).

## 6. Operators

Platform tables (`platform_*`, `admin_ai_keys`, ...) are `privileged_only` / `operator_write`. Operator routes sit behind `OperatorGuard`
(and `PlatformPermissionGuard` on the ones that need a platform permission). An operator acting inside a workspace uses an act-as token
(ADR-0020) that is stamped onto every audit row of the transaction.

## Where this can still fail

`app.privileged` is a plain setting the application role can switch on, so SQL an attacker controls on an application connection is not
bound by RLS ([ADR-0028](../adr/0028-privileged-mode-must-not-be-a-settable-guc.md), proposed). The audit's findings register
(`tools/tenancy-audit/policy/findings.json`) lists the other open items and the owner decisions.
