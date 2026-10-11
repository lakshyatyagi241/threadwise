# Google Sheets add-on API (EXT)

The API behind the Google Sheets add-on: a member's personal Sheets key, the setup page's data, and the routes the Apps Script client calls with that key. Inventory:
[inventory/chrome-extension-sheets-addon.md](../threadwise-port/inventory/chrome-extension-sheets-addon.md). Parity evidence:
[parity/chrome-extension-sheets-addon.md](../threadwise-port/parity/chrome-extension-sheets-addon.md). Source of the shapes: `packages/contracts/src/chrome-extension-sheets-addon/`.

Two audiences read this page. The web page (setup screen) needs sections 1, 2 and 4. The Apps Script client needs sections 1, 3, 5 and 6.

## 1. Overview

There are two route families:

| Family                 | Base                   | Caller                        | Auth                                     | Casing                         |
| ---------------------- | ---------------------- | ----------------------------- | ---------------------------------------- | ------------------------------ |
| Member's key and setup | `/v2/extension/sheets` | the web app, signed-in member | the member's session (`Bearer <JWT>`)    | camelCase, problem+json errors |
| The add-on API         | `/api/v1/sheets-addon` | the Google Apps Script client | the member's Sheets key (`Bearer <key>`) | snake_case, `{ ok }` envelope  |

The add-on routes are version-neutral (no `/v2` in front), at the same path Reference's add-on uses.

How it fits together:

1. An admin installs the **Google Sheets add-on** from the Marketplace once for the workspace (listing slug `google-sheets`, free, connector type `client`). The install consents to the scopes
   `contacts.read`, `contacts.write`, `catalog.read`, `catalog.write`. Until it is installed neither a key nor the add-on API works (`EXT_APP_NOT_INSTALLED`).
2. Each member whose role holds the permission `app.google-sheets.use` creates **their own key** (section 2). The key is the whole identity of the add-on: it carries no session.
3. Every add-on call **runs as the key's owner**: their workspace, their id, their live permissions and record scope. Rows the call writes are owned by and audited as that member. A key can
   do something only when the install consented to its scope **and** the member's role holds the permission behind it.
4. Identifiers are uuids, never numbers. Timestamps are ISO 8601 in UTC.

### What the add-on needs from a member's role

| Capability (in `health.can`) | Consent scope    | Role permissions                                                                                    |
| ---------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `read_contacts`              | `contacts.read`  | `record.contacts.read` (its record scope applies: `own` and `team` limit what a pull returns)       |
| `write_contacts`             | `contacts.write` | `record.contacts.create` or `record.contacts.update` (each row is checked against the one it needs) |
| `read_catalog`               | `catalog.read`   | `cat.products.read` and `store.storefront.read`                                                     |
| `write_catalog`              | `catalog.write`  | `store.shops.manage` and (`cat.products.create` or `cat.products.update`; each row is checked)      |

Using the add-on at all needs `app.google-sheets.use` (granted to the Admin preset when the add-on is installed; an admin grants it to other roles in the Roles editor).
Plan feature: `marketplace` must be on for the workspace.

## 2. The member's key and the setup page (web app)

All routes need a signed-in staff session. They act on the caller alone; there is no member id in any path.

### `POST /v2/extension/sheets/key` — create or replace my key

Permission `app.google-sheets.use`, plan feature `marketplace`, the add-on installed. Not idempotent and not replayable: every call makes a new key and the previous one stops working at once.
The answer carries `Cache-Control: no-store`. **The `key` field is the only time the secret is ever returned.**

Response `201`:

```json
{
  "active": true,
  "suffix": "89abcdef",
  "masked": "wsn_live_••••••••89abcdef",
  "createdAt": "2026-10-07T09:30:12.411Z",
  "lastUsedAt": null,
  "key": "wsn_live_0123456789abcdef0123456789abcdef",
  "rotated": false
}
```

`suffix` is always the last 8 characters of `key` (the values above are only an example).

