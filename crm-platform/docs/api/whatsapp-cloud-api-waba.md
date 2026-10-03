# WhatsApp numbers API (`/v2/waba`)

Staff bearer JWT. Mutations take an `Idempotency-Key`. Errors are problem+json; branch on `code`, never on `detail`.
The full table (paths, permissions, bodies, results, error codes) is section 5 of
`docs/wadesk-port/waba-interakt/HANDOFF.md`; the schemas are in `packages/contracts/src/whatsapp-cloud-api-waba/`.

Added since: `GET /v2/waba/numbers/:id/health` returns `WabaHealth` including `details` (WABA node, token diagnostics, subscribed apps,
template tally, per-read `errors`); `GET /v2/waba/readiness` includes `coexistence`; `GET /v2/platform/waba/callback` (super admin)
returns the webhook URL, verify token, subscribe fields and the number of connected WABAs across workspaces.
Permissions: `waba.numbers.read|connect|manage`.

Provider registry (owner-requested extension): the route a number is reached through (`meta`, `interakt`, or a BSP the operator added) is
recorded as `meta_json.provider_key` and chosen per workspace by the operator; the console WhatsApp page and `WABA_ENV` stay the fallback
and the settings of the two built-in routes. See [whatsapp-providers.md](whatsapp-providers.md); `GET /v2/waba/provider-info` tells a
workspace which provider its numbers use.
