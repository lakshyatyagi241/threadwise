---
domain: marketplace
code: MKT
title: Marketplace (mini apps and integrations)
threadwise_version: 'n/a (owner-requested extension, no Reference source)'
sources_read: 0
---

# Marketplace (mini apps and integrations)

## Overview

The Marketplace is an **owner-requested extension, not a Reference port**. Reference has only the code-extension loader and the billing add-ons
(`addons-extension-registry`, code `ADD`): uploaded code runs inside the one process, with no catalogue, no per-workspace install and no scopes.
So this entry describes what this repo built, read from the code (`apps/api/src/modules/marketplace`, `apps/api/src/infra/providers/marketplace`,
`packages/contracts/src/marketplace`, `apps/web/src/features/marketplace`, the `mkt_*` migrations) and the existing docs, not from Reference.
Sections that Reference entries fill with Reference paths (`Source refs`, the coverage block) are therefore empty.

In this repo an app is **data**: a listing, versions that carry a declarative manifest, and for an integration a connector **recipe**. Nothing a
listing holds is executed in the API process; the ZIP installer of `addons-extension-registry` stays operator-only and is not a way to publish a
listing.

Two tabs: **mini apps** (extend the product) and **integrations** (connect an outside service). Actors:

- **Workspace admin** (Owner or Admin by default): browses, installs after consent, configures, pauses, uninstalls, subscribes to paid apps, asks for
  an app that does not exist and votes for requests.
- **Platform operator** (admin console, MFA enrolled like every operator route): runs categories and listings, reviews and publishes versions, sets prices,
  hides or kills an app, triages requests, reads usage and subscriptions.
- **Sender** (a lead portal or a tool such as Zapier): posts to the public delivery address of a connection; the connection secret is the credential.
- **Worker**: polls pull portals, processes stored deliveries, lapses and reminds subscriptions.

Three API surfaces: workspace `/v2/marketplace`, operator `/v2/platform/marketplace`, public `/v2/public/marketplace/hooks/:publicKey[/:token]`.

Plan tiers: plan feature `marketplace` (default on) gates every workspace route and the limit `installed_apps` caps installs (0 = unlimited, billing
add-ons stack). A listing may also name a plan feature (`planFeature`); a workspace without it sees the app locked. A paid app is sold as a billing
add-on through the existing checkout (see MKT-024 to MKT-028).

Connections: `addons-extension-registry` (entitlements, add-on fulfilment, module registry), `platform-payment-gateways` (checkout, refunds,
recurring add-ons), `plans-subscriptions-trials` (plan features, `plan_visible_addons`), `roles-permissions` (`market.apps.*`), the lead pipeline
(`modules/leads`, through two leaf ports), `notifications-activity-audit` (audit, notifications, outbox), `channel-email` (the Email integration is a
listing), `appointments-booking`, `forms-links-groups` and `lead-scoring` (first-party app listings), `chrome-extension-sheets-addon` (client listings).

Specs and docs this entry summarises: `docs/specs/marketplace-mini-apps-and-integrations.md`, `docs/api/marketplace.md`,
`docs/threadwise-port/wiring/marketplace.md`, `docs/runbooks/marketplace-publish-listing.md`, `docs/runbooks/lead-portal-setup.md`,
`docs/specs/lead-portals-feasibility.md`, `docs/threadwise-port/parity/product-extensions.md` (items 20, 21, 24).

## Feature index

Status values describe this repo: `implemented` (built and tested, usually against stand-ins), `partial` (framework or part built, said below),
`not-built` (recorded so nobody assumes it exists).

| Id         | Feature                                                                   | Status      | Depends on                                       |
| ---------- | ------------------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| TW-MKT-001 | Catalogue: listings, categories, versions and their lifecycle             | implemented | -                                                |
| TW-MKT-002 | Browse, search, shelves and categories (workspace)                        | implemented | TW-MKT-001                                       |
| TW-MKT-003 | App page: card, detail, listing content, maturity and notice              | implemented | TW-MKT-001                                       |
| TW-MKT-004 | Manifest v1 and the scope registry                                        | implemented | -                                                |
| TW-MKT-005 | Install with scopes and consent                                           | implemented | TW-MKT-004                                       |
| TW-MKT-006 | Re-consent when a newer version asks for more                             | implemented | TW-MKT-005                                       |
| TW-MKT-007 | Manage an installation: configure, pause, test, rotate, sample, events    | implemented | TW-MKT-005                                       |
| TW-MKT-008 | Installation health and delivery counters                                 | implemented | TW-MKT-007                                       |
| TW-MKT-009 | Uninstall with the keep-or-delete data choice                             | implemented | TW-MKT-005                                       |
| TW-MKT-010 | Connector framework and registry (five mechanisms plus `client`)          | partial     | -                                                |
| TW-MKT-011 | `webhook_relay` connector and the public delivery door                    | implemented | TW-MKT-010                                       |
| TW-MKT-012 | `push` connector: portals that post or GET, stored first, worker-run      | implemented | TW-MKT-011                                       |
| TW-MKT-013 | `pull` connector, the pull engine, Sync now and backfill                  | implemented | TW-MKT-010                                       |
| TW-MKT-014 | `client` connector (software or a built-in screen the member connects)    | implemented | TW-MKT-010                                       |
| TW-MKT-015 | `oauth` connector                                                         | partial     | TW-MKT-010                                       |
| TW-MKT-016 | `email_parse` connector                                                   | partial     | TW-MKT-010                                       |
| TW-MKT-017 | Lead pipeline gateway (the lead-source connectors end in `modules/leads`) | implemented | TW-MKT-011, TW-MKT-012, TW-MKT-013               |
| TW-MKT-018 | Lead portal recipes shipped as data                                       | implemented | TW-MKT-012, TW-MKT-013                           |
| TW-MKT-019 | Requests and voting                                                       | implemented | -                                                |
| TW-MKT-020 | Operator console: categories, listings, versions, review, publish         | implemented | TW-MKT-001                                       |
| TW-MKT-021 | Hide, unhide, kill switch                                                 | implemented | TW-MKT-020                                       |
| TW-MKT-022 | Operator insights: usage per app and the demand report                    | implemented | TW-MKT-019                                       |
| TW-MKT-023 | Plan gating, install limit, module lock and plan-gated visibility         | implemented | TW-MKT-002                                       |
| TW-MKT-024 | Paid apps: operator pricing, subscribe, trial, cancel, resume, lapse      | implemented | TW-MKT-023                                       |
| TW-MKT-025 | Card renewal of an app (BL-070)                                           | implemented | TW-MKT-024                                       |
| TW-MKT-026 | Annual billing, price lock, coupons for one app (BL-072, BL-071, BL-078)  | implemented | TW-MKT-024                                       |
| TW-MKT-027 | Renewal reminders, failed-payment and ended notices (BL-076)              | implemented | TW-MKT-024                                       |
| TW-MKT-028 | Refunds of unused time and of a withdrawn app (BL-077)                    | implemented | TW-MKT-024                                       |
| TW-MKT-029 | First-party listings, apps that own plan features, install-gated access   | implemented | TW-MKT-024                                       |
| TW-MKT-030 | Web: workspace screens                                                    | implemented | TW-MKT-002 to TW-MKT-009, TW-MKT-019, TW-MKT-024 |
| TW-MKT-031 | Web: operator console screens                                             | implemented | TW-MKT-020 to TW-MKT-022, TW-MKT-024             |
| TW-MKT-032 | Not built: third-party mini apps, wallet payment, payouts and the rest    | not-built   | -                                                |

