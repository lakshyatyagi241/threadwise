# WhatsApp numbers API (`/v2/waba`)

Staff bearer JWT. Mutations take an `Idempotency-Key`. Errors are problem+json; branch on `code`, never on `detail`.
The full table (paths, permissions, bodies, results, error codes) is section 5 of
`docs/threadwise-port/waba-interakt/HANDOFF.md`; the schemas are in `packages/contracts/src/whatsapp-cloud-api-waba/`.

Added since: `GET /v2/waba/numbers/:id/health` returns `WabaHealth` including `details` (WABA node, token diagnostics, subscribed apps,
template tally, per-read `errors`); `GET /v2/waba/readiness` includes `coexistence`; `GET /v2/platform/waba/callback` (super admin)
returns the webhook URL, verify token, subscribe fields and the number of connected WABAs across workspaces.
Permissions: `waba.numbers.read|connect|manage`.

Provider registry (owner-requested extension): the route a number is reached through (`meta`, `interakt`, or a BSP the operator added) is
recorded as `meta_json.provider_key` and chosen per workspace by the operator; the console WhatsApp page and `WABA_ENV` stay the fallback
and the settings of the two built-in routes. See [whatsapp-providers.md](whatsapp-providers.md); `GET /v2/waba/provider-info` tells a
workspace which provider its numbers use.

Added with the number extras (`waba.numbers.read` for reads, `waba.numbers.manage` for changes):
`GET|POST|DELETE /v2/waba/numbers/:id/username` (claim returns `{username, status, suggestions}`; handle rules are checked before Meta is called),
`GET|POST /v2/waba/numbers/:id/qr-codes` and `DELETE /v2/waba/numbers/:id/qr-codes/:code` (prefilled message up to 140 characters),
`POST /v2/waba/numbers/:id/sync-history` (re-subscribes; reports `importedMessages`), `GET /v2/waba/numbers/:id/inbound-check`
(`verdict`: `not_subscribed | wrong_url | delivering_here | subscribed_default`), `GET /v2/waba/webhook-config` (callback URL and verify
token for a customer's own Meta app). Health `details.conversations` carries this month's free-allowance tally when Meta's analytics answer.
Platform (super admin): `GET /v2/platform/waba/webhook-status` and `POST /v2/platform/waba/webhook-subscribe` for the Meta app's
coexistence fields (`messages`, `smb_message_echoes`, `smb_app_state_sync`, `history`).
Webhook fields now handled: `business_username_update` and `smb_message_echoes` (a message typed on the Business app becomes one outbound bubble).
Inbox: each connected number is a `whatsapp_cloud` channel made by the inbox's `WabaChannelLinkService` (see the WABA wiring map).

Added with groups, orders and saved customers: webhook fields `group_lifecycle_update`, `group_participants_update`, `group_settings_update`,
`group_status_update`, `history` and `smb_app_state_sync` are handled; a catalog cart is stored as an order and emits `whatsapp.order.received`; a form
submission emits `whatsapp.form.submitted` and a payment status `whatsapp.payment.updated`.
Saved customers (`waba.customers.read` for reads, `waba.customers.manage` for changes): `GET /v2/waba/customers?q=&page=` (20 a page, name then phone,
the search text is literal), `PUT /v2/waba/customers` (`{phone, name?, company?, address?}`; the same form creates or updates by the phone's digits),
`DELETE /v2/waba/customers/:id` (the profile only; orders are kept; unknown id is 404).

## Groups (`/v2/waba/numbers/:id/groups`, BL-094 phases 1 and 2)

Plan feature `waba_groups` on every route (422 `PLAN_FEATURE_LOCKED`, reads too). Only numbers connected straight to Meta (`WABA_GROUPS_PROVIDER_UNSUPPORTED` otherwise). Meta calls are made outside any transaction; nothing here has run against real Meta.

| Route                                  | Permission            | Notes                                                                                                             |
| -------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /state?fresh=1`                   | `waba.groups.read`    | `{eligible, reason, provider, officialBusinessAccount}`; a definite answer is cached 1 hour, a failed check never |
| `GET /?limit&cursor`                   | `waba.groups.read`    | newest first, keyset; `stats` cover the whole number; people waiting to join only with `.manage`                  |
| `POST /`                               | `waba.groups.create`  | 201; the invite link arrives later on a webhook                                                                   |
| `POST /:gid/refresh`                   | `waba.groups.read`    |                                                                                                                   |
| `POST /:gid/invite-link/reset`         | `waba.groups.manage`  |                                                                                                                   |
| `PATCH /:gid`                          | `waba.groups.manage`  | 202; Meta confirms each field on a webhook                                                                        |
| `POST /:gid/join-requests`             | `waba.groups.manage`  | `{action, ids}`                                                                                                   |
| `GET /:gid/participants`               | `waba.groups.manage`  | read from Meta on demand, never stored                                                                            |
| `DELETE /:gid/participants`            | `waba.groups.manage`  | at most 8                                                                                                         |
| `DELETE /:gid`                         | `waba.groups.delete`  | 204                                                                                                               |
| `GET /v2/waba/numbers/:id/group-count` | `waba.numbers.manage` | group records removing the number deletes (not plan gated)                                                        |

Codes: `WABA_GROUPS_NOT_ELIGIBLE`, `WABA_GROUPS_PROVIDER_UNSUPPORTED`, `WABA_GROUP_NOT_FOUND`, `WABA_GROUP_SUSPENDED`, `WABA_GROUP_LIMIT_REACHED`, `WABA_GROUP_RATE_LIMITED` (also the per-number budget of 30 changes a minute), `WABA_GROUP_META_REJECTED` (Meta's code in `details[metaCode]`). Events: `whatsapp.group.created|updated|deleted|join_request|suspended` (no phone numbers or links in payloads).