`rotated` is true when an active key was replaced. Errors: `403 EXT_APP_NOT_INSTALLED`, `403 FORBIDDEN` (role lacks the permission), `422 PLAN_FEATURE_LOCKED`.

### `GET /v2/extension/sheets/key` — my key's status

No permission needed beyond being signed in. Never returns the secret.

```json
{
  "active": true,
  "suffix": "5e6f7a8b",
  "masked": "wsn_live_••••••••5e6f7a8b",
  "createdAt": "2026-10-07T09:30:12.411Z",
  "lastUsedAt": "2026-10-07T09:41:03.020Z"
}
```

With no key: `{ "active": false, "suffix": null, "masked": null, "createdAt": null, "lastUsedAt": null }`. `lastUsedAt` is written at most once a minute.

### `DELETE /v2/extension/sheets/key` — revoke my key

No permission needed (a member can always switch their own key off, even after the add-on is uninstalled). Idempotent. Response `200` with the inactive status above. The add-on's next call with the old key is `401 EXT_KEY_INVALID`.

### `GET /v2/extension/sheets/overview` — everything the setup page draws

Permission `app.google-sheets.use`, plan feature `marketplace`.

```json
{
  "installed": true,
  "blockers": [],
  "marketplaceUrl": "https://workspace.google.com/marketplace/",
  "apiBase": "https://api.example.com",
  "key": {
    "active": true,
    "suffix": "5e6f7a8b",
    "masked": "wsn_live_••••••••5e6f7a8b",
    "createdAt": "2026-10-07T09:30:12.411Z",
    "lastUsedAt": null
  },
  "can": {
    "readContacts": true,
    "writeContacts": true,
    "readCatalog": true,
    "writeCatalog": false
  },
  "files": [
    {
      "name": "Code.gs",
      "description": "Server side of the add-on: the menu, reading the sheet and calling the API.",
      "available": true,
      "sizeBytes": 18211,
      "contentType": "text/javascript"
    },
    {
      "name": "Dialog.html",
      "description": "The sync window that opens inside the sheet.",
      "available": false,
      "sizeBytes": 0,
      "contentType": "text/html"
    }
  ],
  "shops": [
    {
      "id": "6f1c…",
      "shopName": "Corner Store",
      "slug": "corner-store",
      "currency": "INR",
      "enabled": true,
      "themeKey": "aurora",
      "customDomain": null,
      "publicUrl": "https://app.example.com/s/corner-store",
      "updatedAt": "2026-10-07T09:12:00.000Z"
    }
  ],
  "productCount": 14,
  "recentProducts": [
    {
      "id": "a9b2…",
      "name": "Blue Tee",
      "priceMajor": "499",
      "currencyCode": "INR",
      "imageUrl": null,
      "createdAt": "2026-10-07T09:12:00.000Z"
    }
  ]
}
```

- `installed: false` comes with `blockers: ["not_installed"]` and every `can` flag false. The page should say an admin must install the add-on and must not offer "Generate key".
- `can` is the member's role intersected with what the install consented to.
- `shops`, `productCount` and `recentProducts` are empty/zero when the member's role cannot read the catalog.
- `files` has exactly six entries, always in this order: `Code.gs`, `Dialog.html`, `Settings.html`, `Help.html`, `appsscript.json`, `README.md`. `available: false` until the add-on source is on the server.
- `apiBase` is the address the add-on calls (no trailing slash, no path).

### `GET /v2/extension/sheets/files` and `GET /v2/extension/sheets/files/:name`

Permission `app.google-sheets.use`. The list is `{ "files": [...] }` (same entries as in the overview). The download answers the file as an attachment
(`Content-Disposition: attachment; filename="Code.gs"`, `X-Content-Type-Options: nosniff`, `Content-Type: <type>; charset=UTF-8`). `Code.gs` has its `CRM_BASE` constant rewritten to `apiBase`.
`404 NOT_FOUND` for any other name or a file that is not on the server yet.

## 3. The add-on API (Apps Script client)

Base URL: `<apiBase>/api/v1/sheets-addon`. Every request sends:

