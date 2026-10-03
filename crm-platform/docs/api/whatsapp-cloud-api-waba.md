# WhatsApp numbers API (`/v2/waba`)

Staff bearer JWT. Mutations take an `Idempotency-Key`. Errors are problem+json; branch on `code`, never on `detail`.
The full table (paths, permissions, bodies, results, error codes) is section 5 of
`docs/threadwise-port/waba-interakt/HANDOFF.md`; the schemas are in `packages/contracts/src/whatsapp-cloud-api-waba/`.

Added since: `GET /v2/waba/numbers/:id/health` returns `WabaHealth` including `details` (WABA node, token diagnostics, subscribed apps,
template tally, per-read `errors`); `GET /v2/waba/readiness` includes `coexistence`; `GET /v2/platform/waba/callback` (super admin)
returns the webhook URL, verify token, subscribe fields and the number of connected WABAs across workspaces.
Permissions: `waba.numbers.read|connect|manage`.
