# Marketplace API

The Marketplace is where a workspace admin browses, installs, configures and removes **mini apps** (extend the product) and
**integrations** (connect an outside service), and where the platform operator runs the catalogue. This is an owner-requested extension
(`docs/wadesk-port/parity/product-extensions.md`, item 20); WaDesk only has the code-extension loader (`addons-extension-registry`), which
loads uploaded code into the one running process and cannot be offered to tenants of a multi-tenant SaaS. Here an app is **data**: a
listing, versions with a declarative manifest, and for an integration a connector **recipe**. Nothing a listing contains runs in the API
process. Spec: [marketplace-mini-apps-and-integrations.md](../specs/marketplace-mini-apps-and-integrations.md). How to publish a listing and
write a recipe: [../runbooks/marketplace-publish-listing.md](../runbooks/marketplace-publish-listing.md). Wiring:
[../wadesk-port/wiring/marketplace.md](../wadesk-port/wiring/marketplace.md).

Errors are problem+json (`{ type, title, status, detail, code, requestId, errors? }`); branch on `code`, never on `detail`. `errors` carries
`{ path, message }` pairs. Every id on the wire is a uuid; an app may also be addressed by its **slug** (`webhook`). Schemas:
`packages/contracts/src/marketplace/` (zod first, types inferred). Mutations that answer with a secret are deliberately not
`Idempotency-Key` routes (the answer would be stored).

## Three surfaces

| Surface   | Base                                           | Auth                                                                 | Gate                                                                     |
| --------- | ---------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Workspace | `/v2/marketplace`                              | workspace user bearer JWT                                            | plan feature `marketplace`, permissions `market.apps.*`                  |
| Operator  | `/v2/platform/marketplace`                     | platform operator bearer JWT (MFA enrolled, as every operator route) | `platform.market.manage` and `platform.market.review` (either one reads) |
| Public    | `POST /v2/public/marketplace/hooks/:publicKey` | none: the connection secret authenticates the delivery               | rate limits; the connection must be live                                 |

### Permission keys

| Key                      | Surface   | Grants                                                                                                | Held by default                     |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `market.apps.read`       | workspace | browse, search, app pages, installed list and events, ask for an integration, vote                    | Owner, Admin (migration `..090200`) |
| `market.apps.install`    | workspace | install (with consent), accept a new version's permissions, uninstall                                 | Owner, Admin                        |
| `market.apps.manage`     | workspace | configure, pause and resume, test the connection, send a sample lead, rotate the connection secret    | Owner, Admin                        |
| `platform.market.manage` | operator  | create and edit listings and categories, submit versions, hide, unhide, kill, unkill, triage requests | Super Admin, Admin                  |
| `platform.market.review` | operator  | approve and reject versions, **publish**                                                              | Super Admin, Admin                  |

Installing is never a way to gain a capability: the person must hold **every permission key the requested scopes stand for** (see Scopes),
or the call is `403 MKT_SCOPE_EXCEEDS_INSTALLER` listing the missing keys in `errors`.

### Plan

Feature `marketplace` (default on: no plan row held it before) gates every workspace route, reads included (`422 PLAN_FEATURE_LOCKED`,
`errors` carries `feature` and `upgradeUrl`). Limit `installed_apps` caps how many apps a workspace has installed at once (0 = unlimited;
an uninstall frees a place; billing add-ons that grant it stack, through `AddonEntitlementService`). A listing may also name a **plan
feature** (`planFeature`, set by the operator): a workspace whose plan (counting its billing add-ons) lacks it sees the app `locked` and gets
`422 MKT_APP_LOCKED`. A first-party mini app backed by an installable module (`manifest.module`) is locked while the module is off.

## Workspace API

Literal paths come before `:id` routes. Lists are keyset-paged (`{ data, page: { nextCursor, hasMore, limit } }`; a malformed `cursor` is
`422 VALIDATION_FAILED`).