```http
Authorization: Bearer wsn_live_0123456789abcdef0123456789abcdef
Content-Type: application/json
```

Only the `Authorization` header is read (not `X-Api-Key`, not a query string). In Apps Script use `UrlFetchApp.fetch(url, { muteHttpExceptions: true, ... })` and read `getResponseCode()` and the JSON body: every answer, success or failure, is JSON.

### Envelope

Success: HTTP 200 and `{ "ok": true, ... }`. Failure: the HTTP status below and

```json
{
  "ok": false,
  "error": "The key is missing, revoked or replaced. Create a new one in your account.",
  "code": "EXT_KEY_INVALID",
  "details": { "rows": ["Send at least one row"] },
  "requestId": "01J9…"
}
```

`error` is a sentence the add-on can show to the member as it is. `code` is stable; branch on it, never on the sentence. `details` (only on a 422) is `{ field: [messages] }` keyed by the field the client sent. `requestId` is for support.

A **partial failure is not an HTTP failure**: when a sync's request is valid, the answer is 200 and bad rows are reported inside it (section 5). The client must read `failed` and `results`.

### Errors the client must handle

| HTTP | `code`                   | Meaning                                                                                                            | What the add-on should do                         |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 401  | `EXT_KEY_MISSING`        | No `Authorization: Bearer` header                                                                                  | Open Settings and ask for the key                 |
| 401  | `EXT_KEY_INVALID`        | Malformed, unknown, revoked or replaced key (all the same answer on purpose)                                       | Ask the member to create a new key and paste it   |
| 403  | `EXT_APP_NOT_INSTALLED`  | The workspace has not installed the add-on, or an admin disabled it                                                | Tell the member to ask an admin to install it     |
| 403  | `EXT_SCOPE_NOT_GRANTED`  | The install did not consent to what the call needs                                                                 | Hide that menu action; tell an admin to reinstall |
| 403  | `FORBIDDEN`              | The member's role does not allow it (also: role lacks `app.google-sheets.use`)                                     | Show `error`                                      |
| 403  | `AUTH_ACCOUNT_SUSPENDED` | The member's account is suspended                                                                                  | Show `error`                                      |
| 403  | `WSP_ORG_SUSPENDED`      | The workspace is suspended                                                                                         | Show `error`                                      |
| 422  | `PLAN_FEATURE_LOCKED`    | The plan has no Marketplace                                                                                        | Show `error`                                      |
| 413  | `PAYLOAD_TOO_LARGE`      | Body over 2 MiB                                                                                                    | Send fewer rows per call                          |
| 422  | `VALIDATION_FAILED`      | The request itself is wrong (missing shop name, 0 or more than 500 rows, bad currency, bad cursor)                 | Show `error`, highlight `details` fields          |
| 429  | `RATE_LIMITED`           | Too many calls (120 a minute per key, never above the plan's API ceiling) or too many wrong keys from this address | Wait `Retry-After` seconds (header) and retry     |

Rate-limit headers on every answer once a key is accepted: `X-RateLimit-Limit`, `X-RateLimit-Remaining`; on 429 also `Retry-After` (seconds).

### `GET /health`

Proves the key works. Call it when the member presses Save in Settings, and on opening the add-on, then use `can` to decide which menu items to show.

```json
{
  "ok": true,
  "user": {
    "id": "5fa1939b-f83f-4d10-8bcb-0aa5f74d49eb",
    "name": "Admin Person",
    "email": "admin@example.com"
  },
  "workspace": { "id": "d641fd3b-5ac8-4571-9978-bebf9d6840c5", "name": "Acme Foods" },
  "can": {
    "read_contacts": true,
    "write_contacts": true,
    "read_catalog": true,
    "write_catalog": true
  },
  "limits": { "max_rows": 500, "max_pull": 500 },
  "api_version": 1,
  "server_time": "2026-10-07T14:22:38.859Z"
}
```

Differences from Reference's health: `workspace` is an object (Reference: a bare number), and `can`, `limits`, `api_version` are new.

### `GET /shops`

Needs `read_catalog`.

```json
{
  "ok": true,
  "shops": [
    {
      "id": "6f1c0f0a-6f5f-4c55-9a39-b6c1d6a0c001",
      "shop_name": "Corner Store",
      "slug": "corner-store",
      "currency": "INR",
      "enabled": true,
      "theme_key": "aurora",
      "custom_domain": null,
      "public_url": "https://app.example.com/s/corner-store",
      "product_count": 14,
      "updated_at": "2026-10-07T09:12:00.000Z"
    }
  ],
  "workspace": "d641fd3b-5ac8-4571-9978-bebf9d6840c5",
  "product_count_total": 14
}
```

Newest-changed first. `product_count` is workspace-wide on every shop (products are not tied to one shop).

### `POST /sync` — a shop and its products

Needs `write_catalog`. The sheet's columns map to a product row (`name`, `category`, `description`, `image_url`, `price`, `sku`, `stock`, `active`).

Request:

```json
{
  "shop_id": "6f1c0f0a-6f5f-4c55-9a39-b6c1d6a0c001",
  "shop_name": "Corner Store",
  "description": "Everything for the corner",
  "currency": "INR",
  "theme_key": "aurora",
  "products": [
    {
      "ref": 2,
      "name": "Blue Tee",
      "category": "Tops",
      "description": "Soft cotton",
      "image_url": "https://img.example.com/tee.jpg",
      "price": 499,
      "sku": "TEE-1",
      "stock": 10,
      "active": true
    },
    { "ref": 3, "name": "Red Cap", "price": "19.99", "sku": "CAP-1", "stock": "", "active": "no" },
    { "ref": 4, "name": "No price" }
  ]
}
```

| Field         | Rules                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shop_id`     | optional uuid. Matches a shop of this workspace: that shop is updated. Absent or not a shop of this workspace: **a new shop is created** (Reference behaviour). Keep the returned id and send it next time. |
| `shop_name`   | required, 1 to 191 characters                                                                                                                                                                               |
| `description` | optional, up to 2000; becomes the shop's hero text                                                                                                                                                          |
| `currency`    | optional, a 3-letter code from the product currency list (INR, USD, EUR, GBP, AED, ...), any case; absent keeps the shop's own (new shop: INR). Products always take the shop's currency                    |
| `theme_key`   | optional, one of the storefront themes; absent keeps the shop's (new shop: default)                                                                                                                         |
| `products`    | required, 1 to 500 items; each is read on its own                                                                                                                                                           |

Product row:

| Field         | Rules                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`         | optional string or integer; echoed back in `results` (use the sheet row number)                                                           |
| `name`        | required, 1 to 191. Matching: by `sku` first, else by name (any case)                                                                     |
| `price`       | required, number or numeric text, 0 to 1,000,000; rounded to 2 decimals                                                                   |
| `sku`         | optional, up to 96                                                                                                                        |
| `category`    | optional, up to 96                                                                                                                        |
| `description` | optional, up to 2000                                                                                                                      |
| `image_url`   | optional, a full web address up to 1024; empty cell = absent                                                                              |
| `stock`       | a whole number sets the count; **empty cell or `null` = unlimited**; leave the key out to keep the stored count                           |
| `active`      | `true/false`, `yes/no`, `1/0`. `false` makes it a draft and out of stock. **Absent means active** (also re-activates an existing product) |

A field a row leaves out (or leaves blank) keeps the stored value, except `price` and `name`, which always take the sheet's.

Response `200`:

```json
{
  "ok": true,
  "shop": {
    "id": "6f1c0f0a-6f5f-4c55-9a39-b6c1d6a0c001",
    "shop_name": "Corner Store",
    "slug": "corner-store",
    "currency": "INR",
    "public_url": "https://app.example.com/s/corner-store",
    "created": false
  },
  "products": {
    "created": 1,
    "updated": 1,
    "unchanged": 0,
    "failed": 1,
    "total": 2,
    "results": [
      { "index": 0, "ref": 2, "status": "updated", "id": "a9b2c1d0-1111-4222-8333-444455556666" },
      { "index": 1, "ref": 3, "status": "created", "id": "a9b2c1d0-1111-4222-8333-444455556667" },
      {
        "index": 2,
        "ref": 4,
        "status": "failed",
        "error": { "code": "VALIDATION_FAILED", "message": "Required", "field": "price" }
      }
    ]
  }
}
```

`total` is `created + updated` (Reference's number). A request-level problem (no shop name, no products, more than 500, bad `currency`/`theme_key`/`shop_id`) is a `422` and **nothing is written**. Once the request is valid the shop is saved first,
then each product row; one bad row never stops the others, and a failing batch does not undo the shop.

### `GET /contacts` — pull contacts into the sheet

Needs `read_contacts`. Query: `limit` (1 to 500, default 200), `cursor` (the previous page's `next_cursor`), `q` (search over name, email, phone digits). Newest first; archived contacts are not returned.

```json
{
  "ok": true,
  "contacts": [
    {
      "id": "c3f6b2aa-0000-4000-8000-000000000001",
      "name": "Ann Lee",
      "first_name": "Ann",
      "last_name": "Lee",
      "email": "ann@example.com",
      "phone": "+919876543210",
      "source": "google_sheets",
      "is_unsubscribed": false,
      "attributes": { "city": "Pune" },
      "created_at": "2026-10-07T09:00:00.000Z",
      "updated_at": "2026-10-07T09:00:00.000Z"
    }
  ],
  "next_cursor": "eyJjIjoi…",
  "has_more": true
}
```

Loop: call without `cursor`, then with `next_cursor` while `has_more` is true. A member whose role has record scope `own` or `team` only ever sees those contacts. A bad cursor or `limit` over 500 is `422`.

### `POST /contacts/sync` — bulk upsert contacts

Needs `write_contacts`. Request:

```json
{
  "default_country_code": "+91",
  "rows": [
    {
      "ref": 2,
      "name": "Ann Lee",
      "email": "Ann@Example.com",
      "phone": 9876543210,
      "attributes": { "city": "Pune" }
    },
    {
      "ref": 3,
      "phone": "+1 415 555 0101",
      "first_name": "Raj",
      "source": "webinar",
      "is_unsubscribed": "no"
    },
    { "ref": 4, "name": "No way to reach" }
  ]
}
```

| Field                             | Rules                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `default_country_code`            | optional dial code ("+91", "91") for a phone that does not carry its own; per-row `country_code` wins                     |
| `rows`                            | required, 1 to 500; each is read on its own                                                                               |
| `ref`                             | optional string or integer, echoed back                                                                                   |
| `email`                           | optional; lower-cased; must be an email address                                                                           |
| `phone`                           | optional text or number; made international (E.164). A number with no country code and no default is refused for that row |
| `name`, `first_name`, `last_name` | optional text (255)                                                                                                       |
| `source`                          | optional (128); new contacts default to `google_sheets`; an existing contact's source changes only when the row gives one |
| `is_unsubscribed`                 | optional `true/false`, `yes/no`, `1/0`                                                                                    |
| `attributes`                      | optional object of the workspace's custom contact properties by key; blank/null values are ignored                        |

Every row needs an `email` or a `phone`. **A blank cell is "not given" and never clears a stored value.** Matching: the contact that already holds the row's email, else its phone. Matched: only what differs is updated (nothing differs: `unchanged`).
Not matched: created, owned by the key's owner. A row whose email belongs to one contact and phone to another fails with `CONFLICT` and changes neither.

Response `200`:

```json
{
  "ok": true,
  "summary": { "created": 1, "updated": 0, "unchanged": 0, "failed": 2, "total": 1 },
  "results": [
    { "index": 0, "ref": 2, "status": "created", "id": "c3f6b2aa-0000-4000-8000-000000000001" },
    {
      "index": 1,
      "ref": 3,
      "status": "failed",
      "error": {
        "code": "VALIDATION_FAILED",
        "message": "This is not a usable phone number.",
        "field": "phone"
      }
    },
    {
      "index": 2,
      "ref": 4,
      "status": "failed",
      "error": {
        "code": "VALIDATION_FAILED",
        "message": "Give an email or a phone number.",
        "field": "email"
      }
    }
  ]
}
```

Row result `status`: `created`, `updated`, `unchanged`, `failed`. Row error `code` values: `VALIDATION_FAILED` (this row's content), `FORBIDDEN` (the role may not create or may not edit), `NOT_FOUND` (the contact is outside the role's record scope), `CONFLICT`,
`PLAN_LIMIT_REACHED` (the plan's contact or product cap), or any other stable code the CRM raises (for example a required custom property is missing). A row fails alone: the rest of the batch is still written.
Rows are processed in order, so two rows for the same person in one call act on one contact.

## 4. Permissions, in one place

| Action                                       | Needs                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Create a key, setup page, file list/download | session + `app.google-sheets.use` + the add-on installed + plan feature `marketplace`     |
| View status of / revoke my key               | session only                                                                              |
| Any add-on call                              | a live key + the member and workspace active + `app.google-sheets.use` + add-on installed |
| `GET /health`                                | the above, nothing more                                                                   |
| `GET /shops`                                 | `catalog.read` consented + `cat.products.read` + `store.storefront.read`                  |
| `POST /sync`                                 | `catalog.write` consented + `store.shops.manage` + products create or update (per row)    |
| `GET /contacts`                              | `contacts.read` consented + `record.contacts.read` (with its record scope)                |
| `POST /contacts/sync`                        | `contacts.write` consented + `record.contacts.create` or `.update` (per row)              |

## 5. Rules the client can rely on

- A sync is **idempotent in effect**: sending the same rows again reports `unchanged` for rows that did not differ. Retrying after a timeout is safe. The one exception is a shop sync without `shop_id`, which makes another shop; always send the `shop.id` from the first answer.
- The client should send at most 500 rows per call and split larger sheets itself. Calls are rate limited (120 a minute per key); a 500-row sheet is one call.
- The add-on never receives the member's password, session or any other member's key. A key is useless once the member is deleted or suspended, the add-on is uninstalled, or the role loses `app.google-sheets.use`.

## 6. For the Apps Script source

- Put the API address on one line of `Code.gs`, written exactly `const CRM_BASE = 'https://…';`. The download rewrites that line to this installation's `APP_URL`.
- Files go in `apps/api/assets/google-sheets-addon/` (see `SOURCE_CONTRACT.md` there). The six names are fixed. The source is written; the web page that offers it is `/google-sheets-addon` in `apps/web`.
- Use only the narrowest Google scopes (`spreadsheets.currentonly`, `script.container.ui`, `script.external_request`). The add-on reads the active sheet when the member presses an action. A contact or product push writes each row's result into a `CRM status` column of that sheet (created, updated, unchanged, or failed with the reason), and Pull contacts writes a sheet named `CRM contacts`; both need only `spreadsheets.currentonly`.
- Keep the key in the member's own `PropertiesService.getUserProperties()`, never in the sheet or in document properties (a sheet can be shared).

## 7. Operations

| Setting                      | Default                                                  | Meaning                                                     |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `EXT_SHEETS_ADDON_DIR`       | `assets/google-sheets-addon` (and `apps/api/assets/...`) | Where the add-on source is read from                        |
| `EXT_SHEETS_MARKETPLACE_URL` | `https://workspace.google.com/marketplace/`              | The "get the add-on" link on the setup page                 |
| `APP_URL`                    | (the API's own)                                          | The address written into the served `Code.gs` and `apiBase` |

Events (outbox): `ext.sheets_key.generated`, `ext.sheets_key.revoked`, `ext.sheets.synced` (`{ kind: "contacts" | "products", rows, created, updated, unchanged, failed, total }`). Audit modules: `ext_sheets_key`, `ext_sheets_sync`.
