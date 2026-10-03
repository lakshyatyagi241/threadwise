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
