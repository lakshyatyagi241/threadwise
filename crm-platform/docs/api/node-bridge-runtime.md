# Node bridge runtime API (NODE)

Operator console, `v2`, platform operator token. Every operator may read; a super admin saves and tests. Errors are problem+json with a stable `code`.

| Method | Path                              | Who         | What                                                                                                          |
| ------ | --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/v2/platform/node-bridge`        | operator    | `{ serverUrl, tokenSet, rowVersion, pacing, pacingRowVersion }`. The token is never returned.                 |
| PATCH  | `/v2/platform/node-bridge`        | super admin | `{ serverUrl, token?, rowVersion }`. Blank token keeps the saved one; blank URL clears it.                    |
| PATCH  | `/v2/platform/node-bridge/pacing` | super admin | `{ msgGap 1..600, batchesGap 1..10000, bwMsgGap 1..1440, enableBatches, rowVersion }`                         |
| POST   | `/v2/platform/node-bridge/test`   | super admin | `{ serverUrl, token? }` (blank token = saved). 422 if the address is not http(s); else 200 `{ ok, message }`. |

Failures: 409 `ROW_VERSION_CONFLICT` (stale `rowVersion`), 422 `VALIDATION_FAILED`, 403 for a non-super operator on a write.

## Bridge-facing

Authenticated only by the shared `X-Node-Token` header (constant-time compare; no configured secret means everyone is refused with 403). The path is the
bridge's own, with no version prefix.

| Method | Path                             | Response                                                                                                 |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/api/whatsapp-message-settings` | `{ success: true, msg_gap, batches_gap, bw_msg_gap, enable_batches: 0 \| 1 }` (the bridge's wire format) |

Audit events: `platform.node_bridge_updated`, `platform.node_pacing_updated` (changed field names only, never values).
