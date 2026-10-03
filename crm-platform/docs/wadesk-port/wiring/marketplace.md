# Wiring map: marketplace (MKT)

An owner-requested extension, not a WaDesk port: WaDesk only has the code-extension loader and billing add-ons (`addons-extension-registry`,
ADD), which load uploaded code into the one running process and have no catalogue, no per-workspace install and no scopes. The spec is
[marketplace-mini-apps-and-integrations.md](../../specs/marketplace-mini-apps-and-integrations.md); there is no WaDesk inventory page, so this file is
the inventory and the wiring map in one. API and rules: [docs/api/marketplace.md](../../api/marketplace.md); runbook:
[marketplace-publish-listing.md](../../runbooks/marketplace-publish-listing.md). Deviations from the reference:
[product-extensions.md](../parity/product-extensions.md), item 20. What this change builds is **spec phase 0 and the backend of phase 1**
(M-01, M-03, M-04, M-05, M-08 backend, M-09, M-10, M-16 backend); there is no web UI yet (a UI agent follows).

## Route, permission, plan

| Id           | What                  | Where                                                                                                                                                                                                                                    |
| ------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-MKT-001 | Workspace API         | `/v2/marketplace` (categories, shelves, apps, install, installations and their actions, requests) in `marketplace.controller.ts`                                                                                                         |
| WIRE-MKT-002 | Operator API          | `/v2/platform/marketplace` (categories, requests, usage, apps, versions, review, publish, hide, kill) in `platform-marketplace.controller.ts`                                                                                            |
| WIRE-MKT-003 | Public delivery door  | `POST /v2/public/marketplace/hooks/:publicKey` in `hook.controller.ts` (`@Public`; the connection secret is the credential); `RelayService`                                                                                              |
| WIRE-MKT-004 | Workspace permissions | `market.apps.read`, `.install`, `.manage` (migration `20261021090200_mkt_permissions.sql`); Admin presets by baseline and by the trigger on `permission_defs`                                                                            |
| WIRE-MKT-005 | Operator permissions  | `platform.market.manage`, `platform.market.review`: `PLATFORM_PERMISSION_KEYS` in contracts, `platform_permissions` rows granted to Super Admin and Admin, `rbac.version` bumped                                                         |
| WIRE-MKT-006 | Plan                  | feature `marketplace` (`@RequirePlanFeature` on the workspace controller; default on), limit `installed_apps` (`MarketplaceAccess` + `AddonEntitlementService`, billing add-ons count)                                                   |
| WIRE-MKT-007 | Web                   | not built: a Marketplace entry in the top bar and Settings > Integrations, `/marketplace` with two tabs, app page, consent sheet, manage page, request box (spec 6.1); operator console pages for catalogue, categories, requests, usage |

## Tables

