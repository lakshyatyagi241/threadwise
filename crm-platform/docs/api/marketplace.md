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

| Key                       | Surface   | Grants                                                                                                    | Held by default                     |
| ------------------------- | --------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `market.apps.read`        | workspace | browse, search, app pages, installed list and events, ask for an integration, vote                        | Owner, Admin (migration `..090200`) |
| `market.apps.install`     | workspace | install (with consent), accept a new version's permissions, uninstall                                     | Owner, Admin                        |
| `market.apps.manage`      | workspace | configure, pause and resume, test the connection, send a sample lead, rotate the connection secret        | Owner, Admin                        |
| `platform.market.manage`  | operator  | create and edit listings and categories, submit versions, hide, unhide, kill, unkill, triage requests     | Super Admin, Admin                  |
| `platform.market.review`  | operator  | approve and reject versions, **publish**                                                                  | Super Admin, Admin                  |
| `platform.market.pricing` | operator  | set an app's price and who gets it free, comp a workspace, cancel a subscription (migration `..23090100`) | Super Admin, Admin                  |

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

| Method and path                                  | Permission            | What                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /categories?kind=`                          | `market.apps.read`    | categories of a tab with the number of published apps in each                                                                                                                                                                                                                                                 |
| `GET /shelves?kind=`                             | `market.apps.read`    | `{ popular, new, featured }`, eight cards each                                                                                                                                                                                                                                                                |
| `GET /apps`                                      | `market.apps.read`    | browse and search; query `kind`, `category` (slug), `q`, `installed=true\|false`, `sort=featured\|popular\|new\|name`, `limit` (1..100, default 24), `cursor`                                                                                                                                                 |
| `GET /apps/:ref`                                 | `market.apps.read`    | the app page (`ref` = uuid or slug)                                                                                                                                                                                                                                                                           |
| `POST /apps/:ref/install`                        | `market.apps.install` | install after consent: `{ acceptedScopes, credentials?, config? }` -> 201 `{ installation, inboundSecret }`                                                                                                                                                                                                   |
| `GET /installations?kind=&status=`               | `market.apps.read`    | what the workspace has installed, plus `usage: { installed, limit }`                                                                                                                                                                                                                                          |
| `GET /installations/:id`                         | `market.apps.read`    | the manage page of one installation                                                                                                                                                                                                                                                                           |
| `GET /installations/:id/events?limit=&cursor=`   | `market.apps.read`    | recent deliveries: delivery id, outcome, reason                                                                                                                                                                                                                                                               |
| `POST /installations/:id/consent`                | `market.apps.install` | accept the permission list of a newer version that asks for more: `{ acceptedScopes }`                                                                                                                                                                                                                        |
| `PATCH /installations/:id`                       | `market.apps.manage`  | `{ rowVersion, config?, credentials?, clearCredentials? }`; 409 `ROW_VERSION_CONFLICT` when stale                                                                                                                                                                                                             |
| `POST /installations/:id/disable` / `enable`     | `market.apps.manage`  | pause and resume (`{ rowVersion }`); a paused connection answers deliveries 409                                                                                                                                                                                                                               |
| `POST /installations/:id/test`                   | `market.apps.manage`  | test the connection; the result also sets the installation health                                                                                                                                                                                                                                             |
| `POST /installations/:id/sync`                   | `market.apps.manage`  | **Sync now** (pull connections): bring the next poll forward, never faster than the portal allows -> `{ status: 'scheduled', runAt, minIntervalSeconds }`; a connection stopped on an error is started again; 409 `MKT_NO_CONNECTION` (nothing polls), `MKT_INSTALLATION_DISABLED`, `MKT_INSTALLATION_KILLED` |
| `POST /installations/:id/sample`                 | `market.apps.manage`  | send a recipe sample payload through the whole path as a real lead (`{ payloadName? }`); honours an `Idempotency-Key`                                                                                                                                                                                         |
| `POST /installations/:id/rotate-secret`          | `market.apps.manage`  | `{ rowVersion }` -> `{ installation, inboundSecret }`; the old secret stops working at once                                                                                                                                                                                                                   |
| `POST /installations/:id/uninstall`              | `market.apps.install` | `{ dataChoice: 'keep' \| 'delete' }` -> 204                                                                                                                                                                                                                                                                   |
| `GET /requests?q=&kind=&status=&sort=votes\|new` | `market.apps.read`    | what workspaces asked for (names and counts only)                                                                                                                                                                                                                                                             |
| `POST /requests`                                 | `market.apps.read`    | ask: `{ name, kind?, categorySlug?, website?, note? }` -> 201 `{ request, created }`                                                                                                                                                                                                                          |
| `POST /requests/:id/vote` / `DELETE`             | `market.apps.read`    | vote, take the vote back (idempotent)                                                                                                                                                                                                                                                                         |

### What the UI consumes

**App card** (`marketAppCardSchema`, list and shelves):

```json
{
  "id": "uuid", "slug": "webhook", "kind": "integration",
  "category": { "slug": "lead-sources", "name": "Lead sources" },
  "name": "Webhook", "tagline": "...", "logo": "https://..." | null,
  "firstParty": true, "featured": true, "version": "1.0.0",
  "pricing": { "model": "free" | "paid_monthly", "amount": "9.00" | null, "currency": "USD" | null, "trialDays": 14, "trialAvailable": true,
               "access": "free|included|entitled|subscription_required|not_for_sale", "includedBy": null, "checkoutPath": "/billing/checkout/mkt_..." | null },
  "connectorType": "webhook_relay" | null, "installCount": 3, "publishedAt": "ISO",
  "maturity": "stable" | "beta" | "needs_portal_setup", "notice": "..." | null,
  "install": { "installationId": "uuid", "status": "active|disabled|killed", "health": "unknown|healthy|degraded|error|needs_reauth", "needsReconsent": false } | null,
  "locked": { "reason": "plan_feature|module_disabled|limit_reached", "key": "analytics" | null, "upgradeUrl": "/account/plans" | null } | null
}
```

A **locked** app still shows, with an upgrade prompt; an installed app is never locked. `version` is what a new install gets (the installed
version when the workspace has it).

**App page** (`marketAppDetailSchema`) = the card plus `description`, `listing` (`longDescription`, `highlights`, `screenshots`,
`dataProcessing { summary, regions, deletion }` for the DPDP disclosure, and `maturity` and `notice`: how far the listing can be trusted to work without the
customer's help, `stable | beta | needs_portal_setup`, and one plain sentence beside the badge; the card carries both too), `scopes` (`{ id, label, description, risk }` in plain words),
`surfaces`, `support`, `developer`, `changelog` (up to five published versions), and `setup` for an integration: the admin's fields
(`authFields` with `kind` `secret|text|select`, `required`, `help`, `options`), the setup `setupInstructions` and `hasTestPayload`.
It never carries endpoints, the field mapping, rate limits or test payloads.

**Installation** (`marketInstallationSchema`): `id`, `app`, `status`, `health { status, checkedAt, lastError, lastErrorAt }`, `version`,
`pendingVersion { version, scopes, newScopes } | null`, `needsReconsent`, `grantedScopes`, `config`, `credentials`
(`[{ key, label, kind, isSet, hint }]`: **never the value**; `hint` is `ends in ####` for a secret and the value itself for a plain text
field), `connection` (`type`, `status`, `inbound { url, method, auth, tokenHeader, signatureHeader, secretHint, methods, formats, delivery } | null`
(`auth` is `token|hmac|either|path`; for `path` the full address is `url` + `/` + the secret, shown once), `pollIntervalSeconds`, `lastEventAt`,
`lastSuccessAt` (the last sync of a pull connection), `lastError`, `counters { received, accepted, duplicates, failed }`, and for a pull connection
`nextPollAt`, `syncedThrough` (leads fetched up to this time) and `minSyncIntervalSeconds`), `killReason`,
`installedBy`, `installedAt`, `rowVersion`.

