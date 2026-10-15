# Catalog and products API (CAT)

The WhatsApp commerce catalog (Meta Cloud or 360dialog), the product list, collections (product sets), review moderation, the stock
ledger and the operator's catalog settings. Contracts: `packages/contracts/src/catalog-products/{catalog,product,collection,review,settings}.ts`.
Module: `apps/api/src/modules/catalog-products`; Meta Graph, 360dialog and the Node bridge sit behind the ports in
`apps/api/src/infra/providers/catalog-products`. Behaviour follows Reference, quirks included (see `docs/threadwise-port/parity/catalog-products.md`).

## Conventions

- Base path `/v2`, bearer token, problem+json errors with a stable `code`. Ids are uuids. Money is `priceMinor` (the major amount x100, an
  integer, for every currency) plus `priceMajor` (plain decimal string) and `priceDisplay` (symbol and grouping); requests send `priceMajor`.
- Every mutation takes an `Idempotency-Key` header (a repeat replays the first answer). Updates of a product take the `rowVersion` read
  (409 `ROW_VERSION_CONFLICT` otherwise); a collection takes it optionally (Reference had no concurrency check; a client that sends it gets one).
- Permission keys (seeded by `20261017090000_cat_permissions`, all `cat.*`, workspace-level, no record scope). The Owner and the Admin preset
  hold all ten; Manager, Agent and Viewer hold none (Reference gates every catalog route to role admin or above, checked in
  `catalog-inbox-settings.e2e.spec.ts`). A custom role can be given any subset.
- Plan flag `wa_storefront` (Reference `access_wa_storefront`, off by default) gates every `/catalog/*` route except `catalog/products*` and
  `catalog/reviews*`, as Reference left the product and review routes open: 422 `PLAN_FEATURE_LOCKED` (reads too).
- Every write has an audit row and an outbox event in the same transaction (events below). Tokens and secrets are never returned, logged
  or audited; the Meta access token is sealed at rest (`access_token_enc`).
- Meta and the Node bridge cannot be reached from a development machine: `CAT_PROVIDER_MODE=fixture` swaps both for an in-memory sandbox
  (tests and local UI). Nothing against live Meta or a paired WhatsApp session is verified (see the parity file).

## Catalog (`/v2/catalog`)