| Table                           | Owner of the row | Notes                                                                                                                                          |
| ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace_categories`        | platform         | `(kind, slug)` unique; tenants read the active ones                                                                                            |
| `marketplace_apps`              | platform         | listing; `current_version_id` is what a new install gets; `install_count` kept by a trigger (does not move `row_version`)                      |
| `marketplace_app_versions`      | platform         | manifest and recipe jsonb, `scopes text[]`, review state                                                                                       |
| `workspace_app_installations`   | tenant           | granted scopes, config, sealed credentials, hints, health, `pending_version_id` for re-consent; one per `(org, app)`                           |
| `marketplace_consents`          | tenant           | append-only ledger (install, reconsent, uninstall with the data choice); outlives the installation                                             |
| `marketplace_connections`       | tenant           | public key, sealed secret, poll schedule and cursor, lead source id (no foreign key: the pipeline's tables are another domain's), counters     |
| `marketplace_connection_events` | tenant           | one row per delivery id: the door's idempotency guard and the recent-events list; no lead data; trimmed after 30 days                          |
| `market_requests`               | platform         | one per `(kind, normalised name)`; readable by all, insertable by a workspace as itself, changed only by the operator; `vote_count` by trigger |
| `market_request_votes`          | tenant           | one per `(org, request)`                                                                                                                       |

Drizzle mirror: `packages/db/src/schema/marketplace/tables.ts`. Platform tables follow `whatsapp_providers` (forced RLS, privileged writes) with a
tenant `SELECT` policy for what is published or installed. SECURITY DEFINER functions: `marketplace_connection_lookup(public_key)` (two ids, called
by the public door only), `marketplace_bump_install_count()` and `market_requests_bump_votes()` (triggers; a workspace cannot update the platform
row). Referenced tenant tables: `users` (composite keys on `installed_by` and `consented_by`, set null on delete).

## Reuse of ADD (`addons-extension-registry`)

| Piece                            | How it is used                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest idea (`extension.json`) | the app manifest is the same idea (one declarative file), per workspace, permissioned; `module` names the registry slug for a first-party mini app |
| `ModuleRegistryService`          | `isEnabled(manifest.module)`: a first-party mini app is locked while its module is off                                                             |
| `AddonEntitlementService`        | `featureEnabled(org, listing.planFeature)` and `limit(org, 'installed_apps')`: a paid billing add-on that grants the feature unlocks the app       |
| ZIP installer                    | untouched, operator-only; it is not a way to publish a listing and nothing a listing holds is unpacked or executed                                 |

## Feeders and consumers

| Id          | Feature                                                                                         | Feeds it                     | Consumers                                                                                                          | Where                                                              | State                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EXT-MKT-001 | Catalogue and categories                                                                        | operator API, seed migration | workspace browse, search, shelves                                                                                  | `BrowseService`, `OperatorCatalogueService`                        | built; web not built                                                                                                                                   |
| EXT-MKT-002 | Manifest v1 and scopes                                                                          | operator API                 | consent, install permission check, `scopeCovers` for future app tokens                                             | contracts `marketplace/manifest.ts`, `scopes.ts`                   | built; enforcement for app tokens is phase 3                                                                                                           |
| EXT-MKT-003 | Install, consent, re-consent, uninstall                                                         | workspace API                | audit, outbox `marketplace.app.*`, lead source directory, consent ledger                                           | `InstallationsService`                                             | built                                                                                                                                                  |
| EXT-MKT-004 | Connector framework                                                                             | recipes in versions          | the five connector types, the registry, the delivery door, the pull worker                                         | `infra/providers/marketplace`, `DeliveryService`, `PullRunService` | built: `webhook_relay`, `push`; framework only: `pull`, `oauth`, `email_parse`                                                                         |
| EXT-MKT-005 | Generic Webhook lead source                                                                     | seeded published listing     | the lead pipeline through `LEAD_INGEST` and `LEAD_SOURCE_DIRECTORY` (leaf ports of `modules/leads`)                | `LeadPipelineGateway`                                              | built and tested with a stubbed pipeline; the real pipeline is the leads domain's                                                                      |
| EXT-MKT-006 | Planned lead portals                                                                            | seed (draft listings)        | the operator's build order                                                                                         | seed migration `..090300`                                          | **blocked**: IndiaMART, JustDial, 99acres, MagicBricks, Housing.com, Shiksha need their real mechanism verified before a recipe (spec open question 3) |
| EXT-MKT-007 | Kill switch                                                                                     | operator API                 | every installation of the app, its connections, audit and outbox per workspace                                     | `OperatorCatalogueStore.killInstallations`                         | built                                                                                                                                                  |
| EXT-MKT-008 | Requests and votes                                                                              | workspace API                | the operator's demand report                                                                                       | `RequestsService`, `OperatorInsightsService`                       | built                                                                                                                                                  |
| EXT-MKT-009 | Usage per app                                                                                   | installations, delivery rows | operator console                                                                                                   | `OperatorInsightsService.usage`                                    | built                                                                                                                                                  |
| EXT-MKT-010 | First-party mini apps (M-07)                                                                    | none yet                     | the same install flow                                                                                              | n/a                                                                | **blocked**: spec phase 2 (quote panel, lead scoring, birthday greeter)                                                                                |
| EXT-MKT-011 | Third-party mini apps (M-12 to M-14)                                                            | none                         | iframe surfaces, app tokens, automation extension points, review workflow beyond the operator's approve and reject | n/a                                                                | **blocked**: spec phase 3 (needs the flow runtime's node registry and public API OAuth)                                                                |
| EXT-MKT-012 | OAuth and email-parse connectors                                                                | none                         | Google, Microsoft, Slack, HubSpot; portal alert emails                                                             | recipe schema and registry slots exist                             | **blocked**: first OAuth integration; the Email channel spec                                                                                           |
| EXT-MKT-013 | Operator console credentials for platform OAuth apps (M-08)                                     | none                         | per-provider client id and sealed secret, as the Google Calendar and WhatsApp settings do                          | `OAuthConnector` carries `clientSettingKey`                        | **blocked** with EXT-MKT-012                                                                                                                           |
| EXT-MKT-014 | Settings hub tiles `integrations`, `rest-api`, `webhooks` become entries inside the Marketplace | none                         | the web shell                                                                                                      | n/a                                                                | **blocked**: web                                                                                                                                       |

## Worker

Queue `mkt-pull` (`QUEUES.MKT_PULL`, own queue so a slow portal cannot hold a lead from another door). `PullSweepService` (every 30 seconds,
privileged) lists active pull connections that are due and queues one job per connection (job id = the connection); `PullProcessor` runs
`PullRunService`, which moves the cursor only after the leads are in. An hourly trim deletes delivery rows older than 30 days. Registered in
`MarketplaceWorkerModule`, imported by `WorkersModule` only.

## Seams touched in shared files (additive)

`app.module.ts` (`MarketplaceModule`), `workers/workers.module.ts` (`MarketplaceWorkerModule`), `infra/queue/queues.ts` (`MKT_PULL`),
`@crm/contracts` `index.ts` and `common/errors.ts` (`MKT_ERROR_CODES`), `roles-permissions/platform-roles.ts` (two platform keys),
`plans-subscriptions-trials/catalogue.ts` (feature `marketplace`, limit `installed_apps`, its label and chip order),
`test/unit/plans-subscriptions-trials/entitlements.spec.ts` and the web plan editor's test fixture and message labels (the new keys),
`packages/db/src/schema/index.ts`, `ownership.json` and `assignment-input.json` (domain `marketplace`, code `mkt`).
