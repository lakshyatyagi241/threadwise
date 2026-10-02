# API: add-ons and modules

Base `/v2`. Errors are `application/problem+json`; switch on `code`. Updates carry `rowVersion` (409 `ROW_VERSION_CONFLICT` on a stale one). Money is a decimal string. Identifiers are uuids.

Operator routes (`/platform/...`, operator token; reads for every role, writes for `super_admin`) and the workspace route are listed in
`docs/wadesk-port/port-map/addons-extension-registry.md`. Contracts: `@crm/contracts` (`addons-extension-registry`).

- `POST /platform/extensions/upload`: multipart, field `extension` (ZIP) and `purchaseCode`. 422 `ADD_PACKAGE_INVALID`, `ADD_PACKAGE_TOO_LARGE`, `ADD_CORE_TOO_OLD`, `ADD_ENGINE_CONFLICT`.
- `POST /platform/addons`: grants outside the registry of core and module flags and limits are dropped, zero or blank limits are not stored, `-1` means unlimited.
- `DELETE /platform/addons/:id`: 409 `ADD_PACK_IN_USE` while any workspace owns the pack.
- `GET /addons`: `{eligible, owned, catalog}`; `catalog` is empty unless the workspace is on an active paid plan.