**Install and rotate answers** (`marketInstallResultSchema`): `{ installation, inboundSecret }`. `inboundSecret` is the one value the
platform generates; it is in the answer that creates or rotates it and **nowhere else, ever** (`null` for apps with no connection and for a
push recipe whose secret is a credential the admin pasted). Show it once with a copy button. When `inbound.auth` is `path` the secret is part of the
address the portal's team must be given (`inbound.url` + `/` + `inboundSecret`): show the whole address once, with the method and formats it takes.

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

`POST` or `GET /v2/public/marketplace/hooks/:publicKey`, or `.../hooks/:publicKey/:secret` (the 32 hex characters are in `connection.inbound.url`).
What an address takes is the recipe's choice (`connector.delivery`; a recipe that says nothing gets what the address always did):

| Setting   | Values                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `methods` | `POST` (default), `GET`: a portal that cannot post (JustDial) delivers with GET and a query string                                                                                                                                               |
| `formats` | `json` (default), `form` (`application/x-www-form-urlencoded`; nested keys such as `lead[phone]=1`, `items[]=a` work), `xml` (one document; no DTD and no entities beyond the five predefined ones, see below), `query` (the URL's query string) |
| `mode`    | `sync` (default): answered after the lead reached the pipeline. `async`: stored whole, answered 200 at once, processed by the worker                                                                                                             |

A sender with a wrong or missing `Content-Type` is read by the first character of its body (`{` or `[` JSON, `<` XML, `a=b` a form); multipart is never
read. The format is read from the **raw bytes**; an XML document that declares a `DOCTYPE` or an `ENTITY` is refused (there is nothing to expand or
fetch), depth and node count are capped, and the document element is unwrapped to the lead (or the list of leads) for the generic mapping.

**Authentication**, one of (the recipe says which; an installation's `connection.inbound.auth` tells the page):

- `token`: header `X-Marketplace-Token: <secret>` (what Zapier and Make can do);
- `hmac`: header `X-Marketplace-Signature: sha256=<hex HMAC-SHA256 of the raw body with the secret>`;
- `path`: the secret is the **last segment of the address**, `.../hooks/<publicKey>/<secret>`, for a sender that sets no header (IndiaMART allows an
  identifier in the path; JustDial's team configures a URL and nothing else). The full address is shown **once**, in the answer that installs or rotates
  (`inbound.url` + `/` + `inboundSecret`); the page afterwards knows only the secret's last four characters. Rotating makes the old address 401 at once.

A push recipe may name its own header and credential (`connector.auth`). The comparison is constant time and a wrong secret never says how close it was.

**Answers.** `200 { status, received, accepted, duplicates, rejected }` where `status` is `accepted`, `duplicate` or, for an `async` connection,
`queued` (the counts are then 0 and `event` is the stored delivery's id to quote to support); `401 MKT_WEBHOOK_UNAUTHORIZED`; `404` unknown
address; `405 MKT_WEBHOOK_BAD_PAYLOAD` a method the recipe does not take; `409 MKT_INSTALLATION_DISABLED` (paused); `410 MKT_INSTALLATION_KILLED`;
`413 PAYLOAD_TOO_LARGE` over 256 KB (JSON and form bodies are cut earlier, at the body parser's 100 KB); `415 MKT_WEBHOOK_BAD_PAYLOAD` a format the
recipe does not read (the message lists what it reads); `400` unreadable JSON (the body parser); `422 MKT_WEBHOOK_BAD_PAYLOAD` (sync only) nothing in the
delivery could be read or mapped (`errors` names each reason); `429 RATE_LIMITED` (per client address 600 a minute, per connection the recipe's
`rateLimits.perMinute`, default 120, and a separate budget of 30 failed authentications a minute per connection); `503 MKT_LEAD_PIPELINE_UNAVAILABLE`
(sync: the pipeline cannot take the lead; async: the delivery could not be stored). A request that carries nothing at all (a portal checking that
the address answers) on an `async` connection is answered 200 with zero counts and is not stored or counted.

**`sync`** (the generic webhook, unchanged): **a delivery is acknowledged only after it reached the lead pipeline**, so a sender that retries on a
non-2xx never loses a lead, and a repeat of the same lead (the sender's own id, or a stable hash of the body when it sends none) is `duplicate` and
is not handed over twice. One delivery may carry an array of up to 100 leads. The generic webhook reads the sender's own id from the first of `id`,
`lead_id`, `leadid`, `external_id`, `uuid`, `query_id`, `queryid`, `enquiry_id`, `reference`, `ref` (so do not send a constant such as a form id under one of these
names), the time from `created_at`, `timestamp`, `received_at` and similar, and finds name, phone (also `lead_phone`, `phone_no`), email, message (also
`remark`, `msg`, `qryinfo`, `description`), company and city by their usual names; a country code sent apart (`country_code`) is joined to the number; every
other scalar field is kept as it came.

**`async`** (the portals): portals turn their sender off after a day or two of errors (IndiaMART: a 10 second timeout, the Push API deactivated after 48
hours of refusals), so the door **never makes the sender wait for the pipeline**. Order: throttle, tenant lookup, live checks, authentication, size,
method and format, then the delivery is written to `marketplace_inbound_events` **before** the sender is answered (a failure to write is a 503, so nothing
is acknowledged that is not stored) and a job is queued on `mkt-inbound`. The worker claims the row, reads it again from the stored bytes, maps it with the
recipe and hands each lead to the pipeline through the same delivery service every door uses (idempotent on the connection's delivery ids and the
pipeline's `(source, external id)`). Outcomes of a stored delivery: `processed` (the raw body is dropped: it holds a person's name and phone, the pipeline
keeps its own raw event); `rejected` for good (unreadable, holds no lead, or its connection was paused or killed after it was stored: the body stays for
support); or `failed` and retried from the stored copy after 30 seconds doubling to an hour, up to 12 tries, when the pipeline could not take it. The
connection's counters and health move as for any delivery (an unreadable delivery counts as failed with the reason on `lastError`). A sweep every 20
seconds queues what has no job (Redis was down, a retry is due, a worker died mid-delivery); rows are trimmed after 30 days.

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

## Paid and free apps (pricing and subscriptions)

Some apps are free and some are paid, decided **per listing by the platform operator**; this holds for first-party and third-party apps alike. A
workspace buys a paid app on a **monthly subscription**. There is no second billing system: the sale rides the add-ons, checkout, gateway,
order, coupon and tax machinery that already exists (`docs/wadesk-port/inventory/addons-extension-registry.md`, `platform-payment-gateways.md`).

### How it works

| Piece                     | Where                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The price                 | Columns of `marketplace_apps` the **operator** sets (`PUT /apps/:ref/pricing`): `pricing_model` (`free` or `paid_monthly`), price and currency, optional trial days, optional yearly price, `purchasable`, and who gets it free. The manifest's `pricing` is only the developer's **proposal**: the operator console shows it, nothing reads it for money. |
| What is sold              | A billing add-on (a `plans` row of kind `addon`, `marketplace_app_id` set): one month, the app's price, granting the single feature key `mkt_<slug with underscores>`. Created and kept in step by the pricing call. The add-ons console and the workspace add-on catalogue do not list it.                                                                |
| How a workspace pays      | **Subscribe** answers with `/billing/checkout/<packSlug>`, the existing checkout page (quote, gateway choice, coupon, tax, test mode of the gateway). Nothing about payment is new.                                                                                                                                                                        |
| What entitles it          | The purchase row `workspace_addons` the paid order creates. `AddonEntitlementService` merges the add-on's feature key onto the plan like any other flag, so **one entitlement service decides access** (plan, overrides, add-ons). A workspace the platform owns is never limited.                                                                         |
| What the Marketplace adds | `marketplace_subscriptions`, one row per (workspace, app): source (`purchase`, `trial`, `comp`), cancel at period end, period end, what the last payment was, lapsed, comped by whom. It **follows** the entitlement; it never grants it. Written only on privileged paths (checkout fulfilment, operator API, worker sweep).                              |
| Fulfilment                | `AddonFulfilmentService.fulfil` calls the listeners registered in `AddonFulfilmentHooks` **in the purchase's own transaction**; the Marketplace's `MarketSubscriptionLifecycle` writes or renews the subscription and switches a subscription-paused installation back on. Order, entitlement and subscription commit together.                            |

### The operator's pricing (`platform.market.pricing`)

`PUT /apps/:ref/pricing` `{ rowVersion, model, amount?, currency?, annualAmount?, trialDays, purchasable, includedPlanFeature?, includedMinPlan? }`
answers the operator app (its `pricing` view). `free` carries none of the paid fields. `paid_monthly` needs a price above zero (a decimal with at most
two places) and a currency that is **enabled on the platform**; trial 0 to 90 days; `purchasable: false` stops NEW subscriptions while workspaces
that already subscribe may keep renewing; `includedPlanFeature` names a core or module plan feature and `includedMinPlan` a plan in the catalogue:
a workspace whose plan (counting its add-ons) has the feature, or is at or above that plan in catalogue order (`sort_order`, price), gets the app
free (`access: included`) and cannot buy it. `grantsPlanFeatures` and `grandfatherExisting` are explained in the next subsection. A refused change names the field (`422 VALIDATION_FAILED`, `errors`); a stale `rowVersion` is `409`.
Every change writes the security event `platform.market.pricing_set` (before and after) in the same transaction. **Visibility** is the existing
hide, unhide and kill, not a pricing field.

The operator list takes `pricing=free|paid` and every listing carries `pricing` and `activeSubscriptions`.

### What a workspace sees

The card and the app page carry `pricing`: `model`, `amount`, `currency`, `trialDays`, `trialAvailable`, `access`, `includedBy`, `checkoutPath`.

| `access`                | Meaning                                                                       | What the UI offers                                             |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `free`                  | not a paid app                                                                | Install, unchanged                                             |
| `included`              | the workspace's plan includes it (`includedBy`: `plan_feature` or `min_plan`) | Install                                                        |
| `entitled`              | a subscription (paid, trial or comp) is in force                              | Install, manage, renew near the end                            |
| `subscription_required` | paid and the workspace has none                                               | **Subscribe** (and **Start free trial** when `trialAvailable`) |
| `not_for_sale`          | paid, none, and the operator stopped selling to newcomers                     | a note                                                         |

The detail and the installation carry `subscription` (`status` `active | trialing | comped | canceling | ended`, `source`, what the last payment was,
`currentPeriodEnd`, `nextAmount` when the listing price moved since, and `actions`: `canCancel`, `canResume`, `canRenew`). The status is **derived**: a
period that has run out reads `ended` at once, before the sweep has recorded it. An installation paused because its subscription ended has
`status: disabled` and `pauseReason: subscription_ended`.

| Method and path                       | Permission            | What                                                                                                                                                                                                        |
| ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /apps/:ref/subscribe`           | `market.apps.install` | `{ startTrial? }` -> `{ outcome, checkout, subscription }`: `trial_started`, `checkout` (`{ packSlug, path }`), `included`, `already_entitled`, `free`; `422 MKT_TRIAL_UNAVAILABLE`, `409 MKT_NOT_FOR_SALE` |
| `POST /apps/:ref/subscription/cancel` | `market.apps.install` | stop renewing: the period already paid for runs to its end, then the installation is paused (data kept); not for a comp (the operator's); idempotent                                                        |
| `POST /apps/:ref/subscription/resume` | `market.apps.install` | take a cancellation back while the period still runs                                                                                                                                                        |
| `GET /subscriptions`                  | `market.apps.read`    | the workspace's own subscriptions, newest first                                                                                                                                                             |

`POST /apps/:ref/install` of a paid app without a subscription is `422 MKT_SUBSCRIPTION_REQUIRED` (`errors` carries `checkoutPath`) or `409 MKT_NOT_FOR_SALE`;
with an entitlement the normal consent step follows. Switching a subscription-paused installation back on is refused the same way until the
workspace pays; a pause the admin made by hand is never undone by a payment or by the lapse.

### Life of a subscription

| Step         | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscribe    | pay at the existing checkout. Paid order -> `workspace_addons` row (a month) + subscription `started` (or `resubscribed` after a lapse, or `started` converting a trial or a comp), audit row, outbox event, all in the order's transaction. A replay of the payment changes nothing.                                                                                                                                                                                                                                                                                           |
| Renew        | **a monthly prepaid term, renewed by paying again** (see decisions). The payment extends the term already paid for (one month counted from its end, so no day is lost) -> `renewed`, `renewals` + 1, a cancellation made earlier is taken back. Checkout refuses a payment while more than 45 days are already paid for, and one for an app the workspace's plan includes.                                                                                                                                                                                                      |
| Cancel       | `cancel_at_period_end`; access continues to the end of the period; event `canceled`. **Uninstalling** cancels the renewal too (the uninstall dialog warns); reinstalling inside the paid period costs nothing.                                                                                                                                                                                                                                                                                                                                                                  |
| Lapse        | the worker's sweep (**every minute**, idempotent, safe in several workers) lapses an active subscription that has no entitlement row in force: status `lapsed`, event `lapsed`, and the installation is **paused** (`paused_by_subscription`, its connection stops answering, data and settings kept, event `marketplace.app.disabled` with reason `subscription_ended`). It does not pause when the app is free now, the plan includes it, or an override gives the workspace the feature. Access never waits for the sweep: it is read from the purchase rows at every check. |
| Resubscribe  | a new payment: `resubscribed`, and the installation the subscription paused is switched back on (`marketplace.app.enabled`, reason `subscription_paid`).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Kill switch  | every subscription of the withdrawn app stops renewing (`canceled`, reason `app_withdrawn`); what was paid for runs to its end; checkout refuses the app; the operator can comp or refund by hand.                                                                                                                                                                                                                                                                                                                                                                              |
| Price change | the listing's price is read at every order, so a change applies to **new subscriptions and the next payment of an existing one**, as editing an ordinary add-on does. A period already paid for is never touched, refunded or re-priced. The subscription keeps what the last payment was (`amount`), and the workspace's page says `nextAmount` when it differs.                                                                                                                                                                                                               |
| Free trial   | `trialDays` > 0 and the workspace has never had a subscription to the app: Subscribe with `startTrial` grants a time-limited add-on purchase row (no order) through a SECURITY DEFINER function and records a `trial` subscription. One trial per workspace and app. Paying during a trial starts the paid month at once; the trial's remainder is not added.                                                                                                                                                                                                                   |
| Comp         | the operator gives a workspace the app free for 1 to 36 months or until revoked: a purchase row with no order and a `comp` subscription. Refused for a free app, an unknown workspace, and a workspace that pays and whose period still runs. A workspace cannot cancel a comp.                                                                                                                                                                                                                                                                                                 |

### Apps that own existing plan features (first-party)

A feature the product already gates by plan can become a **paid first-party app** without changing a single gate. The listing declares
`grantsPlanFeatures` (existing plan feature keys, for example a booking app granting `appointment_booking`); the add-on that sells the app
carries them next to its own key (`features: { mkt_<slug>: true, <granted key>: true }`), and **the plans domain's one resolver**
(`PlanEntitlementService.forOrg`, behind `RequirePlanFeature`, in-context guards such as `AppointmentPlan`, and the entitlements the web reads)
merges the `features` of the add-ons of Marketplace apps the workspace holds into the plan's features. So every existing gate, nav gate and
`planFeature` check honours a subscription as it honours a plan flag. The workspace's own override still wins; the grant applies after a lapsed
plan fell back to the free plan (it is the workspace's own purchase); when the subscription ends the gate closes at once, before the sweep. Ordinary
billing add-ons are not merged there (they are still counted only by `AddonEntitlementService`, as before): only the add-ons of Marketplace apps.

Rules, all enforced by the API (and the first by the database): only a **first-party** app may grant plan features (a third-party app must never be
able to switch on a core capability; the first-party flag cannot be removed while features are granted); only a paid app; every key must be a core or a
module-contributed plan feature; the feature that includes an app cannot be one the app grants; **the registry default of a granted core feature must
be off**, because a feature that is on by default is granted by every plan row that predates it and the app would sell what everyone already has.
So a feature that is on today (`appointment_booking`) can be named only by a listing still being prepared (draft or in review), so the grandfather
action can run while it is still on for everyone; **publishing refuses it (`409 MKT_VERSION_STATE`) until its default in `PLAN_FEATURE_DEFS` has been
switched off**, and a live listing cannot take it on. Changing the granted features changes what current subscribers have at once.

**Grandfather: comp existing users.** A listing marked `grandfatherExisting` lets the operator run
`POST /apps/:ref/subscriptions/grandfather { months, note, dryRun }` (`platform.market.pricing`): it finds every workspace that has one of the granted
features **now**, through its plan or its overrides, and has no subscription to the app yet, and gives each a comped subscription (an open-ended comp,
or for `months`), with the usual audit row and outbox event per workspace and one `platform.market.subscriptions_grandfathered` security event.
`dryRun` (the default) only counts and lists (the first 25 names). It skips workspaces the platform owns and workspaces whose plan the catalogue does
not know (they have everything, so having the feature says nothing), and a workspace that gained a subscription meanwhile. It reads what each workspace
has at this moment, so run it **before** the registry default is switched off or plan rows are changed; a second run finds nobody. It is refused
(`409 MKT_SUBSCRIPTION_STATE`) for a free listing, one that grants nothing, or one that is not marked.

**Appointments is the first paid first-party app (owner requirement of 2026-10-04; seeded, migration `20261023090200_mkt_appointments_app`).**
The listing `appointments` (first-party `mini_app`, category Booking and payments) is seeded as a **draft**: `paid_monthly`, **price not set**
(a paid price must be above zero, and publishing is refused with `409 MKT_VERSION_STATE` / `price_not_set` until the operator sets it in the
console; a listing still being prepared may be paid with no price), **not included in any plan**, granting `appointment_booking`, marked
"comp existing users". The registry default of `appointment_booking` in `PLAN_FEATURE_DEFS` is now **false** and the migration writes
`appointment_booking: false` into every existing plan row, so no plan grants it. Nothing in the appointments module changed: its
`appointment_booking` gates, `booking-plan.ts` and the nav gate ask the same resolver, which now counts a subscription. Deployment order:
(1) deploy; (2) the operator sets the price on the listing (this creates the add-on); (3) **Comp existing users**, dry run then for real: it comps
every workspace that has booking types or appointments (a usage probe, because their plan no longer grants the feature) and every workspace whose
plan or override grants it; (4) publish. Between deploy and step 3 a workspace on a catalogue plan has no booking, so do steps 2 and 3 in the same
window as the deploy. Workspaces on a plan the catalogue does not know stay open (nothing is locked for them) and are not comped.

### Operator API additions

| Method and path                             | Permission                | What                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /apps/:ref/pricing`                    | **pricing**               | set the pricing (above); creates and updates the add-on that sells the app                                                                                                                                |
| `GET /subscriptions`                        | manage, review or pricing | who subscribes to what: query `app` (uuid or slug), `status`, `source`, `q` (workspace name), `limit`, `cursor`                                                                                           |
| `GET /subscriptions/summary`                | manage, review or pricing | per app: counts by state and the **MRR** per currency (list price of the active paid subscriptions, no tax, no coupons, no trials, no comps, not converted between currencies), plus totals               |
| `POST /apps/:ref/subscriptions/comp`        | **pricing**               | `{ workspaceId (organization uuid), months (1..36 or null), note }`; security event `platform.market.subscription_comped`, an audit row and an outbox event in the workspace                              |
| `POST /apps/:ref/subscriptions/grandfather` | **pricing**               | `{ months (1..36 or null), note, dryRun (default true) }` -> `{ dryRun, matched, comped, sample }`: comp the workspaces that already have the granted plan features (above)                               |
| `POST /subscriptions/:id/cancel`            | **pricing**               | `{ immediate, reason }`: at the end of the period paid for, or now (the entitlement is withdrawn and the installation paused; repeating "now" repeats the pause); `platform.market.subscription_canceled` |

### Decisions and deviations (recorded; see also `docs/wadesk-port/parity/product-extensions.md`, item 21)

1. **No second billing system.** Reused: `plans` (kind `addon`), checkout and the gateway drivers (test mode of the gateway in development), orders, coupons, tax,
   `workspace_addons`, `AddonFulfilmentService`, `AddonEntitlementService` and the entitlement merge (unchanged).
2. **Monthly prepaid term; automatic card renewal is not built.** WaDesk add-ons are terms, not subscriptions: a purchase row ends and is bought
   again. The gateways' recurring machinery (`subscriptions`, the reconciler) moves a workspace's _plan window_ (`org_plan_state`, `organizations.plan`),
   so it cannot renew an add-on without changes in the payments domain. A renewal is paying again (Renew now on the manage page, nudged in the last
   7 days); the UI says "paid until", never "renews automatically". Backlog BL-070.
3. **Price changes** follow the add-on rule above (next order, no lock, no refund); a per-subscriber price lock is a backlog item (BL-071).
4. **The wallet does not pay.** The wallet is the message-credit ledger (top-ups in, message charges out) and checkout has no wallet-pays path for plans
   or add-ons; apps follow the plans. Backlog BL-073.
5. **A workspace on a free plan may subscribe.** The ordinary add-on rule "needs an active paid plan" is for boosts on top of a plan; a Marketplace
   app is a subscription of its own and is gated by the plan feature `marketplace` and the listing's `planFeature`.
6. **The entitlement lives in `workspace_addons`**; the subscription row is a ledger that follows it. The two writes happen in one transaction (the
   listener hook) so a workspace that just paid never shows as having nothing.
7. **Annual price** is stored and shown to the operator; annual billing is not built (BL-072). **Revenue share and payouts to third-party developers**
   are not built; all revenue is the platform's (BL-074).
8. **Visibility** is the existing hide, unhide and kill; the pricing form shows the status beside it.
9. Nothing here ran against a real payment gateway: tests fake the far end of Stripe (sandbox mode) and keep the order, paid transition, entitlement,
   ledger, audit and outbox real.

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
| `pricing`              | `{ model: 'free' \| 'included' \| 'addon', note? }`: the developer's **proposal** only. What an app costs is the operator's catalogue pricing (see Paid and free apps); nothing reads this field for money and workspaces never see it                                                              |
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

| Type            | Door                                                                                                                                   | State                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webhook_relay` | the sender posts to the address with the generated secret                                                                              | **built and tested end to end** (the seeded Webhook listing)                                                                                                                   |
| `push`          | a portal posts or GETs the address, with a header, a signature or the secret in the path; explicit or generic mapping                  | **built and tested** (JSON, form, XML, query string; stored first, processed by the worker); five portal recipes ship (see below)                                              |
| `pull`          | the worker polls the portal's API: windows, a signed request, the portal's limits and penalties, a high-water mark, derived dedupe ids | **built and tested** against fake portals that follow IndiaMART's and Housing.com's rules; three portal recipes ship. A pull recipe may also declare a `push` door (IndiaMART) |
| `oauth`         | the admin signs in, refresh token sealed                                                                                               | recipe schema and address checks only; **not publishable**                                                                                                                     |
| `email_parse`   | alert emails parsed with a template                                                                                                    | recipe schema only (depends on the Email channel); **not publishable**                                                                                                         |

A **recipe** (`recipeSchema`) holds: `connector` (the type and its settings), `authFields` (what the admin supplies: `secret` fields are sealed
and write-only), `mapping` (`auto` for the generic webhook, or `explicit`: where the sender's id, time and items are, per-field `from` / `const`
with `trim|lower|upper|digits|phone|unescape` transforms, `required`, `default`, and attribution), `rateLimits`, `errorMapping` (status or body match to
a code, whether to retry, and the health it causes), `setupInstructions` and `testPayloads`. Paths are `a.b[0].c` (no expressions, never the
prototype chain); templates use `{{cred.<field>}}`, `{{config.<key>}}`, `{{cursor}}`, `{{since_iso}}`, `{{now_iso}}`, `{{now_epoch}}`, `{{window_start}}`
and `{{window_end}}`. What the portal recipes added, all data and all validated on save:

| Where                              | Field                                                                                                        | What it does                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connector` (push, webhook relay)  | `delivery { methods, formats, mode }`                                                                        | what the public address reads and when it answers (above); `auth.scheme: 'path_token'` (push) and `auth: 'path'` (relay) put the secret in the address                                           |
| `connector` (pull)                 | `push { delivery }`                                                                                          | the same listing also receives deliveries at an address whose secret is in its path (IndiaMART's Push API next to the CRM-key pull); both doors use one mapping and a lead from both is one lead |
| `connector.window`                 | `format`, `utcOffsetMinutes`, `maxSeconds`, `overlapSeconds`, `initialLookbackSeconds`, `maxLookbackSeconds` | the poll asks "the leads between two times" (`{{window_start}}`, `{{window_end}}` in the portal's format and zone); see the pull engine                                                          |
| `connector.limits`                 | `minIntervalSeconds`, `requestsPerMinute`                                                                    | the portal's own limits; the poll interval may not be shorter than the minimum interval; the worker and Sync now keep them                                                                       |
| `connector.request.sign`           | `hmac_sha256`, `keyField`, `timestampParam`, `signatureParam`                                                | the request carries the time and its HMAC-SHA256 (hex) keyed with a secret auth field (Housing.com)                                                                                              |
| `connector.response`               | `itemsPath`, `statusPath`, `emptyStatuses`                                                                   | where the list is (absent: the answer, or the one list an object holds); a portal that answers 200 and keeps its status in the body (IndiaMART `CODE`); statuses that mean "no leads"            |
| `connector.pagination`             | `pageParam`, `sizeParam`, `pageSize`, `startPage`, `maxPages`                                                | pages inside one window, spaced by `requestsPerMinute`                                                                                                                                           |
| `errorMapping[]`                   | `retryAfterSeconds`                                                                                          | the portal's stated penalty (IndiaMART blocks a key for 15 minutes): the next poll is no sooner                                                                                                  |
| `mapping` (explicit)               | `externalIdDerive { parts, prefix }`                                                                         | a lead id for a portal that gives none: SHA-256 of the parts after their transforms (Housing.com: phone, project, lead date); a missing part falls back to the hash of the whole item            |
| `mapping` (explicit)               | `receivedAt { from, format, utcOffsetMinutes }`                                                              | `iso` (a time with no zone is the portal's own, IST = 330), `epoch_seconds`, `epoch_millis`                                                                                                      |
| `mapping.fields[]` and attribution | `fallbackFrom`, `ignore`, `map`                                                                              | the next path when the first is empty or not a number; values the portal sends for "nothing" (`IndiaMART Buyer`); the portal's wording to ours (`W` to `Direct enquiry`)                         |
| `mapping` (auto)                   | `platform`, `defaultCountryCode`, `receivedAtApproximate`, `utcOffsetMinutes`, `externalIdDerive`            | the generic mapping for a payload nobody has seen yet still labels its leads (`justdial`), and a lead with no time of its own carries `received_at_approximate` and the receive time             |

Every lead-source connector ends in the **lead pipeline** (`apps/api/src/modules/leads`), through the pipeline's two leaf ports only
(`lead-ingest.port.ts`, `lead-source-directory.port.ts`), looked up lazily by token so this module imports no lead domain class. At install the
connector asks the directory for a source of its own (a workspace at its `lead_sources` cap is told so and nothing is installed); each lead goes
in through `ingest(orgId, sourceId, lead)`; uninstalling releases the source. Health: three failures in a row make an installation `degraded`
with the reason; the next success makes it `healthy`; a pull portal's refusal that retrying cannot fix stops the connection and sets
`needs_reauth` or `error`. A connection that polls and receives (IndiaMART) and has stopped on a refused key stays stopped, with its error, until the
key is replaced: a lead arriving at its push address says nothing about the key.

### The pull engine

`PullSweepService` (worker, every 30 seconds) lists active pull connections that are due and queues one `mkt-pull` job per connection (job id = the
connection); `PullRunService` makes one poll. What it keeps, whoever asks (the sweep, Sync now, a retry):

- **The portal's minimum interval.** `connector.limits.minIntervalSeconds` after the last request (`last_poll_at`, written before the call, so a worker that dies
  mid-request cannot let the next one out at once). A poll that comes too soon is not made; the schedule moves to when it may be. A connection that is
  behind catches up at `max(minInterval, 60 / requestsPerMinute)` instead of the whole interval.
- **A high-water mark and an overlap** (`window`). `poll_cursor` is the end of the last window fetched. The next window starts `overlapSeconds` before it and
  ends now or one window's width on, whichever is sooner, so nothing falls between two polls; a connection paused or failing for longer than the window
  catches up one window per poll, and one away for longer than the portal keeps history reaches back only that far (the gap is lost, and it is the
  portal's limit, not ours). The mark moves only after the leads are in.
- **No double fetch.** The overlap fetches leads it already has. The portal's own lead id (or the recipe's derived id) is the key on the connection's
  delivery log and in the pipeline; a repeat is neither delivered nor counted again (`quietRepeats`: the connection page would otherwise show a
  "duplicate" for every lead on every poll). A lead that arrives by the push door and again by the poll is one lead.
- **A window that holds more than one answer carries** (more than `maxItemsPerPoll`, or an answer over 1 MB) is asked again in halves (`poll_window_seconds`)
  with nothing handed over, then grows back; nothing is lost or counted twice.
- **Errors map to what happens next.** The recipe's `errorMapping` (status, status range or text in the answer, and for a portal that keeps its status
  in the body the number there) says the code, whether to retry, the health and the portal's penalty. A refusal that retrying cannot fix (the key was
  rejected or expired) stops the connection (`status: error`, health `needs_reauth`); entering a new key (`PATCH`) starts it again. A block with a stated
  penalty waits at least that long; an outage backs off (the interval doubled for each failure in a row, at most six hours, `degraded`), and after eight
  in a row the connection stops. A redirect is never followed.
- **Credentials and addresses.** The key is sealed and write-only (the page shows `ends in ####`). Every address a recipe calls is https on a public host
  (checked when the version is saved and again right before each call, every resolved address public), only the recipe's own host is ever called
  (values can change the path and the query, never the host), redirects are not followed, the answer is read up to 1 MB, 15 seconds at most.
- **Health, last sync and counters** are on the installation: `connection.lastSuccessAt`, `nextPollAt`, `syncedThrough` (the mark), `minSyncIntervalSeconds`,
  `counters`, `lastError`, and the installation's `health`. A poll that finds nothing is a success. **Sync now** (`POST /installations/:id/sync`) moves
  the next poll to the soonest the portal allows and queues the job when that is now; **Test connection** makes one real request over the last hour
  (and so counts against the portal's limit: IndiaMART allows one a key every 5 minutes).

### The portals

Per `docs/specs/lead-portals-feasibility.md` (the verified research) and `docs/runbooks/lead-portal-setup.md` (what each customer does). Migration
`20261024090100_mkt_portal_recipes.sql` publishes them as data. The listing's `maturity` (`stable`, `beta`, `needs_portal_setup`) and `notice` are shown on
the card and the app page. **Nothing here has run against a real portal**: the recipes follow the portals' documents and are tested against fakes of them.

| Listing       | Connector                    | Maturity             | Basis                                                                                                                                          |
| ------------- | ---------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `indiamart`   | `pull` + `push` (path)       | `stable`             | IndiaMART's own Push and CRM listing API documents: payload, key, 7-day window, 5 minutes between calls, 15 minute block, 48 hour deactivation |
| `housing-com` | `pull`, signed               | `needs_portal_setup` | Housing.com's own developer document (a third-party copy, old): fields and signature documented, no lead id, no limits stated                  |
| `tradeindia`  | `pull`                       | `beta`               | integrators only (My Inquiry API); date format and answer shape unconfirmed, no time field                                                     |
| `justdial`    | `push` (path), GET or POST   | `needs_portal_setup` | integrators: JustDial's team adds the URL and delivers with GET; field names proposed                                                          |
| `acres99`     | `push` (path), JSON/form/XML | `needs_portal_setup` | integrators: 99acres's team adds the URL; field names proposed; the customer's 99acres password is never stored                                |
| `magicbricks` | `push` (path)                | `needs_portal_setup` | integrators: MagicBricks's team adds the URL; field names proposed                                                                             |
| `shiksha`     | `push` (path), POST          | `needs_portal_setup` | one integrator: Shiksha's team adds the URL and POSTs; no payload found                                                                        |
| `sulekha`     | `push` (path)                | `needs_portal_setup` | integrators: Sulekha's team adds the URL; no payload found                                                                                     |

Not built, on purpose: Collegedunia, NoBroker, Quikr, CarDekho (no mechanism found), Naukri (candidate ATS, not leads), email-alert parsing (the Email
channel does not exist; JustDial, Shiksha and Sulekha email alerts are documented as not built), and any recipe that would store a portal username and
password (99acres' pull). What each still needs: `docs/backlog.md`, items BL-080 onward.

## Data and tenancy

Platform-owned (no `org_id`, forced RLS, writes only on the privileged path = this operator API): `marketplace_categories`,
`marketplace_apps`, `marketplace_app_versions`, and `market_requests`. A workspace may **read** published listings (and the retired versions
that are their history) and whatever it has installed even after the platform hides or kills it; it can write none of them (a request can be
added as itself, never changed). Tenant tables with forced RLS and composite keys: `workspace_app_installations`, `marketplace_consents`,
`marketplace_connections`, `marketplace_connection_events`, `marketplace_inbound_events`, `market_request_votes`. Secrets (`credentials_enc`, `secret_enc`) are one sealed
CryptoService envelope each, and only hints are in the clear. The public address resolves its tenant through the SECURITY DEFINER function
`marketplace_connection_lookup(public_key)`, which returns two ids and nothing else. Delivery rows hold a delivery id and a status, never lead
data, and are trimmed after 30 days by the worker. Migrations `20261021090000_mkt_catalogue`, `..090100_mkt_installations`,
`..090200_mkt_permissions`, `..090300_mkt_seed`.

**Lead portals** (migrations `20261024090000_mkt_portal_engine`, `..090100_mkt_portal_recipes`): `marketplace_inbound_events` (tenant table, forced RLS,
composite keys, FK to the connection with cascade: one row per stored delivery of an `async` connection; the raw body only until it is processed, status
`received|processing|processed|rejected|failed`, tries and next try, counts; trimmed after 30 days); on `marketplace_connections` the columns `last_poll_at` (the
portal's minimum interval is kept against it), `poll_window_seconds` (a narrower window after one held too much) and `last_poll_leads`; the portal listings
as data (idempotent: only a still-untouched draft is published). Queue `mkt-inbound`.

**Pricing** (migrations `20261023090000_mkt_pricing`, `..090100_mkt_pricing_permissions`): the pricing columns of `marketplace_apps` (platform data,
privileged writes); `plans.marketplace_app_id` (the add-on that sells an app; unique per app); `marketplace_subscriptions` (tenant table, forced RLS,
composite key, one row per `(org, app)`; a workspace **reads** its rows, only the privileged path writes them, exactly as with `workspace_addons`);
`workspace_app_installations.paused_by_subscription`. Two SECURITY DEFINER functions are the only writes a workspace has: `marketplace_start_trial(app)`
(one trial, on a published app that offers one and is on sale, granting a time-limited purchase row) and `marketplace_subscription_set_cancel(app, cancel)`
(its own row, never a comp).

## Events

Written in the transaction of the change (outbox): `marketplace.app.installed`, `.scopes_changed`, `.upgraded`, `.configured`, `.enabled`,
`.disabled`, `.secret_rotated`, `.uninstalled` (carries `dataChoice` and `renewalStopped`), `.killed`. `marketplace.app.enabled` and `.disabled` also carry a
`reason` when a subscription caused them. Subscriptions (aggregate `marketplace_subscriptions`): `marketplace.subscription.started`, `.renewed`,
`.resubscribed`, `.comped`, `.canceled`, `.resumed`, `.lapsed`, each with the subscription uuid, the app, who did it (`by`: `system`, `user:<id>`,
`operator:<id>`) and the source. Audit rows have `module` `marketplace` (installations) or `marketplace_subscriptions`; their deltas name what
changed and never a value or a payment detail.

## Error codes

`MKT_APP_NOT_FOUND`, `MKT_NOT_INSTALLED`, `MKT_ALREADY_INSTALLED`, `MKT_APP_UNAVAILABLE`, `MKT_APP_LOCKED`, `MKT_CONSENT_REQUIRED`,
`MKT_SCOPE_EXCEEDS_INSTALLER`, `MKT_INSTALLATION_KILLED`, `MKT_INSTALLATION_DISABLED`, `MKT_CREDENTIAL_MISSING`, `MKT_NO_CONNECTION`,
`MKT_WEBHOOK_UNAUTHORIZED`, `MKT_WEBHOOK_BAD_PAYLOAD`, `MKT_LEAD_PIPELINE_UNAVAILABLE`, and for the operator `MKT_MANIFEST_INVALID`,
`MKT_RECIPE_INVALID`, `MKT_URL_REFUSED`, `MKT_CONNECTOR_NOT_AVAILABLE`, `MKT_SLUG_TAKEN`, `MKT_CATEGORY_NOT_FOUND`, `MKT_CATEGORY_IN_USE`,
`MKT_VERSION_STATE`, `MKT_VERSION_EXISTS`; for paid apps `MKT_SUBSCRIPTION_REQUIRED`, `MKT_NOT_FOR_SALE`, `MKT_TRIAL_UNAVAILABLE`, `MKT_SUBSCRIPTION_NOT_FOUND`,
`MKT_SUBSCRIPTION_STATE`; checkout answers a refused sale as `PAYGW_PLAN_NOT_PURCHASABLE` with `errors: [{ path: 'marketplace', message: unavailable | not_for_sale | included | paid_ahead }]`. Plus the platform's `PLAN_FEATURE_LOCKED`, `PLAN_LIMIT_REACHED`, `ROW_VERSION_CONFLICT`,
`RATE_LIMITED`.

## Not built yet

Third-party (out-of-process) mini apps, app tokens and OAuth for apps, iframe surfaces, the developer portal, revenue share and payouts for paid
third-party apps, annual billing, automatic card renewal of an app subscription, a wallet payment, usage-based pricing, and ratings (spec phases 3
and 4; backlog BL-070 to BL-075); the OAuth and email-parse connectors; first-party mini app screens. Lead portals: Collegedunia, NoBroker, Quikr, CarDekho and
Naukri (no mechanism found, or not leads), email-alert parsing, a replay tool for stored deliveries, and every portal's verification against a real account
(backlog BL-080 onward).
