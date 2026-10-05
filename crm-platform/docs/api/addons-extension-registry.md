# API: add-ons and modules

Base `/v2`. Errors are `application/problem+json`; switch on `code`. Updates carry `rowVersion` (409 `ROW_VERSION_CONFLICT` on a stale one). Money is a decimal string. Identifiers are uuids.

Operator routes (`/platform/...`, operator token; reads for every role, writes for `super_admin`) and the workspace route are listed in
`docs/threadwise-port/port-map/addons-extension-registry.md`. Contracts: `@crm/contracts` (`addons-extension-registry`).

- `POST /platform/extensions/upload`: multipart, field `extension` (ZIP) and `purchaseCode`. 422 `ADD_PACKAGE_INVALID`, `ADD_PACKAGE_TOO_LARGE`, `ADD_CORE_TOO_OLD`, `ADD_ENGINE_CONFLICT`.
- `POST /platform/addons`: grants outside the registry of core and module flags and limits are dropped, zero or blank limits are not stored, `-1` means unlimited.
- `DELETE /platform/addons/:id`: 409 `ADD_PACK_IN_USE` while any workspace owns the pack.
- `GET /addons`: `{eligible, owned, catalog}`; `catalog` is empty unless the workspace is on an active paid plan.

## Recurring add-ons

- `billingMode`: `one_time` (default) or `recurring` on create, update and in every pack and catalogue card. A free or lifetime pack cannot be `recurring` (422 on `billingMode`).
- A `recurring` pack is bought through the same plan checkout as a subscription (no auto-renew tick: the quote's gateway `autoRenew` is true and the order always sets up the subscription). Where the chosen gateway cannot recur it is a one-time purchase for one term.
- The first charge pays the order and grants the add-on; each `subscription.charged` moves the purchase's `ends_at` to the provider period end (never earlier). The workspace plan is not touched. The `subscriptions` row has `kind = 'addon'` and `workspace_addon_id`.
- A failed charge keeps the add-on for `billing.grace_days` after `ends_at` while its subscription is live; then its grants stop counting. Cancel: `POST /v2/billing/subscription/addons/:id/cancel`.
- `GET /addons` owned entries carry `renews` (a live autopay subscription exists for the purchase).