| Method and path                                  | Permission            | What                                                                                                                                                          |
| ------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /categories?kind=`                          | `market.apps.read`    | categories of a tab with the number of published apps in each                                                                                                 |
| `GET /shelves?kind=`                             | `market.apps.read`    | `{ popular, new, featured }`, eight cards each                                                                                                                |
| `GET /apps`                                      | `market.apps.read`    | browse and search; query `kind`, `category` (slug), `q`, `installed=true\|false`, `sort=featured\|popular\|new\|name`, `limit` (1..100, default 24), `cursor` |
| `GET /apps/:ref`                                 | `market.apps.read`    | the app page (`ref` = uuid or slug)                                                                                                                           |
| `POST /apps/:ref/install`                        | `market.apps.install` | install after consent: `{ acceptedScopes, credentials?, config? }` -> 201 `{ installation, inboundSecret }`                                                   |
| `GET /installations?kind=&status=`               | `market.apps.read`    | what the workspace has installed, plus `usage: { installed, limit }`                                                                                          |
| `GET /installations/:id`                         | `market.apps.read`    | the manage page of one installation                                                                                                                           |
| `GET /installations/:id/events?limit=&cursor=`   | `market.apps.read`    | recent deliveries: delivery id, outcome, reason                                                                                                               |
| `POST /installations/:id/consent`                | `market.apps.install` | accept the permission list of a newer version that asks for more: `{ acceptedScopes }`                                                                        |
| `PATCH /installations/:id`                       | `market.apps.manage`  | `{ rowVersion, config?, credentials?, clearCredentials? }`; 409 `ROW_VERSION_CONFLICT` when stale                                                             |
| `POST /installations/:id/disable` / `enable`     | `market.apps.manage`  | pause and resume (`{ rowVersion }`); a paused connection answers deliveries 409                                                                               |
| `POST /installations/:id/test`                   | `market.apps.manage`  | test the connection; the result also sets the installation health                                                                                             |
| `POST /installations/:id/sample`                 | `market.apps.manage`  | send a recipe sample payload through the whole path as a real lead (`{ payloadName? }`); honours an `Idempotency-Key`                                         |
| `POST /installations/:id/rotate-secret`          | `market.apps.manage`  | `{ rowVersion }` -> `{ installation, inboundSecret }`; the old secret stops working at once                                                                   |
| `POST /installations/:id/uninstall`              | `market.apps.install` | `{ dataChoice: 'keep' \| 'delete' }` -> 204                                                                                                                   |
| `GET /requests?q=&kind=&status=&sort=votes\|new` | `market.apps.read`    | what workspaces asked for (names and counts only)                                                                                                             |
| `POST /requests`                                 | `market.apps.read`    | ask: `{ name, kind?, categorySlug?, website?, note? }` -> 201 `{ request, created }`                                                                          |
| `POST /requests/:id/vote` / `DELETE`             | `market.apps.read`    | vote, take the vote back (idempotent)                                                                                                                         |

### What the UI consumes

**App card** (`marketAppCardSchema`, list and shelves):

```json
{
  "id": "uuid", "slug": "webhook", "kind": "integration",
  "category": { "slug": "lead-sources", "name": "Lead sources" },
  "name": "Webhook", "tagline": "...", "logo": "https://..." | null,
  "firstParty": true, "featured": true, "version": "1.0.0",
  "pricing": { "model": "free" | "included" | "addon", "note": "..." },
  "connectorType": "webhook_relay" | null, "installCount": 3, "publishedAt": "ISO",
  "install": { "installationId": "uuid", "status": "active|disabled|killed", "health": "unknown|healthy|degraded|error|needs_reauth", "needsReconsent": false } | null,
  "locked": { "reason": "plan_feature|module_disabled|limit_reached", "key": "analytics" | null, "upgradeUrl": "/account/plans" | null } | null
}
```

A **locked** app still shows, with an upgrade prompt; an installed app is never locked. `version` is what a new install gets (the installed
version when the workspace has it).

**App page** (`marketAppDetailSchema`) = the card plus `description`, `listing` (`longDescription`, `highlights`, `screenshots`,
`dataProcessing { summary, regions, deletion }` for the DPDP disclosure), `scopes` (`{ id, label, description, risk }` in plain words),
`surfaces`, `support`, `developer`, `changelog` (up to five published versions), and `setup` for an integration: the admin's fields
(`authFields` with `kind` `secret|text|select`, `required`, `help`, `options`), the setup `setupInstructions` and `hasTestPayload`.
It never carries endpoints, the field mapping, rate limits or test payloads.

**Installation** (`marketInstallationSchema`): `id`, `app`, `status`, `health { status, checkedAt, lastError, lastErrorAt }`, `version`,
`pendingVersion { version, scopes, newScopes } | null`, `needsReconsent`, `grantedScopes`, `config`, `credentials`
(`[{ key, label, kind, isSet, hint }]`: **never the value**; `hint` is `ends in ####` for a secret and the value itself for a plain text
field), `connection` (`type`, `status`, `inbound { url, method:'POST', auth, tokenHeader, signatureHeader, secretHint } | null`,
`pollIntervalSeconds`, `lastEventAt`, `lastSuccessAt`, `lastError`, `counters { received, accepted, duplicates, failed }`), `killReason`,
`installedBy`, `installedAt`, `rowVersion`.