## Features

### TW-MKT-001 - Catalogue: listings, categories, versions and their lifecycle

- **Status:** implemented
- **Summary:** The platform owns the catalogue. A listing (`marketplace_apps`) has versions (`marketplace_app_versions`) that carry the manifest and,
  for an integration, the recipe. Categories (`marketplace_categories`) are per tab; 21 are seeded (8 for mini apps, 13 for integrations).
- **Actors & access:** operator only writes (`platform.market.manage`, `platform.market.review`); a workspace reads what is published and what it has installed.
- **Rules & edge cases:**
  1. Listing lifecycle: `draft -> in_review -> published <-> hidden`, and `killed` from any state. Only `published` appears in browse and search.
  2. Version lifecycle: `draft -> in_review -> approved -> published -> retired`, or `rejected`, which is edited and resubmitted. Each version number is higher than any before.
  3. A version is validated before it is stored: manifest v1, a recipe that agrees with it (slug, category, connector type), the connector type's own checks, and every address in
     the recipe is https on a public DNS name (checked on save and again before each outbound call).
  4. A version can be **published** only when its connector type is implemented (`409 MKT_CONNECTOR_NOT_AVAILABLE` otherwise).
  5. Publishing retires the previous published version and, for every installation, moves it to the new version when its granted scopes already cover the new ones (narrowing the
     grant) or sets it waiting for consent. Killed installations are left alone. Each moved installation gets an audit row and an outbox event in its own workspace.
  6. A never-published draft can be deleted; a category can be deleted only when empty (`MKT_CATEGORY_IN_USE`).
- **Data:** `marketplace_categories` (`(kind, slug)` unique), `marketplace_apps` (`current_version_id`, `install_count` kept by a trigger), `marketplace_app_versions` (manifest and recipe jsonb,
  `scopes text[]`, review state). Platform tables: no `org_id`, forced RLS, writes only on the privileged path.
- **Acceptance criteria:**
  - Given a draft listing with an approved version, when the operator with `platform.market.review` publishes it, then it appears in browse and the previous version is retired.
  - Given a version whose connector type is `oauth`, when it is published, then the call is `409 MKT_CONNECTOR_NOT_AVAILABLE`.
  - Given an operator with only `platform.market.manage`, when they approve a version, then the call is refused.
- **Port notes:** `OperatorCatalogueService`, `OperatorCatalogueStore`, `platform-marketplace.controller.ts`; migrations `20261021090000_mkt_catalogue`, `..090300_mkt_seed`.

### TW-MKT-002 - Browse, search, shelves and categories (workspace)

- **Status:** implemented
- **Summary:** A workspace sees categories of a tab with counts, three shelves (`popular`, `new`, `featured`, eight cards each) and a keyset-paged list with search.
- **Actors & access:** `market.apps.read`; plan feature `marketplace` (`422 PLAN_FEATURE_LOCKED`, reads included).
- **Endpoints:** `GET /v2/marketplace/categories?kind=`, `GET /shelves?kind=`, `GET /apps` (query `kind`, `category`, `q`, `installed`, `sort=featured|popular|new|name`, `limit` 1..100 default 24, `cursor`).
- **Rules & edge cases:**
  1. A malformed `cursor` is `422 VALIDATION_FAILED`.
  2. A locked app still shows, with an upgrade prompt; an installed app is never locked.
  3. The card shows the version a new install gets (the installed version when the workspace has it).
  4. Add-on apps are filtered by the plan-gated visibility rule (TW-MKT-023).
- **Acceptance criteria:**
  - Given a published app in category X, when the workspace lists category X, then the app is in the list and the category count includes it.
  - Given `installed=true`, when listing, then only the workspace's installed apps come back.
- **Port notes:** `BrowseService`, `browse.repository.ts`, `plan-visibility.ts`, `marketplace.mapper.ts`; contract `catalogue.ts`.

### TW-MKT-003 - App page: card, detail, listing content, maturity and notice

- **Status:** implemented
- **Summary:** The app page is the card plus description, listing content (long description, highlights, screenshots, a data-processing disclosure with summary, regions and deletion),
  the scopes in plain words with a risk level, surfaces, support, developer, a changelog of up to five published versions and, for an integration, the setup fields and instructions.
- **Rules & edge cases:**
  1. Maturity is `stable`, `beta` or `needs_portal_setup`, with one plain sentence beside the badge (listing jsonb, no column).
  2. The page never carries endpoints, the field mapping, rate limits or test payloads.
  3. An app is addressed by uuid or by slug.
- **Port notes:** `marketAppCardSchema`, `marketAppDetailSchema` in contracts `catalogue.ts`.

### TW-MKT-004 - Manifest v1 and the scope registry