| Method and path               | Key                  | Notes                                                                                                     |
| ----------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /catalog/overview`       | `cat.catalog.read`   | The Setup tab in one read (TW-CAT-001, 007, 008).                                                         |
| `GET /catalog/send-options?q` | `cat.catalog.read`   | Senders, shops, groups, the 500 newest contacts (or matches of `q`), recent sends (TW-CAT-014).           |
| `GET /catalog/activity?limit` | `cat.catalog.read`   | The Activity tab: send log rows, newest first, 50 by default, up to 100 (TW-CAT-016).                     |
| `POST /catalog/connect`       | `cat.catalog.manage` | TW-CAT-002. 200 with the catalog summary.                                                                 |
| `POST /catalog/autodetect`    | `cat.catalog.manage` | TW-CAT-003. Links from the connected WABA number.                                                         |
| `POST /catalog/create`        | `cat.catalog.manage` | Extension (not in Reference). Creates a catalog on Meta under the WABA's business, links and connects it. |
| `POST /catalog/rename`        | `cat.catalog.manage` | Extension. Renames the catalog on Meta, then locally.                                                     |
| `POST /catalog/delete-remote` | `cat.catalog.manage` | Extension. 204. Deletes the catalog on Meta, then disconnects it here.                                    |
| `POST /catalog/disconnect`    | `cat.catalog.manage` | TW-CAT-004. 204; succeeds when there is no catalog.                                                       |
| `POST /catalog/commerce`      | `cat.catalog.manage` | TW-CAT-005. Cart and catalog button, pushed to Meta then stored.                                          |
| `POST /catalog/automation`    | `cat.catalog.manage` | TW-CAT-006. Order acknowledgement and concierge settings.                                                 |
| `POST /catalog/sync`          | `cat.catalog.manage` | TW-CAT-009. One chunk (at most 1000); call again while `hasMore`.                                         |
| `POST /catalog/poll`          | `cat.catalog.manage` | TW-CAT-010. Settles pending batches.                                                                      |
| `POST /catalog/import`        | `cat.catalog.manage` | TW-CAT-011. Up to 2000 products from Meta.                                                                |
| `POST /catalog/send`          | `cat.catalog.send`   | TW-CAT-014, 015. Up to 500 numbers; 200 even when every recipient failed.                                 |

### `GET /catalog/overview`

```json
{
  "catalog": {
    "id": "5b1c…",
    "provider": "meta_cloud",
    "catalogId": "555001",
    "catalogName": "Main",
    "wabaId": "123",
    "phoneNumberId": "100200",
    "isCartEnabled": true,
    "isCatalogVisible": true,
    "lastSyncedAt": null,
    "automation": {
      "orderAckEnabled": true,
      "orderAckPayUrl": null,
      "conciergeEnabled": false,
      "conciergeHeader": null,
      "conciergeMax": 10,
      "conciergeReplyOnEmpty": false,
      "conciergeEmptyText": null
    },
    "rowVersion": 1,
    "createdAt": "2026-10-03T08:00:00.000Z"
  },
  "shops": [{ "id": "…", "shopName": "Acme", "slug": "acme" }],
  "statusBuckets": { "unsynced": 3, "synced": 12, "failed": 1 },
  "totalProducts": 16,
  "products": [/* the 50 most recently changed, ProductResponse */],
  "health": {
    "score": 75,
    "total": 16,
    "noImage": 2,
    "noPrice": 1,
    "errored": 1,
    "flagged": 4,
    "samples": [/* up to 8 */]
  },
  "recentSends": [/* the 5 latest, CatalogSendActivity */],
  "senders": [
    { "key": "baileys:9d2…", "engine": "baileys", "label": "Phone", "phone": "919800000001" }
  ],
  "hasSender": true,
  "sets": 2
}
```

`catalog` is `null` when none is connected; the access token is never part of it.

### `POST /catalog/connect`

```json
{
  "provider": "meta_cloud",
  "catalogId": "555001",
  "catalogName": "Main",
  "phoneNumberId": "100200",
  "wabaId": "123",
  "accessToken": "EAAG…"
}
```

Verified against Meta first; saved (encrypted) only when Meta accepts. Re-connecting a provider replaces its row and keeps the automation settings.
Errors: 422 `CAT_META_REJECTED` (Meta's message, `metaCode`, `metaSubcode`, and the `catalog_management` hint), 422 `CAT_PROVIDER_FAILED` (Meta unreachable),
422 `VALIDATION_FAILED` (token under 20 characters, blank catalog id), 422 `PLAN_FEATURE_LOCKED`. Outbox `catalog.connected`.

### `POST /catalog/autodetect`

No body. 200 with the catalog summary. Uses the stored WABA token (the WABA domain's `wa_provider_configs`): the config's catalog id, else the first catalog Meta
lists for the WABA, else a new catalog created and linked when a business id is known. Errors: 422 `CAT_NO_WABA`, `CAT_WABA_TOKEN_MISSING`, `CAT_NO_CATALOG_LINKED`,
`CAT_META_REJECTED`. Outbox `catalog.connected`.

### `POST /catalog/create`

`{ "name": "My shop", "loginCode": "<optional>" }`. 200 with the catalog summary. Needs a connected WABA number with its business id; creates the catalog under that business, links it to the
WABA, using the token of the catalog login when `loginCode` (the code of Meta's popup for `META_CATALOGUE_CONFIG_ID`) is sent, else the number's own token (usually refused with `(#100) Missing Permission`: it lacks `catalog_management`). `GET /catalog/login-config` (`cat.catalog.manage`) returns `{ ready, appId, configId, graphVersion }` for that popup; `ready` is false until `META_APP_ID`, `META_APP_SECRET` and `META_CATALOGUE_CONFIG_ID` are set.
The catalog is then verified and stored with that token (encrypted), so later syncs use it, and its id is saved on the WABA config. Meta is asked first: a refusal saves nothing. Errors: 422 `CAT_ALREADY_CONNECTED`,
`CAT_NO_WABA`, `CAT_WABA_TOKEN_MISSING`, `CAT_NO_CATALOG_LINKED` (no business id), `CAT_META_REJECTED`. Outbox `catalog.created` and `catalog.connected`.

### `POST /catalog/rename`

`{ "name": "New name" }`. 200 with the summary. Meta first; the stored name changes only when Meta accepts. 404 with no catalog; 422 `CAT_META_REJECTED`. Outbox `catalog.renamed`.

### `POST /catalog/delete-remote`

`{ "confirmCatalogId": "<the connected catalog id>" }`. 204. Irreversible on Meta. A wrong id is 422 `CAT_CONFIRM_MISMATCH` and nothing is deleted. After Meta accepts, the catalog is
disconnected like `POST /catalog/disconnect` (sync state and the collections' Meta set ids are cleared). 404 with no catalog; 422 `CAT_META_REJECTED`.

### `POST /catalog/disconnect`

204. Removes the binding and forgets every product's sync state (retailer ids kept); nothing is removed from Meta. Outbox `catalog.disconnected`.

### `POST /catalog/commerce`

```json
{ "isCatalogVisible": true, "isCartEnabled": true }
```

200 with the catalog summary. A missing flag is false. 404 `NOT_FOUND` with no catalog; 422 `CAT_NO_PHONE_NUMBER`; 422 `CAT_META_REJECTED` (stored flags unchanged).
Outbox `catalog.commerce_updated`.

### `POST /catalog/automation`

```json
{
  "orderAckEnabled": true,
  "orderAckPayUrl": "https://pay.example/c",
  "conciergeEnabled": true,
  "conciergeHeader": "Top picks",
  "conciergeMax": 12,
  "conciergeReplyOnEmpty": true,
  "conciergeEmptyText": "Nothing matched"
}
```

`conciergeMax` 1..30 (default 10), header max 60, empty text max 1024, pay URL a URL max 500. A missing flag is false, a blank text null; keys with no control
(concierge footer, acknowledgement template id) are kept. 404 with no catalog. Outbox `catalog.automation_updated`.

### `POST /catalog/sync`, `/poll`, `/import`

```json
// POST /catalog/sync  (productIds optional: exactly those that are active; without: never pushed or failed)
{ "productIds": ["8f1…", "2ab…"] }
// 200
{ "pushed": 2, "hasMore": false, "totalPending": 2, "totalSynced": 10, "totalFailed": 0 }
// POST /catalog/poll  -> 200
{ "pending": 0, "synced": 2, "failed": 0 }
// POST /catalog/import -> 200
{ "imported": 5, "updated": 7, "skipped": 1, "total": 13 }
```

Errors: 422 `CAT_NOT_CONNECTED`; sync and poll answer 502 `CAT_META_REJECTED` or `CAT_PROVIDER_FAILED` when Meta refuses or cannot be asked (a refused sync marks
the chunk `failed` with Meta's message); import answers Meta's own error as 422. Outbox `catalog.products_pushed`, `catalog.products_imported`. The same push and
settle run hourly in the worker (`CatalogResyncSweepService`, `CAT_RESYNC_INTERVAL_MS`, TW-CAT-013) and after a product save (TW-CAT-012, event
`catalog.product_changed`).

### `POST /catalog/send`

```json
{ "manualNumbers": "919800000001 +919800000002; 919800000003", "contactIds": [], "groupIds": [], "sender": "baileys:9d2…",
  "mode": "mpm", "header": "Our catalog", "body": "Tap a product", "footer": "Reply STOP to opt out", "productIds": ["8f1…", "2ab…"] }
// 200 (also when every recipient failed: ok false, no message key)
{ "ok": true, "sent": 2, "failed": 1, "total": 3, "errors": ["919800000003: (#131047) Re-engagement message"] }
```

`mode` is `spm` (single product: the first one only), `mpm` (product list, sections by category, at most 10 sections and 30 items) or `link` (plain text with
the catalog link). Limits: body 1024, header 60, footer 60, 30 products, 500 recipients; pasted numbers split on whitespace, comma and semicolon, non-digits dropped,
8 digits or more kept, de-duplicated. A stale or foreign product id is silently dropped; the order picked is kept. A workspace with a Meta catalog always sends through Meta
(whatever the sender); without one a carousel (or the shop link) goes through a connected device and the Node bridge. Up to 5 recipients are sent at a time; each attempt is
one `cat_catalog_sends` row with an audit row. Errors: 422 `CAT_NO_RECIPIENTS`, `CAT_TOO_MANY_RECIPIENTS`, `CAT_NO_PRODUCTS` (spm and mpm), `CAT_NO_SENDER` (no catalog and no
connected device), `CAT_NO_SHOP` (link mode on the bridge without a shop).

Each sent message is mirrored into the recipient's inbox thread (below). The plan-first message meter is not applied yet (blocked on wallet-message-billing, see Seams).

## Collections (`/v2/catalog/collections`, plan-gated)

| Method and path                   | Key                      | Notes                                                                                  |
| --------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `GET /catalog/collections`        | `cat.catalog.read`       | `{ data, pickProducts (first 300 active by name), totalProducts }`, newest first.      |
| `POST /catalog/collections`       | `cat.collections.manage` | 201. TW-CAT-017.                                                                       |
| `PUT /catalog/collections/:id`    | `cat.collections.manage` | Replaces the form; slug regenerated only when the name changed. Optional `rowVersion`. |
| `DELETE /catalog/collections/:id` | `cat.collections.manage` | 204; the products are untouched; deleting a gone one succeeds.                         |

```json
// POST body
{ "name": "Summer", "description": "Light things", "productIds": ["8f1…", "2ab…"], "isActive": true }
// 201
{ "id": "…", "name": "Summer", "slug": "summer", "description": "Light things", "isActive": true, "productCount": 2,
  "products": [{ "id": "8f1…", "name": "Shirt", "sku": "SH", "imageUrl": null, "priceDisplay": "₹ 1,299.50", "retailerId": "SH", "active": true }],
  "rowVersion": 1, "createdAt": "…", "updatedAt": "…" }
```

1 to 30 product ids; names max 120, description max 500. Ids that are not this workspace's are dropped and the submitted order is kept; none left is 422
`CAT_COLLECTION_PRODUCTS_INVALID`. 409 `ROW_VERSION_CONFLICT` for a stale `rowVersion`. Outbox `product_set.created|updated|deleted`. Sending a collection is a
normal `POST /catalog/send` with `mode: "mpm"` and its product ids (TW-CAT-018).

## Products (`/v2/catalog/products`, not plan-gated)

| Method and path                                     | Key                   | Notes                                                                                                                       |
| --------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /catalog/products?q&limit&cursor&includeTotal` | `cat.products.read`   | TW-CAT-019. Sort order then newest; 25 per page, up to 100; `q` matches name or SKU; `meta.total` with `includeTotal=true`. |
| `GET /catalog/products/picker?q&shopId`             | `cat.products.read`   | TW-CAT-024, 031. The inbox Catalog modal's list (below).                                                                    |
| `POST /catalog/products`                            | `cat.products.create` | TW-CAT-020. 201.                                                                                                            |
| `GET /catalog/products/:id`                         | `cat.products.read`   | One product.                                                                                                                |
| `PUT /catalog/products/:id`                         | `cat.products.update` | Whole form plus `rowVersion`.                                                                                               |
| `DELETE /catalog/products/:id`                      | `cat.products.delete` | TW-CAT-021. 204. Hard delete (Reference soft-deleted); reviews and stock holds go with it.                                  |
| `GET /catalog/products/:id/share-links`             | `cat.products.read`   | TW-CAT-022. `{ publicUrl, waLink, product: { id, name, image } }`; null link parts without a shop or sender.                |
| `POST /catalog/products/:id/send`                   | `cat.catalog.send`    | TW-CAT-023. `{ "phone": "+919800000001" }` -> `{ "message": "Product sent to 919800000001." }`.                             |

```json
// POST /catalog/products
{ "name": "Shirt", "sku": "SH-1", "priceMajor": "1299.50", "comparePriceMajor": "1599", "currencyCode": "INR", "status": "active", "inStock": true,
  "stockQty": 20, "category": "Tops", "tags": ["summer"], "aliases": ["tee"], "imageUrl": "https://cdn.example/s.jpg", "galleryUrls": [] }
// 201 (ProductResponse, abridged)
{ "id": "8f1…", "sku": "SH-1", "name": "Shirt", "slug": "shirt", "priceMinor": 129950, "priceMajor": "1299.5", "priceDisplay": "₹ 1,299.50",
  "comparePriceMinor": 159900, "onSale": true, "currencyCode": "INR", "stockQty": 20, "reservedQty": 0, "availableQty": 20,
  "status": "active", "availability": "in stock", "effectiveAvailability": "in stock", "retailerId": "SH-1",
  "metaSyncStatus": "pending", "metaLastError": null, "rowVersion": 1, "createdAt": "…", "updatedAt": "…" }
```

Rules: name max 191, SKU max 96, description max 2000, price up to 1,000,000 (major), gallery at most 12, currency one of the supported list, status
`active|draft|archived`. The slug comes from the name, is unique per workspace and never changes. With a Meta catalog connected, an active product is pushed after the save
and a catalog-relevant edit re-pushes it; a Meta failure never fails the save (the product shows `failed` and its message). Outbox `product.created|updated|deleted` and
`catalog.product_changed`. Errors: 404 `NOT_FOUND` (also another workspace's id), 409 `ROW_VERSION_CONFLICT`, 422 `VALIDATION_FAILED`.

`POST /catalog/products/:id/send`: the phone needs 7 digits or more (422 `VALIDATION_FAILED`, "Enter a valid WhatsApp number with country code."); goes through the first
connected device on the Node bridge as an image with a caption (name, price, the first 300 characters of the description, the shop link), whatever the workspace engine
(QUIRK as Reference), needs no Meta catalog. 422 `CAT_NO_SENDER`, 502 `CAT_SEND_FAILED` ("Could not deliver: ..."). Leaves no row in the Activity log (as Reference) and is mirrored
into the thread as a plain message marked `meta.source = product_share`.

### `GET /catalog/products/picker`

```json
{
  "products": [
    {
      "id": "8f1…",
      "name": "Shirt",
      "sku": "SH",
      "imageUrl": null,
      "category": "Tops",
      "priceMinor": 129950,
      "priceDisplay": "₹ 1,299.50",
      "currency": "INR",
      "retailerId": "SH",
      "synced": true,
      "storefrontId": null
    }
  ]
}
```

Active and in-stock products only, ordered like the list, at most 120, `q` over name or SKU, `shopId` keeps that shop's products and the ones that belong to no shop.
This is the endpoint of the team-inbox "Catalog" modal and of the chat and Send pickers. QUIRK kept: Reference answered the picker to admins only (an agent saw "Failed to load"),
so the key is `cat.products.read`, which only the Owner and Admin presets hold; a deployment that wants agents to pick grants them that key.

## Reviews (`/v2/catalog/reviews`, not plan-gated)

| Method and path                            | Key                    | Notes                                                                                                             |
| ------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /catalog/reviews?status&limit&cursor` | `cat.reviews.read`     | `status` pending, approved or rejected (anything else reads as pending), 30 per page, `meta.counts` for the tabs. |
| `PUT /catalog/reviews/:id`                 | `cat.reviews.moderate` | `{ "status": "approved" }`; any status to any other.                                                              |
| `DELETE /catalog/reviews/:id`              | `cat.reviews.moderate` | 204; a gone review succeeds (as Reference).                                                                       |

Reviews are posted by the public shop (storefront-builder), not here. Outbox `product_review.moderated|deleted`.

## Operator settings (`/v2/platform/settings/catalog`, platform operator)

TW-CAT-030 (Reference `admin/settings/catalog`). Operator guard (IP allowlist and MFA); every operator reads, only a super admin saves.

```json
// GET -> 200
{ "catalogEnabled": true, "commerceEnabled": false, "graphApiVersion": "v23.0", "metaAppId": "", "metaAppSecretSet": false, "defaultCurrency": "USD",
  "usage": { "workspacesConnected": 4, "productsSynced": 120, "messagesSent": 310 }, "rowVersion": 0 }
// PATCH body (every field optional except rowVersion; a field not sent keeps its value)
{ "rowVersion": 0, "graphApiVersion": "v24.0", "metaAppId": "12345", "metaAppSecret": "…", "defaultCurrency": "USD", "catalogEnabled": true, "commerceEnabled": false }
```

Stored as the document `cat.settings` (and the sealed secret `cat.settings.metaAppSecret`) in the platform settings store. 409 `ROW_VERSION_CONFLICT`; 422
`VALIDATION_FAILED` for a version that is not `vNN.N` (`24`, `v24`), a currency that is not 3 letters, an app id over 60 or a secret over 120; a blank secret keeps the saved
one; a blank Graph version clears it so the default applies (Reference saved the blank and broke every Graph URL: a documented fix). Audit event
`platform.catalog_settings_updated` lists the field names only. Only the Graph version has a reader: the Meta adapter asks for it on every call (saved value, else
`CAT_GRAPH_API_VERSION`, else `v23.0`). The other fields are stored and shown and read by nothing, as in Reference (QUIRK). The three tiles are real counts (Reference queried tables
that do not exist and always showed 0 for two). The Baileys address is not a catalog setting: Reference's `baileys_server_url` is the Node bridge page's address, so the bridge
adapter reads the address and token of `/v2/platform/node-bridge` (`NodeBridgeSettingsService.target()`), falling back to `BAILEYS_SERVER_URL` / `BAILEYS_SERVER_TOKEN`.

## Inbox mirror (TW-CAT-015 rule 13, 023, 031)

After the provider accepts a catalog message or a product share, it is shown in the recipient's thread through the chat-conversations facade (`recordOutbound`):

- Thread: the conversation of that number (peer key = digits) on a WhatsApp channel (`kind = whatsapp_cloud`), a connected one first; with none, one is created on the oldest
  connected WhatsApp channel with its lifecycle record; with no WhatsApp channel at all nothing is mirrored (the send log still has the row).
- Row: outbound, sent, `sender_kind = agent` with the sending user, idempotent by the provider message id (ledger). A catalog send is `kind = interactive` with
  `meta = { type: "catalog", mode, provider, wa_message_id, products: [{ id, name, image_url, price_minor, currency, price_display, retailer_id }] }`. ARCHITECTURE-FORCED:
  `messages.kind` has no `catalog` value. The body is the typed message, else the product name ("X and 2 more"), else "Catalog link" (Reference wrote an empty body; intended).
  A product share is `kind = text` with `meta.source = "product_share"`.
- A mirror failure never fails the send.

## Events

| Event                                                                         | When                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `catalog.connected` / `catalog.disconnected`                                  | connect, autodetect / disconnect                        |
| `catalog.commerce_updated`, `catalog.automation_updated`                      | the two settings saves                                  |
| `catalog.products_pushed` (batch handle, counts), `catalog.products_imported` | sync (also the hourly sweep) and import                 |
| `catalog.product_changed`                                                     | a catalog-relevant product write (drives the auto push) |
| `product.created`, `product.updated`, `product.deleted`                       | product writes                                          |
| `product_set.created`, `product_set.updated`, `product_set.deleted`           | collection writes                                       |
| `catalog.created`, `catalog.renamed`                                          | create / rename on Meta                                 |
| `product_set.pushed`, `product_set.unpushed`                                  | collection pushed to / removed from Meta as a set       |
| `product_review.moderated`, `product_review.deleted`                          | review moderation                                       |

## Error codes

`CAT_NOT_CONNECTED`, `CAT_META_REJECTED` (Meta's message, `metaCode`, `metaSubcode` in `details`), `CAT_PROVIDER_FAILED`, `CAT_NO_WABA`, `CAT_WABA_TOKEN_MISSING`,
`CAT_NO_CATALOG_LINKED`, `CAT_NO_PHONE_NUMBER`, `CAT_NO_RECIPIENTS`, `CAT_TOO_MANY_RECIPIENTS`, `CAT_NO_PRODUCTS`, `CAT_NO_SENDER`, `CAT_NO_SHOP`, `CAT_SEND_FAILED`,
`CAT_COLLECTION_PRODUCTS_INVALID`, `CAT_ALREADY_CONNECTED`, `CAT_CONFIRM_MISMATCH`, `CAT_SET_NOT_SYNCABLE`; shared: `PLAN_FEATURE_LOCKED` (422), `VALIDATION_FAILED` (422), `NOT_FOUND` (404), `ROW_VERSION_CONFLICT` (409), `FORBIDDEN` (403, missing key).

## Seams other domains use

- `StorefrontProductsReader` (storefront-builder): products and reviews for the public shop. `InventoryService`: hold, commit, release stock by ref, and the expired-hold sweep
  (TW-CAT-025, worker). `CatalogSyncService`: ask for a push of a product another domain wrote. `CatalogSendService`: send a catalog message to given numbers; the team-inbox
  conversation's Catalog modal calls it for one number (TW-CAT-031, the inbox owns that route and its `reply` ability check).
- Inbound automations (not wired, see below): `CatalogConciergeService.handleInbound(orgId, phone, text)` (TW-CAT-028) and `CatalogOrderAckService.acknowledge(order)` (TW-CAT-029).

## Not wired yet (and why)

| Item                                                                  | State                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concierge (TW-CAT-028) and order acknowledgement (TW-CAT-029) callers | There is no inbound hook to bind: `WABA_INBOUND_SINK` is a single-binding seam the inbox must own (today `LoggingInboundSink`), the chat ingest emits no per-message outbox event (only `conversation.created                                                                    | reopened`), and there is no checkout-orders module that captures a WhatsApp cart. The services are exported and covered by tests. |
| Plan-first message billing (monthly allowance, then a wallet credit)  | No `wallet-message-billing` module exists yet. Each catalog message is sent unmetered; the seam is the per-recipient loop of `CatalogSendService.send` (campaigns keeps its own `CAMPAIGN_BILLING` seam for the same reason). Reference answered 402 `plan_limit` per recipient. |
| Platform emergency send halt on catalog sends                         | Reference's `SendGate` guards its dispatchers, which the catalog services bypass (they call Meta directly), so the halt does not stop a catalog message there either (QUIRK kept; a decision for the domain owner).                                                              |
| Image upload on the product form                                      | Needs the storage domain; products take `imageUrl` and `galleryUrls`.                                                                                                                                                                                                            |

## Collections as Meta product sets (extension)

| Route                                  | Permission               | What                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /catalog/collections/:id/meta`   | `cat.collections.manage` | Creates the product set on Meta (or updates the one pushed before) from the active members' retailer ids. Returns the collection with `metaSetId`. 422 `CAT_NOT_CONNECTED`, `CAT_SET_NOT_SYNCABLE`, `CAT_META_REJECTED`. |
| `DELETE /catalog/collections/:id/meta` | `cat.collections.manage` | Deletes the set on Meta and clears `metaSetId`; the collection stays. A set already gone on Meta counts as removed.                                                                                                      |

Deleting a collection also deletes its Meta set (best effort, logged on failure). Disconnecting the catalog clears every `metaSetId`.