**Install and rotate answers** (`marketInstallResultSchema`): `{ installation, inboundSecret }`. `inboundSecret` is the one value the
platform generates; it is in the answer that creates or rotates it and **nowhere else, ever** (`null` for apps with no connection and for a
push recipe whose secret is a credential the admin pasted). Show it once with a copy button.

### Consent

`acceptedScopes` must **equal** the scopes of the version being installed: fewer or extra is `422 MKT_CONSENT_REQUIRED` (`errors` lists
`missing:<scope>` and `unexpected:<scope>`). The UI shows `scopes[].label` and `description` and sends the ids it showed. A new version that
asks for a scope the installation was not granted leaves the installation **running on its old version** with `needsReconsent: true` and
`pendingVersion` set until an admin calls `POST /installations/:id/consent` with the new full list. A version that asks for no more than was
granted moves the installation at once, with the narrower grant. Consent, re-consent and uninstall are written to an append-only ledger
(`marketplace_consents`) with who, which version, which scopes and the data choice.

### Uninstall

One transaction: the installation, its connection (its public address stops answering), its sealed secrets and its delivery log are deleted;
the consent ledger keeps a row with the keep-or-delete choice; the audit row and outbox event `marketplace.app.uninstalled` carry the
choice. **The platform deletes no contact itself**: the domains that own what an app created act on the event (for a lead source, the lead
pipeline's source and its raw events are released immediately; contacts stay either way until a data-deletion consumer exists).

### Requests

A request is one row per normalised name and kind across the platform (`Just Dial`, `justdial` and `JustDial!` are one), and a workspace counts
once per request however often it asks or votes. Asking for what exists is a vote (`created: false`). A workspace sees names, status and vote
counts only, never who voted or their notes; the operator sees the notes and the first workspace.

## Public delivery address

`POST /v2/public/marketplace/hooks/:publicKey` (32 hex characters, shown in `connection.inbound.url`). Send `Content-Type: application/json`.
Authentication is over the **raw bytes** of the body, one of:

- token: header `X-Marketplace-Token: <secret>` (what Zapier and Make can do);
- signature: header `X-Marketplace-Signature: sha256=<hex HMAC-SHA256 of the body with the secret>`.

A push recipe may name its own header and credential (`connector.auth`). Answers: `200 { status: 'accepted' | 'duplicate', received, accepted,
duplicates, rejected }`; `401 MKT_WEBHOOK_UNAUTHORIZED`; `404` unknown address; `409 MKT_INSTALLATION_DISABLED` (paused);
`410 MKT_INSTALLATION_KILLED`; `400` unreadable JSON (the body parser); `413` too large (100 KB at the body parser); `422
MKT_WEBHOOK_BAD_PAYLOAD` nothing in the delivery could be mapped (`errors` names each reason); `429 RATE_LIMITED` (per address and per
connection: the recipe's `rateLimits.perMinute`, default 120; and a separate budget of 30 failed authentications a minute per connection);
`503 MKT_LEAD_PIPELINE_UNAVAILABLE`. **A delivery is acknowledged only after it reached the lead pipeline**, so a sender that retries on a
non-2xx never loses a lead, and a repeat of the same lead (the sender's own id, or a stable hash of the body when it sends none) is
`duplicate` and is not handed over twice. One delivery may carry an array of up to 100 leads. The generic webhook reads the sender's own id from the first of `id`, `lead_id`, `leadid`,
`external_id`, `uuid`, `query_id`, `enquiry_id`, `reference`, `ref` (so do not send a constant such as a form id under one of these names), the
time from `created_at`, `timestamp`, `received_at` and similar, and finds name, phone, email, message, company and city by their usual names;
every other scalar field is kept as it came.

## Operator API

| Method and path                                                       | Permission       | What                                                                                                                       |
| --------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /categories`                                                     | manage or review | every category with `appCount` in any status                                                                               |
| `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` | manage           | add, edit (`rowVersion`; `isActive:false` hides it from workspaces), delete when empty (`MKT_CATEGORY_IN_USE`)             |
| `GET /requests`, `PATCH /requests/:id`                                | read / manage    | the demand report (votes, notes, first workspace), triage `status` and `operatorNote`                                      |
| `GET /usage`                                                          | manage or review | per app: installations by status and health, deliveries accepted, repeated, rejected and failed in 24 hours and 7 days     |
| `GET /apps`                                                           | manage or review | every listing in any status (keyset)                                                                                       |
| `POST /apps`                                                          | manage           | create a listing from `{ manifest, recipe?, tagline, listing?, firstParty?, featured?, planFeature?, changelog? }`         |
| `GET /apps/:ref?versionId=`                                           | manage or review | listing, versions, and the manifest and recipe of the chosen (default latest) version                                      |
| `PATCH /apps/:ref`, `DELETE /apps/:ref`                               | manage           | edit tagline, content, `planFeature`, `featured`, `firstParty`, `sortOrder` (`rowVersion`); delete a never-published draft |
| `POST /apps/:ref/versions`, `PUT .../versions/:versionId`             | manage           | add a version (a higher number than any before); replace a draft or rejected version                                       |
| `POST .../versions/:versionId/submit`                                 | manage           | draft or rejected -> in review                                                                                             |
| `POST .../versions/:versionId/approve` / `reject`                     | **review**       | approve (optional note); reject (a reason of at least five characters, shown to the developer)                             |
| `POST /apps/:ref/publish`                                             | **review**       | publish the approved version (`{ versionId? }`, else the latest approved) -> `{ app, upgraded, awaitingConsent }`          |
| `POST /apps/:ref/hide` / `unhide`                                     | manage           | take a published listing out of browse; installations keep working                                                         |
| `POST /apps/:ref/kill`                                                | manage           | **the kill switch** `{ reason }` -> `{ app, disabledInstallations }`                                                       |
| `POST /apps/:ref/unkill`                                              | manage           | killed -> hidden, so it can be fixed and published again; killed installations stay off                                    |

**Listing lifecycle.** App: `draft -> in_review -> published <-> hidden`, and `killed` from any state. Version: `draft -> in_review ->
approved -> published -> retired` (or `rejected`, which is edited and resubmitted). Only `published` apps appear in browse and search.
Publishing validates again, then in one transaction retires the previous published version, updates the listing from the manifest (name,
category, connector type), and for every installation: moves it to the new version when its granted scopes already cover the new scopes
(narrowing the grant), or sets it waiting for consent. Killed installations are left alone. Each moved installation gets an audit row and
an outbox event in its own workspace.

**What is validated before a version is stored.** The manifest follows manifest v1 (below). An integration's recipe follows the recipe
schema, agrees with the manifest (same slug, category and connector type), passes its connector type's checks, and every address in it is
safe: https, a public DNS name (no IP literal, no `localhost`, no internal suffix, no credentials, default port) and, when saved, every
address the name resolves to is public (the guard the WhatsApp provider registry uses; it runs again right before every outbound call). A
version can only be **published** when its connector type is implemented (`409 MKT_CONNECTOR_NOT_AVAILABLE` otherwise), so nothing that does
not work reaches a workspace.

**The kill switch.** One transaction: the listing becomes `killed`, every installation of it becomes `killed` (with the reason), every
connection becomes `disabled`, and each workspace gets an audit row and an outbox event `marketplace.app.killed`; the operator gets a
`platform.market.app_killed` security event. The public address reads the status on every delivery, so it answers `410` from the next
request on (the spec's promise is within one minute; there is no cache to wait for). In the workspace a killed installation can only be
uninstalled; every other call is `409 MKT_INSTALLATION_KILLED`.

## Manifest v1

One document per version (`marketManifestSchema`); unknown keys are refused. The manifest is data: it never carries code.

| Field                  | Notes                                                                                                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifestVersion`      | `1`                                                                                                                                                                                                                                                                                                 |
| `id`                   | the slug: `^[a-z][a-z0-9-]{1,47}$`; stays the same across versions                                                                                                                                                                                                                                  |
| `name`, `description`  | 2 to 60; 10 to 600 characters                                                                                                                                                                                                                                                                       |
| `kind`, `category`     | `mini_app` or `integration`; the slug of an active category of that kind                                                                                                                                                                                                                            |
| `version`              | `MAJOR.MINOR.PATCH` with an optional pre-release; each version higher than the one before                                                                                                                                                                                                           |
| `scopes`               | ids from the registry below; unique                                                                                                                                                                                                                                                                 |
| `surfaces`             | declared and stored; rendered when third-party mini apps ship (`contact_panel`, `deal_panel`, `inbox_tab`, `settings_page`, `top_page`, `automation_trigger`, `automation_action`, `list_action`, `field_type`, `dashboard_widget`, `webhook_in`, `webhook_out`), each `{ type, key, label, url? }` |
| `pricing`              | `{ model: 'free' \| 'included' \| 'addon', note? }`: `addon` is bought as a billing add-on (the listing's `planFeature` is what it unlocks)                                                                                                                                                         |
| `support`, `developer` | `website`, `email`, `docs`, `privacy`, `terms`, `status` (https links); developer name and link                                                                                                                                                                                                     |
| `connector`            | integrations only: `{ type: oauth \| push \| pull \| email_parse \| webhook_relay }`                                                                                                                                                                                                                |
| `module`               | first-party mini apps only: the slug of the installable module that provides the code                                                                                                                                                                                                               |

## Scopes

A small, documented set mapped onto the **existing** workspace permission keys (`packages/contracts/src/marketplace/scopes.ts`; a unit
test proves every key is a seeded permission). The admin sees the label and description and consents; the installer must hold the keys.
`scopeCovers(granted, key)` is the check an app actor's request goes through once out-of-process apps exist.

| Scope                | Risk   | Permission keys                                                                                                 |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `contacts.read`      | low    | `record.contacts.read`                                                                                          |
| `contacts.write`     | medium | `record.contacts.create`, `record.contacts.update`                                                              |
| `leads.write`        | medium | `record.contacts.create`, `record.contacts.update` (a lead is a contact until the pipeline has keys of its own) |
| `conversations.read` | medium | `inbox.conversation.read`                                                                                       |
| `messages.send`      | high   | `inbox.conversation.reply`                                                                                      |
| `deals.read`         | low    | `record.deals.read`, `record.pipelines.read`                                                                    |
| `deals.write`        | medium | `record.deals.create`, `record.deals.update`                                                                    |
| `tasks.read`         | low    | `record.tasks.read`                                                                                             |
| `tasks.write`        | medium | `record.tasks.create`, `record.tasks.update`                                                                    |
| `appointments.read`  | low    | `record.appointments.read`                                                                                      |
| `appointments.write` | medium | `record.appointments.create`, `record.appointments.update`                                                      |
| `templates.read`     | low    | `tpl.templates.read`                                                                                            |
| `analytics.read`     | low    | `dash.analytics.read`                                                                                           |
| `webhooks.manage`    | high   | `admin.apikey.manage`                                                                                           |

## Connector framework

An integration is one of five mechanisms, run by a connector type through one port (`apps/api/src/infra/providers/marketplace/connector.port.ts`).

| Type            | Door                                                                                        | State                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook_relay` | the sender posts to the address with the generated secret                                   | **built and tested end to end** (the seeded Webhook listing)                                                                                          |
| `push`          | a portal posts with its own header and key, explicit mapping                                | **built and tested** with a stubbed pipeline; no portal recipe is shipped                                                                             |
| `pull`          | the worker polls the portal's API (templated request, address guard, error mapping, cursor) | framework complete and tested with a fake portal and the real queue; **not publishable** until the first portal recipe is verified against the portal |
| `oauth`         | the admin signs in, refresh token sealed                                                    | recipe schema and address checks only; **not publishable**                                                                                            |
| `email_parse`   | alert emails parsed with a template                                                         | recipe schema only (depends on the Email channel); **not publishable**                                                                                |

A **recipe** (`recipeSchema`) holds: `connector` (the type and its settings), `authFields` (what the admin supplies: `secret` fields are sealed
and write-only), `mapping` (`auto` for the generic webhook, or `explicit`: where the sender's id, time and items are, per-field `from` / `const`
with `trim|lower|upper|digits|phone` transforms, `required`, `default`, and attribution), `rateLimits`, `errorMapping` (status or body match to
a code, whether to retry, and the health it causes), `setupInstructions` and `testPayloads`. Paths are `a.b[0].c` (no expressions, never the
prototype chain); templates use `{{cred.<field>}}`, `{{config.<key>}}`, `{{cursor}}`, `{{since_iso}}`, `{{now_iso}}`.

Every lead-source connector ends in the **lead pipeline** (`apps/api/src/modules/leads`), through the pipeline's two leaf ports only
(`lead-ingest.port.ts`, `lead-source-directory.port.ts`), looked up lazily by token so this module imports no lead domain class. At install the
connector asks the directory for a source of its own (a workspace at its `lead_sources` cap is told so and nothing is installed); each lead goes
in through `ingest(orgId, sourceId, lead)`; uninstalling releases the source. Health: three failures in a row make an installation `degraded`
with the reason; the next success makes it `healthy`; a pull portal's refusal that retrying cannot fix stops the connection and sets
`needs_reauth` or `error`.

## Data and tenancy

Platform-owned (no `org_id`, forced RLS, writes only on the privileged path = this operator API): `marketplace_categories`,
`marketplace_apps`, `marketplace_app_versions`, and `market_requests`. A workspace may **read** published listings (and the retired versions
that are their history) and whatever it has installed even after the platform hides or kills it; it can write none of them (a request can be
added as itself, never changed). Tenant tables with forced RLS and composite keys: `workspace_app_installations`, `marketplace_consents`,
`marketplace_connections`, `marketplace_connection_events`, `market_request_votes`. Secrets (`credentials_enc`, `secret_enc`) are one sealed
CryptoService envelope each, and only hints are in the clear. The public address resolves its tenant through the SECURITY DEFINER function
`marketplace_connection_lookup(public_key)`, which returns two ids and nothing else. Delivery rows hold a delivery id and a status, never lead
data, and are trimmed after 30 days by the worker. Migrations `20261021090000_mkt_catalogue`, `..090100_mkt_installations`,
`..090200_mkt_permissions`, `..090300_mkt_seed`.

## Events

Written in the transaction of the change (outbox): `marketplace.app.installed`, `.scopes_changed`, `.upgraded`, `.configured`, `.enabled`,
`.disabled`, `.secret_rotated`, `.uninstalled` (carries `dataChoice`), `.killed`. Audit rows have `module` `marketplace`; their deltas name what
changed and never a value.

## Error codes

`MKT_APP_NOT_FOUND`, `MKT_NOT_INSTALLED`, `MKT_ALREADY_INSTALLED`, `MKT_APP_UNAVAILABLE`, `MKT_APP_LOCKED`, `MKT_CONSENT_REQUIRED`,
`MKT_SCOPE_EXCEEDS_INSTALLER`, `MKT_INSTALLATION_KILLED`, `MKT_INSTALLATION_DISABLED`, `MKT_CREDENTIAL_MISSING`, `MKT_NO_CONNECTION`,
`MKT_WEBHOOK_UNAUTHORIZED`, `MKT_WEBHOOK_BAD_PAYLOAD`, `MKT_LEAD_PIPELINE_UNAVAILABLE`, and for the operator `MKT_MANIFEST_INVALID`,
`MKT_RECIPE_INVALID`, `MKT_URL_REFUSED`, `MKT_CONNECTOR_NOT_AVAILABLE`, `MKT_SLUG_TAKEN`, `MKT_CATEGORY_NOT_FOUND`, `MKT_CATEGORY_IN_USE`,
`MKT_VERSION_STATE`, `MKT_VERSION_EXISTS`. Plus the platform's `PLAN_FEATURE_LOCKED`, `PLAN_LIMIT_REACHED`, `ROW_VERSION_CONFLICT`,
`RATE_LIMITED`.

## Not built yet

Third-party (out-of-process) mini apps, app tokens and OAuth for apps, iframe surfaces, the developer portal, paid third-party apps and
ratings (spec phases 3 and 4); the OAuth and email-parse connectors; any real lead-portal recipe (IndiaMART, JustDial, 99acres, MagicBricks,
Housing.com and Shiksha exist as **draft** listings only, their mechanism to be verified per portal); first-party mini app screens; the web UI.