- **Status:** implemented
- **Summary:** One declarative document per version, unknown keys refused, never code. A small registry of scopes maps onto existing workspace permission keys.
- **Rules & edge cases:**
  1. Manifest fields: `manifestVersion` (1), `id` (slug `^[a-z][a-z0-9-]{1,47}$`), `name` (2 to 60), `description` (10 to 600), `kind`, `category`, `version` (semver), `scopes`, `surfaces`, `pricing`
     (the developer's **proposal** only; nothing reads it for money), `support`, `developer`, `connector` (integrations), `module` (first-party mini apps).
  2. `surfaces` are declared and stored but not rendered (they are for out-of-process mini apps, TW-MKT-032).
  3. The registry has 20 scopes (`MARKET_SCOPES` in `scopes.ts`), among them `contacts.read`, `contacts.write`, `leads.write`, `conversations.read`, `messages.send`, `deals.*`, `tasks.*`,
     `appointments.*`, `forms.*`, `email.*`, `templates.read`, `analytics.read`, `webhooks.manage`. Each has a risk (low, medium, high) and the permission keys it stands for.
  4. A unit test proves every key a scope names is a seeded permission. `scopeCovers(granted, key)` is the check an app actor's request will go through once out-of-process apps exist; nothing uses it for enforcement yet.
- **Port notes:** contracts `manifest.ts`, `scopes.ts`.

### TW-MKT-005 - Install with scopes and consent

- **Status:** implemented
- **Summary:** An admin installs an app after seeing its permission list; the platform records what they accepted.
- **Actors & access:** `market.apps.install`; plan feature `marketplace`; the limit `installed_apps`.
- **Endpoints:** `POST /v2/marketplace/apps/:ref/install` `{ acceptedScopes, credentials?, config? }` -> 201 `{ installation, inboundSecret }`.
- **Rules & edge cases:**
  1. `acceptedScopes` must **equal** the scopes of the version being installed: fewer or extra is `422 MKT_CONSENT_REQUIRED` (`errors` lists `missing:<scope>` and `unexpected:<scope>`).
  2. The installer must hold every permission key the requested scopes stand for, or `403 MKT_SCOPE_EXCEEDS_INSTALLER` lists the missing keys. Installing is never a way to gain a capability.
  3. One installation per `(org, app)` (`MKT_ALREADY_INSTALLED`). A locked app is `422 MKT_APP_LOCKED`; a workspace at its `installed_apps` limit is `422 PLAN_LIMIT_REACHED`.
  4. A paid app without a subscription is `422 MKT_SUBSCRIPTION_REQUIRED` (with `checkoutPath`) or `409 MKT_NOT_FOR_SALE`.
  5. `inboundSecret` is the one value the platform generates; it is in this answer and nowhere else, ever (`null` for an app with no connection and for a push recipe whose secret is a credential the admin pasted).
     Mutations that answer with a secret are deliberately not `Idempotency-Key` routes.
  6. For a lead-source connector the install asks the lead directory for a source of its own; a workspace at its `lead_sources` cap is told so and nothing is installed.
  7. One transaction writes the installation, its connection, the consent row, the audit row and the outbox event `marketplace.app.installed`.
- **Acceptance criteria:**
  - Given an app that asks for scope S, when an admin without the permission keys of S installs it, then the call is `403 MKT_SCOPE_EXCEEDS_INSTALLER`.
  - Given a consent list missing one scope, when installing, then the call is `422 MKT_CONSENT_REQUIRED` and nothing is written.
- **Port notes:** `InstallationsService`, `installations.repository.ts`, `marketplace-rules.ts` (`consentProblems`, `decideUpgrade`).

### TW-MKT-006 - Re-consent when a newer version asks for more

- **Status:** implemented
- **Summary:** A new version that asks for a scope the installation was not granted leaves the installation running on its old version with `needsReconsent: true` and `pendingVersion` set until an admin accepts.
- **Endpoints:** `POST /v2/marketplace/installations/:id/consent` `{ acceptedScopes }` (`market.apps.install`).
- **Rules & edge cases:**
  1. A version that asks for no more than was granted moves the installation at once, with the narrower grant.
  2. Consent, re-consent and uninstall are written to an append-only ledger (`marketplace_consents`: who, which version, which scopes, the data choice). The ledger outlives the installation.
  3. Events: `marketplace.app.scopes_changed`, `marketplace.app.upgraded`.

### TW-MKT-007 - Manage an installation: configure, pause, test, rotate, sample, events

- **Status:** implemented
- **Actors & access:** reading is `market.apps.read`; every change is `market.apps.manage` (uninstall and consent are `market.apps.install`).
- **Endpoints:**

| Method and path                                | What                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /installations?kind=&status=`             | what the workspace installed, plus `usage { installed, limit }`                                   |
| `GET /installations/:id`                       | the manage page of one installation                                                               |
| `GET /installations/:id/events?limit=&cursor=` | recent deliveries: delivery id, outcome, reason (never lead data)                                 |
| `PATCH /installations/:id`                     | `{ rowVersion, config?, credentials?, clearCredentials? }`; `409 ROW_VERSION_CONFLICT` when stale |
| `POST /installations/:id/disable` / `enable`   | pause and resume (`{ rowVersion }`); a paused connection answers deliveries `409`                 |
| `POST /installations/:id/test`                 | test the connection; the result also sets the installation health                                 |
| `POST /installations/:id/sync`                 | Sync now (pull connections), see TW-MKT-013                                                       |
| `POST /installations/:id/sample`               | send a recipe sample payload through the whole path as a real lead; honours an `Idempotency-Key`  |
| `POST /installations/:id/rotate-secret`        | `{ rowVersion }` -> `{ installation, inboundSecret }`; the old secret stops working at once       |

- **Rules & edge cases:**
  1. Credentials are sealed (one `CryptoService` envelope each) and write-only: the API returns `[{ key, label, kind, isSet, hint }]`, never the value. A hint is `ends in ####` for a secret and the value itself for a plain text field.
  2. A pause the admin made by hand is never undone by a payment or by the lapse sweep (TW-MKT-024).
  3. A killed installation can only be uninstalled; every other call is `409 MKT_INSTALLATION_KILLED`.
  4. Entering new credentials restarts a pull connection that stopped on a refused key.

### TW-MKT-008 - Installation health and delivery counters

- **Status:** implemented
- **Summary:** Health is `unknown`, `healthy`, `degraded`, `error` or `needs_reauth`; the connection keeps counters `received`, `accepted`, `duplicates`, `failed`, `lastEventAt`, `lastSuccessAt`, `lastError`.
- **Rules & edge cases:**
  1. A success makes the installation `healthy`; three failures in a row make it `degraded` with the reason. A test result sets `healthy` or `error`.
  2. A pull portal's refusal that retrying cannot fix stops the connection and sets `needs_reauth` or `error`. A connection that polls and receives (IndiaMART) and has stopped on a refused key stays stopped
     until the key is replaced: a lead arriving at its push address says nothing about the key.
  3. `marketplace_connection_events` holds one row per delivery id (the door's idempotency guard and the recent-events list); no lead data; trimmed after 30 days.
  4. Operators see healthy and degraded counts per app (TW-MKT-022).

### TW-MKT-009 - Uninstall with the keep-or-delete data choice

- **Status:** implemented
- **Endpoints:** `POST /v2/marketplace/installations/:id/uninstall` `{ dataChoice: 'keep' | 'delete' }` -> 204 (`market.apps.install`).
- **Rules & edge cases:**
  1. One transaction deletes the installation, its connection (the public address stops answering), its sealed secrets and its delivery log; the consent ledger keeps a row with the choice;
     the audit row and the outbox event `marketplace.app.uninstalled` carry the choice and `renewalStopped`.
  2. **The platform deletes no contact itself.** The domains that own what an app created act on the event. For a lead source, the source and its raw events are released at once; contacts stay either way until a
     data-deletion consumer exists.
  3. Uninstalling a paid app cancels its renewal too (the card renewal is ended at the provider first, TW-MKT-025); the uninstall dialog warns. Reinstalling inside the paid period costs nothing.

### TW-MKT-010 - Connector framework and registry

- **Status:** partial (two of the five mechanisms are frameworks only)
- **Summary:** An integration is one mechanism, run by a connector type through one port (`infra/providers/marketplace/connector.port.ts`, registry in `connector-registry.ts`).
  `implemented` is what gates publishing.

| Type            | Door                                                          | State                                                             |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `webhook_relay` | the sender posts with the generated secret                    | built and tested end to end (the seeded Webhook listing)          |
| `push`          | a portal posts or GETs the address                            | built and tested                                                  |
| `pull`          | the worker polls the portal's API                             | built and tested against fake portals                             |
| `client`        | software or a built-in screen the member connects from itself | built; installing records consent and issues and receives nothing |
| `oauth`         | the admin signs in, refresh token sealed                      | recipe schema and address checks only; **not publishable**        |
| `email_parse`   | alert emails parsed with a template                           | recipe schema only; **not publishable**                           |

- **Rules & edge cases:**
  1. A **recipe** holds the connector settings, `authFields` (`secret` fields are sealed and write-only), `mapping` (`auto` or `explicit` with `from` / `const`, transforms
     `trim|lower|upper|digits|phone|unescape`, `required`, `default`, attribution), `rateLimits`, `errorMapping`, `setupInstructions` and `testPayloads`.
  2. Paths are `a.b[0].c` (no expressions, never the prototype chain). Templates use `{{cred.<field>}}`, `{{config.<key>}}`, `{{cursor}}`, `{{since_iso}}`, `{{now_iso}}`, `{{now_epoch}}`, `{{window_start}}`, `{{window_end}}`.
  3. A recipe of an unimplemented type is validated and stored but cannot be published.
- **Port notes:** `framework.connectors.ts` (OAuth and email parse), `inbound.connectors.ts` (relay and push), `pull.connector.ts`, `recipe-mapper.ts`, `recipe-urls.ts`, `payload-formats.ts`, `xml.ts`.

### TW-MKT-011 - `webhook_relay` connector and the public delivery door

- **Status:** implemented
- **Endpoints:** `POST` or `GET /v2/public/marketplace/hooks/:publicKey` and `.../hooks/:publicKey/:token` (`@Public`; the connection secret is the credential).
- **Rules & edge cases:**
  1. Authentication is one of `token` (header `X-Marketplace-Token`), `hmac` (header `X-Marketplace-Signature: sha256=<hex HMAC-SHA256 of the raw body>`) or `path` (the secret is the last segment of the address). Comparison is constant time.
  2. The tenant is resolved by the SECURITY DEFINER function `marketplace_connection_lookup(public_key)`, which returns two ids and nothing else.
  3. Answers: `200 { status, received, accepted, duplicates, rejected }` with `status` `accepted`, `duplicate` or `queued`; `401 MKT_WEBHOOK_UNAUTHORIZED`; `404` unknown address; `405` / `415` / `422 MKT_WEBHOOK_BAD_PAYLOAD`;
     `409 MKT_INSTALLATION_DISABLED`; `410 MKT_INSTALLATION_KILLED`; `413` over 256 KB; `429 RATE_LIMITED`; `503 MKT_LEAD_PIPELINE_UNAVAILABLE`.
  4. Rate limits: 600 a minute per client address, the recipe's `rateLimits.perMinute` per connection (default 120), and a separate budget of 30 failed authentications a minute per connection.
  5. **Sync mode** (the generic webhook): a delivery is acknowledged only after it reached the lead pipeline, so a sender that retries on a non-2xx never loses a lead. A repeat of the same lead (the sender's own id, or a stable hash of the body) is `duplicate`.
     One delivery may carry up to 100 leads.
  6. The generic mapping reads the sender's id from the first of `id`, `lead_id`, `leadid`, `external_id`, `uuid`, `query_id`, `queryid`, `enquiry_id`, `reference`, `ref`, and finds name, phone, email, message, company and city by their usual names.
- **Acceptance criteria:**
  - Given a live connection, when a sender posts a lead with the right secret, then the lead is in the pipeline before the `200` and a second identical post is `duplicate`.
  - Given a killed app, when a sender posts, then the answer is `410` from the next request.
  - Given a wrong secret, then the answer is `401` and never says how close it was.

### TW-MKT-012 - `push` connector: portals that post or GET, stored first, worker-run

- **Status:** implemented (nothing has run against a real portal)
- **Summary:** For portals that turn their sender off after a day or two of errors, the door never makes the sender wait for the pipeline.
- **Rules & edge cases:**
  1. A recipe chooses `delivery.methods` (`POST` default, `GET`), `formats` (`json` default, `form`, `xml`, `query`) and `mode` (`sync` default or `async`).
  2. A sender with a wrong or missing `Content-Type` is read by the first character of its body; multipart is never read. An XML document that declares a `DOCTYPE` or an `ENTITY` is refused; depth and node count are capped.
  3. **Async mode:** throttle, tenant lookup, live checks, authentication, size, method and format, then the delivery is written to `marketplace_inbound_events` **before** the sender is answered (a failed write is a `503`) and a job is queued on `mkt-inbound`.
     A request carrying nothing at all on an async connection is answered `200` with zero counts and not stored.
  4. The worker claims the row, reads it again from the stored bytes, maps it with the recipe and hands each lead to the pipeline (idempotent on the connection's delivery ids and the pipeline's `(source, external id)`).
     Outcomes: `processed` (the raw body is dropped), `rejected` (unreadable, no lead, or its connection was paused or killed after it was stored; the body stays for support), or `failed` and retried from the stored copy after 30 seconds doubling to an hour, up to 12 tries.
  5. A sweep every 20 seconds queues what has no job; rows are trimmed after 30 days.
- **Async & events:** queue `mkt-inbound` (`QUEUES.MKT_INBOUND`); `InboundIntake`, `InboundRunService`, `InboundSweepService`, `InboundProcessor` in `MarketplaceWorkerModule`.

### TW-MKT-013 - `pull` connector, the pull engine, Sync now and backfill

- **Status:** implemented (tested against fakes that follow IndiaMART's and Housing.com's rules)
- **Rules & edge cases:**
  1. `PullSweepService` (worker, every 30 seconds) lists active pull connections that are due and queues one `mkt-pull` job per connection (job id = the connection). `PullRunService` makes one poll.
  2. The portal's minimum interval is kept against `last_poll_at`, written before the call. A poll that comes too soon is not made; the schedule moves.
  3. A high-water mark (`poll_cursor`) and an overlap: the next window starts `overlapSeconds` before the mark and ends now or one window's width on. The mark moves only after the leads are in.
  4. No double fetch: the portal's lead id (or a derived id) is the key on the delivery log and in the pipeline; `quietRepeats` stops a repeat from being counted again.
  5. A window with too many items (more than `maxItemsPerPoll`, or an answer over 1 MB) is asked again in halves, then grows back.
  6. Errors map to what happens next through `errorMapping` (status, range or text, and for a portal that keeps its status in the body the number there). A stated penalty is waited out (IndiaMART blocks a key for 15 minutes);
     an outage backs off (interval doubled per failure, at most six hours, `degraded`) and after eight in a row the connection stops. A redirect is never followed.
  7. Only the recipe's own host is called (values change the path and the query, never the host); https on a public host, checked on save and before each call; the answer is read up to 1 MB, 15 seconds at most.
  8. **Sync now** (`POST /installations/:id/sync`, `market.apps.manage`) brings the next poll forward, never faster than the portal allows -> `{ status: 'scheduled', runAt, minIntervalSeconds }`; `409 MKT_NO_CONNECTION`, `MKT_INSTALLATION_DISABLED`, `MKT_INSTALLATION_KILLED`.
  9. **Test connection** makes one real request over the last hour and so counts against the portal's limit.
  10. Backfill of a date range for a window-based recipe is `PullBackfillService`, reached from the lead inbox through `MarketplaceLeadPullProvider` (see `docs/api/leads.md`); a recipe that asks by cursor has no date to start from and cannot backfill.
- **Async & events:** queue `mkt-pull` (`QUEUES.MKT_PULL`, its own queue so a slow portal cannot hold a lead from another door).

### TW-MKT-014 - `client` connector

- **Status:** implemented
- **Summary:** For software the member installs elsewhere (the Chrome extension, the Google Sheets add-on) and for built-in screens (the first-party Email (Gmail) integration). Installing records consent and issues and receives nothing. Always publishable.
- **Port notes:** migrations `20261027090100_mkt_client_listings`, `20261119120000_mkt_email_integration`.

### TW-MKT-015 - `oauth` connector

- **Status:** partial: recipe schema and address checks exist; `implemented = false`, so it cannot be published. `OAuthConnector.test` answers "not available".
- **Port notes:** to be built with the first OAuth integration, on the pattern of the Google Calendar connection (signed state, sealed refresh token, `needs_reauth` when the grant is refused). The operator console credentials for platform OAuth apps (`clientSettingKey` on the connector) wait with it.

### TW-MKT-016 - `email_parse` connector

- **Status:** partial: the parser rules are validated and stored (`connector.rules`, at least one `required`); running them is not built; `implemented = false`.
- **Port notes:** the code comment says it waits for the Email channel; the Email channel (`channel-email`) is built now, but this connector was not wired to it (see Open questions).

### TW-MKT-017 - Lead pipeline gateway

- **Status:** implemented
- **Summary:** Every lead-source connector ends in the lead pipeline (`apps/api/src/modules/leads`) through its two leaf ports only (`lead-ingest.port.ts`, `lead-source-directory.port.ts`), looked up lazily by token so the Marketplace imports no lead domain class.
- **Rules & edge cases:** at install the connector asks the directory for a source of its own; each lead goes in through `ingest(orgId, sourceId, lead)`; uninstalling releases the source. `LeadPipelineGateway` is the adapter; `MarketplaceLeadPullProvider` (`lead-pull.provider.ts`) registers the pull connectors in the lead pull registry, so the lead inbox's Sync now and backfill cover them.

### TW-MKT-018 - Lead portal recipes shipped as data

- **Status:** implemented as data; **nothing has run against a real portal** (recipes follow the portals' documents and are tested against fakes).
- **Summary:** Migration `20261024090100_mkt_portal_recipes.sql` publishes them (idempotent, only an untouched draft is published).

| Listing       | Connector                    | Maturity             |
| ------------- | ---------------------------- | -------------------- |
| `indiamart`   | `pull` + `push` (path)       | `stable`             |
| `housing-com` | `pull`, signed               | `needs_portal_setup` |
| `tradeindia`  | `pull`                       | `beta`               |
| `justdial`    | `push` (path), GET or POST   | `needs_portal_setup` |
| `acres99`     | `push` (path), JSON/form/XML | `needs_portal_setup` |
| `magicbricks` | `push` (path)                | `needs_portal_setup` |
| `shiksha`     | `push` (path), POST          | `needs_portal_setup` |
| `sulekha`     | `push` (path)                | `needs_portal_setup` |

- **Rules & edge cases:** the generic Webhook listing is the ninth published lead source. Not built on purpose: Collegedunia, NoBroker, Quikr, CarDekho (no mechanism found), Naukri (candidate ATS, not leads), any recipe that would store a portal username and password (99acres pull), and email-alert parsing.
  What each portal still needs from a customer or the portal is in `docs/backlog.md` (BL-080 onward). Customer steps: `docs/runbooks/lead-portal-setup.md`.

### TW-MKT-019 - Requests and voting

- **Status:** implemented
- **Actors & access:** `market.apps.read` (also for asking and voting).
- **Endpoints:** `GET /v2/marketplace/requests?q=&kind=&status=&sort=votes|new`, `POST /requests` `{ name, kind?, categorySlug?, website?, note? }` -> 201 `{ request, created }`, `POST /requests/:id/vote`, `DELETE /requests/:id/vote` (idempotent).
- **Rules & edge cases:**
  1. A request is one row per normalised name and kind across the platform (`Just Dial`, `justdial` and `JustDial!` are one: NFKC, lower case, letters and digits only, 80 characters). Asking for what exists is a vote (`created: false`).
  2. A workspace counts once per request however often it asks or votes. A workspace sees names, status and vote counts only; the operator also sees the notes and the first workspace.
  3. Status: `open`, `planned`, `building`, `shipped`, `declined`; only the operator changes it (`PATCH /v2/platform/marketplace/requests/:id` with `status` and `operatorNote`).
- **Data:** `market_requests` (platform; `vote_count` by trigger), `market_request_votes` (tenant; one per `(org, request)`).

### TW-MKT-020 - Operator console: categories, listings, versions, review, publish

- **Status:** implemented
- **Actors & access:** `platform.market.manage` (create and edit listings and categories, submit versions, hide, kill, triage requests), `platform.market.review` (approve, reject, publish; a rejection reason is at least five characters), `platform.market.pricing` (TW-MKT-024). Either manage or review reads.
- **Endpoints:** `/v2/platform/marketplace`: `categories` (GET, POST, PATCH, DELETE), `apps` (GET, POST), `apps/:ref` (GET with `?versionId=`, PATCH, DELETE), `apps/:ref/versions` (POST), `versions/:versionId` (PUT), `.../submit`, `.../approve`, `.../reject`, `apps/:ref/publish`.
- **Rules & edge cases:** see TW-MKT-001. Edits use `rowVersion`. A category set `isActive:false` is hidden from workspaces.

### TW-MKT-021 - Hide, unhide, kill switch

- **Status:** implemented
- **Rules & edge cases:**
  1. Hide takes a published listing out of browse; installations keep working. Unhide reverses it.
  2. **Kill** `{ reason }` in one transaction: the listing becomes `killed`, every installation becomes `killed` with the reason, every connection becomes `disabled`, each workspace gets an audit row and the outbox event `marketplace.app.killed`, and the operator gets a
     `platform.market.app_killed` security event. The public address reads the status on every delivery, so it answers `410` from the next request.
  3. Every subscription of a killed app stops renewing (card renewals are ended at the provider; those that cannot be ended are listed as failed cancellations on the operator's Subscriptions screen).
  4. Unkill returns the listing to `hidden` so it can be fixed and published again; killed installations stay off.

### TW-MKT-022 - Operator insights: usage per app and the demand report

- **Status:** implemented
- **Endpoints:** `GET /v2/platform/marketplace/usage` (per app: installations by status and health, deliveries accepted, repeated, rejected and failed over 24 hours and 7 days), `GET /requests` (votes, notes, first workspace).
- **Port notes:** `OperatorInsightsService`.

### TW-MKT-023 - Plan gating, install limit, module lock and plan-gated visibility

- **Status:** implemented
- **Rules & edge cases:**
  1. Plan feature `marketplace` (default on) and limit `installed_apps` (`MarketplaceAccess` + `AddonEntitlementService`; billing add-ons that grant it stack).
  2. A listing's `planFeature`: a workspace whose plan (counting add-ons) lacks it sees the app `locked` (`MKT_APP_LOCKED`). A first-party mini app backed by an installable module (`manifest.module`) is locked while the module is off.
  3. **Plan-gated visibility** (our addition): table `plan_visible_addons` (migration `20261028090000`) and `PlanEntitlementService.forOrg().visibleApps` decide which paid apps a plan makes visible. Install, subscribe (`404` on `not_visible`) and checkout (`PAYGW_PLAN_NOT_PURCHASABLE`) refuse a hidden app; use still needs the `mkt_` entitlement.
  4. Workspace permission keys: `market.apps.read`, `.install`, `.manage` (Owner and Admin by default, migration `20261021090200`). Operator keys: `platform.market.manage`, `.review`, `.pricing` (Super Admin and Admin).

### TW-MKT-024 - Paid apps: operator pricing, subscribe, trial, cancel, resume, lapse

- **Status:** implemented (tested against faked Stripe and Razorpay; never a real gateway)
- **Summary:** No second billing system. An app is sold as a billing add-on (a `plans` row of kind `addon`, `marketplace_app_id` set, one feature key `mkt_<slug>`) through the existing checkout, gateways, orders, coupons, tax and `workspace_addons`. `marketplace_subscriptions` is a ledger that **follows** the entitlement; it never grants it.
- **Endpoints:** operator `PUT /apps/:ref/pricing` (`platform.market.pricing`), `GET /subscriptions`, `GET /subscriptions/summary` (MRR per currency), `POST /apps/:ref/subscriptions/comp`, `.../grandfather`, `POST /subscriptions/:id/cancel`;
  workspace `POST /apps/:ref/subscribe` `{ startTrial? }`, `POST /apps/:ref/subscription/cancel`, `.../resume`, `GET /subscriptions`.
- **Rules & edge cases:**
  1. Pricing: `model` `free` or `paid_monthly`, an amount above zero (at most two places), a currency enabled on the platform, `trialDays` 0 to 90, optional yearly price, `purchasable` (false stops new subscriptions only), `billingMode` `one_time` (default) or `recurring`, and who gets it free (`includedPlanFeature`, `includedMinPlan`). Each change writes the security event `platform.market.pricing_set`.
  2. A card shows `pricing.access`: `free`, `included`, `entitled`, `subscription_required`, `not_for_sale`.
  3. Subscribe answers `trial_started`, `checkout`, `included`, `already_entitled` or `free`; `422 MKT_TRIAL_UNAVAILABLE`, `409 MKT_NOT_FOR_SALE`. A workspace on a free plan may subscribe.
  4. A prepaid listing is a monthly term renewed by paying again; a payment extends the term already paid for (counted from its end). Checkout refuses a payment while more than 45 days are already paid for, and for an app the plan includes.
  5. Cancel sets `cancel_at_period_end`; access runs to the end of the period; not for a comp. Resume is possible while the period runs.
  6. Lapse: the worker sweep (every minute, idempotent) lapses an active subscription with no entitlement in force and pauses the installation (`paused_by_subscription`, data kept). It does not pause when the app is free now, the plan includes it or an override grants the feature. Access never waits for the sweep.
  7. One trial per workspace and app (a SECURITY DEFINER function grants a time-limited purchase row); paying during a trial starts the paid month at once.
  8. Comp: 1 to 36 months or until revoked, refused for a free app, an unknown workspace and a workspace that pays with a period still running; a workspace cannot cancel a comp. Price changes apply to new subscriptions and the next payment, never to a period already paid for.
  9. The purchase hook (`AddonFulfilmentHooks`) writes the subscription in the order's own transaction, so order, entitlement and subscription commit together.
- **Data:** pricing columns on `marketplace_apps`, `plans.marketplace_app_id`, `workspace_app_installations.paused_by_subscription`, tenant table `marketplace_subscriptions` (one row per `(org, app)`; a workspace reads, only the privileged path writes). Migration `20261023090000_mkt_pricing`.
- **Async & events:** `marketplace.subscription.started`, `.renewed`, `.resubscribed`, `.comped`, `.canceled`, `.resumed`, `.lapsed`, `.payment_failed`, `.renewal_due`, `.price_unlocked`, `.refunded`.

### TW-MKT-025 - Card renewal of an app (BL-070)

- **Status:** implemented; tested only against a faked Razorpay (PR 525)
- **Rules & edge cases:**
  1. A `recurring` listing is an autopay add-on: checkout needs a gateway that supports subscriptions (Razorpay today) and the provider charges every month. The renewal extends the add-on's `workspace_addons.ends_at`.
  2. Provider events update the ledger in one transaction: first charge (autorenew on), renewal (period end, `renewals` + 1), failed renewal (`past_due`, grace until period end plus `billing.grace_days`, the app keeps working), ended (not renewing), replaced (nothing; the old provider subscription is ended so a workspace is never charged twice).
  3. **Cancel ends the provider subscription first**, with no transaction open; when the provider cannot confirm the call is `502 MKT_RENEWAL_NOT_STOPPED` and nothing changes. A cancellation of a card-renewed app cannot be taken back (`409 MKT_SUBSCRIPTION_STATE`).
  4. The page says "Renews on" only where `autoRenew` is true; "Paid until" otherwise; "Payment failed" with the date the app stops while a renewal is retried.

### TW-MKT-026 - Annual billing, price lock, coupons for one app

- **Status:** implemented; tested only against a faked Razorpay (PR 525)
- **Rules & edge cases:**
  1. Annual billing (BL-072): the listing's yearly price is copied to the add-on (`plans.annual_amount`); `Subscribe` takes `period`; the term and the provider cadence run one year; the ledger keeps `billing_period`; monthly revenue counts a twelfth.
  2. Price lock (BL-071): `marketplace_apps.price_lock` locks each subscriber at their first payment; a lapse ends the lock; turning the lock on locks today's subscribers, turning it off unlocks nobody; the operator releases one subscriber (`POST /subscriptions/:id/unlock-price`).
  3. Coupons (BL-078): a coupon naming the app's add-on discounts that app only (verified by e2e, no new code). **Tax category per app is not built** (checkout has one platform-wide rate, BL-239).

### TW-MKT-027 - Renewal reminders, failed-payment and ended notices (BL-076)

- **Status:** implemented; tested only against a faked Razorpay (PR 525)
- **Rules & edge cases:** `marketplace.subscription.renewal_due` is sent once per period (setting `marketplace.renewal_reminder_days`, default 7); failed-renewal and lapse notices; three notification types (in-app, push for a failed payment) and one email each through the worker's outbox consumer (`MarketSubscriptionNotificationsConsumer`). Emails are English only (BL-241). Checkout and the payment return land on the app page with the outcome.

### TW-MKT-028 - Refunds of unused time and of a withdrawn app (BL-077)

- **Status:** implemented; tested only against a faked Razorpay (PR 525)
- **Endpoints:** `POST /v2/platform/marketplace/subscriptions/:id/prorate` (`{ reason, dryRun, endNow }`) and `POST /apps/:ref/refund-unused` (`{ reason, dryRun, after }`); `platform.market.pricing` and super admin only, never twice.
- **Rules & edge cases:** the unused share of the last payment goes back through the existing refund service (`order_refunds`) and the provider's refund call; a dry run comes first; events `platform.market.subscription_refunded`, `platform.market.withdrawn_app_refunded`. **No credit-note document** is produced (BL-240).

### TW-MKT-029 - First-party listings, apps that own plan features, install-gated access

- **Status:** implemented
- **Summary:** Features of the product are sold or described as listings: Appointments, Forms, Email (Gmail), the Chrome extension, the Google Sheets add-on, the generic Webhook, the lead portals, AI lead scoring, six optional tools (AI CRM Copilot, chat widget, help assistant, WhatsApp catalog, WhatsApp groups, SMS) and information listings (connected devices, Meta lead forms).
- **Rules & edge cases:**
  1. A listing's `grantsPlanFeatures` are merged into the workspace entitlements only while the installation is `active` (`plans-subscriptions-trials/app-grants.ts`, migration `20261113090000`).
  2. `grandfatherExisting` comps the workspaces that already have the feature, so no existing workspace loses a feature when it becomes an app (dry run first). AI lead scoring is grandfathered inside its migration.
  3. A menu entry or Settings tile that belongs to an app declares `gates.app`; while the workspace lacks the feature the entry is **removed** and its routes are closed in the shell (`AppGate`), with a Marketplace link only for someone holding `market.apps.read`. The API still refuses on its own (`PLAN_FEATURE_LOCKED`).
  4. Listings for features that are not built are draft placeholders that cannot be published (see TW-MKT-032).
- **Port notes:** the survey and the decision per feature are in `docs/threadwise-port/wiring/marketplace.md` ("Listings audit"); migrations `20261228090000`, `..090100`, `..090200`.

### TW-MKT-030 - Web: workspace screens

- **Status:** implemented
- **Screens (`apps/web/src/app/(app)/(marketplace)`):** `/marketplace` (home with shelves), `/marketplace/apps`, `/marketplace/integrations`, `/marketplace/addons` (billing add-ons tab), `/marketplace/app/[slug]` (app page), `/marketplace/app/[slug]/install` (consent and setup),
  `/marketplace/installed`, `/marketplace/installed/[id]` (manage), `/marketplace/requests`. `/integrations` redirects to `/marketplace/integrations`.
- **UX notes:** price on cards and the app page, Subscribe and Start free trial, the subscription panel, the "Subscription ended" banner, the payment return banner, the uninstall warning, one-time reveal of the connection secret and of the full path address, Open link to the app's own screen, a maturity badge and notice, a help guide (`marketplace-overview`).
  The nav entry is in the `apps` group, gated by `market.apps.read` and plan feature `marketplace`; a plan without the feature keeps the entry visible but locked, with a paywall over every `/marketplace/*` page.
- **Port notes:** messages `apps/web/messages/*/marketplace.json`, `marketplace.operator.json`; render and unit tests live beside the components.

### TW-MKT-031 - Web: operator console screens

- **Status:** implemented
- **Screens (`apps/web/src/app/(admin)/(marketplace)/admin/marketplace`):** the catalogue (`page.tsx`, with a pricing column and filter), `/new`, `/[ref]` (listing page: edit, versions panel with the editor and submit, approve, reject dialogs, pricing panel, app actions), `/categories`, `/requests`, `/usage`, `/subscriptions` (with comp, cancel, grandfather, prorate and refund dialogs).

### TW-MKT-032 - Not built

- **Status:** not-built (recorded so nobody assumes it exists)
- **What is not built:**
  1. **Third-party (out-of-process) mini apps**: developer accounts, OAuth for apps, app tokens, iframe surfaces, automation triggers and actions as extension points, a developer portal and a review workflow beyond the operator's approve and reject (spec phase 3). Manifest `surfaces` are stored and not rendered; `scopeCovers` is not enforced anywhere.
  2. **First-party mini app screens of spec phase 2** (quote panel, birthday greeting). AI lead scoring shipped as an app; the others did not.
  3. **Connectors:** `oauth` and `email_parse` (TW-MKT-015, TW-MKT-016); operator console credentials for platform OAuth apps; a replay tool for stored deliveries and a silent-push alert (BL-090, BL-087).
  4. **Money:** paying an app from the wallet (BL-073), revenue share and payouts to third-party developers (BL-074), usage-based and per-seat pricing (BL-075), tax category per app (BL-239), credit-note documents (BL-240). BL-073, BL-074 and BL-075 each have a decision note in `docs/api/marketplace.md` ("Decisions waiting for the owner") and need owner and finance or legal decisions before any build.
  5. **Ratings and reviews**, health dashboard for developers (spec phase 4).
  6. **Real-world verification:** no connector, portal, gateway or notification path has been run against the real provider; everything is tested against stand-ins (BL-080 onward for portals, BL-205 for Meta).
  7. **Draft placeholders that cannot be published** (BL-259 to BL-268): lead finder, AI call assistant, OpenAI Ads (no definition exists), Meta Ads (Click-to-WhatsApp), TikTok, HubSpot, Slack, Trello, LinkedIn lead gen, Google Ads leads.
  8. Portals with no mechanism found or not leads: Collegedunia, NoBroker, Quikr, CarDekho, Naukri; email-alert parsing for JustDial, Shiksha and Sulekha.
  9. The Settings hub tiles `integrations`, `rest-api` and `webhooks` becoming entries inside the Marketplace (only `/integrations` redirects today).

## Data model

Platform-owned (no `org_id`, forced RLS, privileged writes; a workspace reads published listings and what it has installed):

| Table                      | Notes                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `marketplace_categories`   | `(kind, slug)` unique; `is_active`; tenants read the active ones                                                           |
| `marketplace_apps`         | the listing; `current_version_id`; pricing columns; `price_lock`; `install_count` by trigger (does not move `row_version`) |
| `marketplace_app_versions` | manifest and recipe jsonb, `scopes text[]`, review state                                                                   |
| `market_requests`          | one per `(kind, normalised name)`; `vote_count` by trigger; a workspace inserts as itself, only the operator changes it    |

Tenant tables (forced RLS, composite keys):

| Table                           | Notes                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace_app_installations`   | granted scopes, config, sealed credentials, hints, health, `pending_version_id`, `paused_by_subscription`; one per `(org, app)`                  |
| `marketplace_consents`          | append-only ledger (install, reconsent, uninstall with the data choice); outlives the installation                                               |
| `marketplace_connections`       | public key, sealed secret, poll schedule and cursor (`last_poll_at`, `poll_window_seconds`, `last_poll_leads`), lead source id (no FK), counters |
| `marketplace_connection_events` | one row per delivery id; no lead data; trimmed after 30 days                                                                                     |
| `marketplace_inbound_events`    | stored deliveries of an async connection; status `received`, `processing`, `processed`, `rejected`, `failed`; raw body only until processed      |
| `market_request_votes`          | one per `(org, request)`                                                                                                                         |
| `marketplace_subscriptions`     | one per `(org, app)`; a workspace reads, only the privileged path writes                                                                         |

Also: `plans.marketplace_app_id`, `plans.billing_mode`, `plans.annual_amount`, `plan_visible_addons`. SECURITY DEFINER functions: `marketplace_connection_lookup(public_key)`, `marketplace_bump_install_count()`, `market_requests_bump_votes()`,
`marketplace_start_trial(app)`, `marketplace_subscription_set_cancel(app, cancel)`. Drizzle mirror: `packages/db/src/schema/marketplace/tables.ts`. Migrations: the `*_mkt_*` files in `packages/db/migrations` (22 at the time of writing, `20261021090000_mkt_catalogue` to `20261228090200_mkt_info_and_planned_listings`).

Enums (`packages/contracts/src/marketplace/enums.ts`): app status `draft | in_review | published | hidden | killed`; version status `draft | in_review | approved | rejected | published | retired`; installation status `active | disabled | killed`; health
`unknown | healthy | degraded | error | needs_reauth`; connector type `oauth | push | pull | email_parse | webhook_relay | client`; connection status `active | paused | error | disabled`; data choice `keep | delete`; request status `open | planned | building | shipped | declined`.

Error codes (`MKT_*` in contracts `errors.ts`): `MKT_APP_NOT_FOUND`, `MKT_NOT_INSTALLED`, `MKT_ALREADY_INSTALLED`, `MKT_APP_UNAVAILABLE`, `MKT_APP_LOCKED`, `MKT_CONSENT_REQUIRED`, `MKT_SCOPE_EXCEEDS_INSTALLER`, `MKT_INSTALLATION_KILLED`, `MKT_INSTALLATION_DISABLED`,
`MKT_CREDENTIAL_MISSING`, `MKT_NO_CONNECTION`, `MKT_WEBHOOK_UNAUTHORIZED`, `MKT_WEBHOOK_BAD_PAYLOAD`, `MKT_LEAD_PIPELINE_UNAVAILABLE`, `MKT_MANIFEST_INVALID`, `MKT_RECIPE_INVALID`, `MKT_URL_REFUSED`, `MKT_CONNECTOR_NOT_AVAILABLE`, `MKT_SLUG_TAKEN`,
`MKT_CATEGORY_NOT_FOUND`, `MKT_CATEGORY_IN_USE`, `MKT_VERSION_STATE`, `MKT_VERSION_EXISTS`, `MKT_SUBSCRIPTION_REQUIRED`, `MKT_NOT_FOR_SALE`, `MKT_TRIAL_UNAVAILABLE`, `MKT_SUBSCRIPTION_NOT_FOUND`, `MKT_SUBSCRIPTION_STATE`, `MKT_RENEWAL_NOT_STOPPED`.

## Cross-domain contracts

- **Consumes** `lead-sources` / the lead pipeline (`modules/leads`): `LEAD_INGEST` and `LEAD_SOURCE_DIRECTORY` ports; exposes `LeadPipelineGateway` and `MetaLeadPullProvider` to it.
- **Consumes** `addons-extension-registry`: `ModuleRegistryService.isEnabled`, `AddonEntitlementService.featureEnabled` and `.limit`, `AddonFulfilmentService` and its hooks (`AddonFulfilmentHooks`, `termBase`); the Marketplace add-ons are filtered out of `AddonPackService` and `WorkspaceAddonsService`.
- **Consumes** `platform-payment-gateways`: checkout (`CheckoutService.assertPurchasable` calls `marketplace-pack.ts`), orders, coupons, tax, `RefundService`, the recurring add-on machinery. **Exposes** the app add-on rules to it.
- **Consumes** `plans-subscriptions-trials`: plan features and limits (`marketplace`, `installed_apps`), `PlanEntitlementService.forOrg` (merges the add-ons and the installed apps' grants), `plan_visible_addons`.
- **Consumes** `roles-permissions`: the permission keys named by scopes; exposes `market.apps.*` and the operator keys `platform.market.*` (`PLATFORM_PERMISSION_KEYS`).
- **Exposes** outbox events `marketplace.app.*` and `marketplace.subscription.*` (consumed by notifications, and by the domains that own what an app created, on uninstall).
- **Exposes** to the web shell: `GET /v2/billing/entitlements` (merged with app grants), `gates.app` on nav and Settings entries.
- **Consumes** `notifications-activity-audit`: audit rows (`module` `marketplace` / `marketplace_subscriptions`), three notification types, the platform security events.
- **Queues:** `mkt-pull`, `mkt-inbound`; worker module `MarketplaceWorkerModule` (imported by `WorkersModule` only).

## Open questions & quirks

1. **Documentation drift found while writing this entry** (the code is the source of truth here):
   - `docs/threadwise-port/wiring/marketplace.md` row WIRE-MKT-007 and the intro still say the web UI is not built; the screens exist (TW-MKT-030, TW-MKT-031).
   - `docs/api/marketplace.md` shows a scope table of 14 scopes; `MARKET_SCOPES` has 20 (it adds `catalog.*`, `forms.*`, `email.*`).
   - EXT-MKT-006 in the wiring doc marks the portal recipes as blocked; the portals are published as data (TW-MKT-018).
   - `framework.connectors.ts` says `email_parse` waits for an Email channel that "does not exist"; the Email channel is built, the connector is not wired to it.
2. **Nothing has run against a real counterpart.** Portals, Meta, Razorpay and the notification emails are tested against stand-ins. Treat every "implemented" above as "built and tested locally".
3. **The manifest's `pricing` is a proposal only**; an operator sets the real price. A developer-facing explanation does not exist yet because there is no developer portal.
4. **`scopeCovers` has no caller.** Scopes are enforced at install time (the installer must hold the keys) but there is no app actor whose requests they would bound.
5. **Uninstall does not delete contacts.** Whatever an app created stays until a data-deletion consumer exists (the choice is recorded).
6. **A `recurring` listing and a `one_time` listing behave differently at cancel:** a card-renewed cancellation cannot be taken back; a prepaid one can while the period runs.
7. Open owner decisions: BL-073 (wallet payment), BL-074 (revenue share and payouts), BL-075 (usage and per-seat pricing), BL-026 (whether the ZIP installer stays enabled on the multi-tenant SaaS), BL-269 (whether core channels get a gate).
8. This entry is new: it was written from the code and the docs above after the fact, so a feature may be missing; the per-feature acceptance criteria are the ones the e2e specs under `apps/api/test/e2e/marketplace` and the unit specs under `apps/api/test/unit/marketplace` exercise.

## Coverage

There is no Reference source for this domain, so every list is empty.

```json threadwise-coverage
{
  "routes": [],
  "controllers": [],
  "services": [],
  "models": [],
  "tables": [],
  "views": [],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": [],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [],
  "feature_map": {}
}
```
